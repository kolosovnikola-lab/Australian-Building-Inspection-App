import assert from "node:assert/strict";
import test from "node:test";
import { reportLinkStateFromUrl } from "./report-link-state.ts";
import { reportInvalidationCopy } from "./report-invalidation-copy.ts";
import { refreshReportState } from "./report-state-refresh.ts";
import { buildPlainLanguageSummary, selectPlainLanguageSummary } from "./plain-language-summary.ts";
import { missingFindingLabel } from "./report-readiness-copy.ts";
import { deliveryEventActorLabel } from "./delivery-event-actor.ts";

test("share, rotate, and revoke update the current link without a refetch", () => {
  const shared = reportLinkStateFromUrl("/reports/first-token-123456");
  assert.equal(shared.currentShareToken, "first-token-123456");

  const rotated = reportLinkStateFromUrl("/reports/replacement-token-789");
  assert.equal(rotated.shareUrl, "/reports/replacement-token-789");
  assert.equal(rotated.currentShareToken, "replacement-token-789");
  assert.notEqual(rotated.currentShareToken, shared.currentShareToken);

  const revoked = reportLinkStateFromUrl(null);
  assert.deepEqual(revoked, { shareUrl: "", currentShareToken: "" });
});

test("automatic invalidation reasons have clear security-history copy", () => {
  assert.deepEqual(Object.keys(reportInvalidationCopy).sort(), [
    "finding_created",
    "finding_edited",
    "inspection_edited",
    "readiness_failed",
  ]);
  assert.match(reportInvalidationCopy.readiness_failed, /readiness checks/);
});

test("post-edit refresh includes inspection, readiness, and security history", () => {
  const keys: readonly unknown[][] = [];
  refreshReportState({
    invalidateQueries: ({ queryKey }) => { keys.push(queryKey); },
  }, {
    inspection: ["inspection", 42],
    readiness: ["inspection", 42, "readiness"],
    history: ["inspection", 42, "delivery-history"],
  });
  assert.equal(keys.length, 3);
  assert.match(JSON.stringify(keys), /inspection/);
  assert.match(JSON.stringify(keys), /readiness/);
  assert.match(JSON.stringify(keys), /delivery-history/);
});

test("plain-language summary uses approved explanations and safe fallbacks", () => {
  const summary = buildPlainLanguageSummary([
    { id: 1, title: "Minor cracking", location: "Hallway", severity: "low", clientExplanation: null },
    { id: 2, title: "Active leak", location: "Bathroom", severity: "high", clientExplanation: "Water is entering the room and should be addressed promptly." },
  ]);
  assert.equal(summary[0].id, 2);
  assert.equal(summary[0].summary, "Water is entering the room and should be addressed promptly.");
  assert.match(summary[1].summary, /read finding 1 below/i);
});

test("non-English reports can switch back to the authoritative English summary", () => {
  const translated = [{ id: 1, summary: "中文摘要" }];
  const english = [{ id: 1, summary: "The approved English explanation." }];
  assert.deepEqual(selectPlainLanguageSummary("zh-Hans", false, translated, english), translated);
  assert.deepEqual(selectPlainLanguageSummary("zh-Hans", true, translated, english), english);
  assert.deepEqual(selectPlainLanguageSummary("en", false, translated, english), english);
});

test("readiness guidance identifies the exact finding to edit", () => {
  assert.equal(
    missingFindingLabel({ id: 22, title: "Missing client explanation" }),
    "Finding 22: Missing client explanation",
  );
});

test("security history distinguishes inspectors, clients, and system events", () => {
  assert.equal(
    deliveryEventActorLabel({ eventType: "automatically_invalidated", actorDisplayName: "Alex Inspector" }),
    "Inspector: Alex Inspector",
  );
  assert.equal(
    deliveryEventActorLabel({ eventType: "viewed", actorDisplayName: null }),
    "Client activity",
  );
  assert.equal(
    deliveryEventActorLabel({ eventType: "automatically_invalidated", actorDisplayName: null }),
    "System-generated event",
  );
});