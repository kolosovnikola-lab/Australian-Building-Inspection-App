import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const requireFromDbPackage = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
);
const { Pool } = requireFromDbPackage("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const baseUrl = process.env.TEST_API_BASE_URL;
const createdInspectionIds = [];
const createdUsageWorkspaceIds = [];

async function request(path, init) {
  const testUserId = init?.testUserId === undefined ? "inspector-a" : init.testUserId;
  const { testUserId: _ignored, testUserRole, testUserName, ...fetchInit } = init ?? {};
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchInit,
    headers: {
      "content-type": "application/json",
      ...(testUserId ? { "x-test-user-id": testUserId } : {}),
      ...(testUserRole ? { "x-test-user-role": testUserRole } : {}),
      ...(testUserName ? { "x-test-user-name": testUserName } : {}),
      ...fetchInit.headers,
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${fetchInit.method ?? "GET"} ${path}, received ${response.status}: ${text.slice(0, 500)}`);
    }
  }
  return {
    status: response.status,
    body,
  };
}

async function createInspection(label) {
  const response = await request("/api/inspections", {
    method: "POST",
    body: JSON.stringify({
      title: `PRIVACY-REGRESSION-${label}-${Date.now()}`,
      propertyAddress: "1 Test Boundary Street",
      clientName: "Privacy Regression",
      clientEmail: "client@example.test",
      inspectionDate: "2026-09-09",
      inspectorName: "Test Inspector",
      reportType: "pre_purchase",
      status: "complete",
    }),
  });
  assert.equal(response.status, 201);
  createdInspectionIds.push(response.body.id);
  return response.body;
}

async function createFinding(inspectionId, overrides = {}) {
  const response = await request(`/api/inspections/${inspectionId}/findings`, {
    method: "POST",
    body: JSON.stringify({
      area: "Roof exterior",
      subCategory: "Flashings",
      category: "roofing",
      title: "Possible flashing separation",
      location: "North-west junction",
      severity: "medium",
      pestRelevance: "not_applicable",
      observed: "A visible gap is present at the junction.",
      standardRef: "Inspector reference",
      standardTitle: "Licensed source to be verified",
      requirement: "Verify the applicable requirement.",
      tolerance: "Verify the applicable tolerance.",
      measuredValue: null,
      unit: null,
      assessment: "monitor",
      recommendation: "Have the junction reviewed by a qualified contractor.",
      clientExplanation: "The visible junction should be checked before water entry occurs.",
      photosCount: 4,
      reportPhotosCount: 1,
      evidencePhotosCount: 3,
      backupDestination: "company_drive",
      ...overrides,
    }),
  });
  assert.equal(response.status, 201);
  return response.body;
}

async function insertReportMedia(findingId, suffix = "") {
  const result = await pool.query(
    `insert into finding_media
      (finding_id, classification, object_path, content_type, file_name, size_bytes, metadata)
     values ($1, 'client_report', $2, 'image/jpeg', 'report.jpg', 1000, '{}')
     returning id`,
    [findingId, `/objects/test-report-${findingId}-${suffix || "original"}`],
  );
  return result.rows[0].id;
}

function testMediaFilePath(objectPath) {
  assert.ok(process.env.TEST_MEDIA_STORAGE_DIR);
  return path.join(
    process.env.TEST_MEDIA_STORAGE_DIR,
    ...objectPath.slice("/objects/".length).split("/"),
  );
}

test("workspace usage reports plan allowances and current billable activity", async () => {
  const workspaceId = `usage-workspace-${Date.now()}`;
  createdUsageWorkspaceIds.push(workspaceId);
  const inspection = await createInspection("USAGE");
  await pool.query(
    `insert into workspace_usage_events (workspace_id, event_type, quantity)
     values ($1, 'ai_assist', 3)`,
    [workspaceId],
  );

  const usage = await request("/api/usage", {
    testUserId: "inspector-a",
    headers: {
      "x-test-workspace-id": workspaceId,
      "x-test-plan": "team",
      "x-test-billing-period": "monthly",
    },
  });
  assert.equal(usage.status, 200);
  assert.deepEqual(usage.body.plan, { id: "team", name: "Team", billingPeriod: "monthly" });
  assert.equal(usage.body.metrics.find((metric) => metric.key === "inspections").used, 1);
  assert.equal(usage.body.metrics.find((metric) => metric.key === "inspections").remaining, 44);
  assert.equal(usage.body.metrics.find((metric) => metric.key === "ai_assists").used, 3);
  assert.equal(usage.body.metrics.find((metric) => metric.key === "ai_assists").remaining, 197);
  assert.equal(usage.body.warnings.length, 0);
  assert.ok(inspection.id);
});

test.after(async () => {
  if (createdInspectionIds.length) {
    await pool.query(
      "delete from inspections where id = any($1::int[])",
      [createdInspectionIds],
    );
  }
  if (createdUsageWorkspaceIds.length) {
    await pool.query(
      "delete from workspace_usage_events where workspace_id = any($1::text[])",
      [createdUsageWorkspaceIds],
    );
  }
  await pool.end();
});

test("shared report omits private evidence and persists safe delivery transitions", async () => {
  const inspection = await createInspection("SHARED");
  const finding = await createFinding(inspection.id);
  await pool.query(
    `insert into finding_media
      (finding_id, classification, object_path, thumbnail_object_path, content_type, file_name, caption, sha256, size_bytes, metadata)
     values
      ($1, 'client_report', '/objects/report-original', '/objects/report-thumbnail', 'image/jpeg', 'report.jpg', 'Client-safe image', 'report-hash', 1000, '{"camera":"safe"}'),
      ($1, 'private_evidence', '/objects/private-original', '/objects/private-thumbnail', 'image/jpeg', 'private.jpg', 'Private evidence', 'private-hash', 2000, '{"signedUrl":"https://private.invalid","gps":"secret"}')`,
    [finding.id],
  );

  const ready = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(ready.status, 200);

  const share = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "client@example.test",
      summaryLanguage: "en",
    }),
  });
  assert.equal(share.status, 200);
  assert.equal(share.body.deliveryStatus, "sent");
  assert.equal(share.body.summaryLanguage, "en");
  assert.equal(share.body.viewedAt, null);
  const signedOutInspection = await request(
    `/api/inspections/${inspection.id}`,
    { testUserId: null },
  );
  assert.equal(signedOutInspection.status, 401);
  const crossInspectorInspection = await request(
    `/api/inspections/${inspection.id}`,
    { testUserId: "inspector-b" },
  );
  assert.equal(crossInspectorInspection.status, 404);
  const authenticatedInspection = await request(`/api/inspections/${inspection.id}`);
  assert.equal(authenticatedInspection.status, 200);
  assert.deepEqual(
    authenticatedInspection.body.findings[0].media.map((item) => ({
      id: item.id,
      findingId: item.findingId,
      classification: item.classification,
      contentType: item.contentType,
      fileName: item.fileName,
      caption: item.caption,
      sizeBytes: item.sizeBytes,
    })),
    [
      {
        id: authenticatedInspection.body.findings[0].media[0].id,
        findingId: finding.id,
        classification: "client_report",
        contentType: "image/jpeg",
        fileName: "report.jpg",
        caption: "Client-safe image",
        sizeBytes: 1000,
      },
      {
        id: authenticatedInspection.body.findings[0].media[1].id,
        findingId: finding.id,
        classification: "private_evidence",
        contentType: "image/jpeg",
        fileName: "private.jpg",
        caption: "Private evidence",
        sizeBytes: 2000,
      },
    ],
  );
  assert.doesNotMatch(JSON.stringify(authenticatedInspection.body.findings[0].media), /objectPath|thumbnailObjectPath|sha256|metadata|gps|signedUrl/);
  const beforeBlockedActions = await pool.query(
    "select report_share_token from inspections where id = $1",
    [inspection.id],
  );
  const eventsBeforeBlockedActions = await pool.query(
    "select count(*)::int as count from report_delivery_events where inspection_id = $1",
    [inspection.id],
  );
  const blockedRequests = await Promise.all([
    request(`/api/inspections/${inspection.id}/report/share`, {
      method: "POST",
      testUserId: "inspector-b",
      body: JSON.stringify({ recipientType: "client", recipientEmail: "other@example.test" }),
    }),
    request(`/api/inspections/${inspection.id}/report/ready`, {
      method: "POST",
      testUserId: "inspector-b",
    }),
    request(`/api/inspections/${inspection.id}/report/rotate`, {
      method: "POST",
      testUserId: "inspector-b",
      body: JSON.stringify({ currentShareToken: beforeBlockedActions.rows[0].report_share_token }),
    }),
    request(`/api/inspections/${inspection.id}/report/revoke`, {
      method: "POST",
      testUserId: null,
      body: JSON.stringify({ currentShareToken: beforeBlockedActions.rows[0].report_share_token }),
    }),
  ]);
  assert.deepEqual(blockedRequests.map((result) => result.status), [404, 404, 404, 401]);
  const afterBlockedActions = await pool.query(
    "select report_share_token from inspections where id = $1",
    [inspection.id],
  );
  const eventsAfterBlockedActions = await pool.query(
    "select count(*)::int as count from report_delivery_events where inspection_id = $1",
    [inspection.id],
  );
  assert.equal(afterBlockedActions.rows[0].report_share_token, beforeBlockedActions.rows[0].report_share_token);
  assert.equal(eventsAfterBlockedActions.rows[0].count, eventsBeforeBlockedActions.rows[0].count);

  const reportPath = `/api${share.body.shareUrl}`;
  const signedOutHistory = await request(
    `/api/inspections/${inspection.id}/report/delivery-history`,
    { testUserId: null },
  );
  assert.equal(signedOutHistory.status, 401);
  const crossInspectorHistory = await request(
    `/api/inspections/${inspection.id}/report/delivery-history`,
    { testUserId: "inspector-b" },
  );
  assert.equal(crossInspectorHistory.status, 404);

  const firstView = await request(reportPath, { testUserId: null });
  assert.equal(firstView.status, 200);
  assert.equal(firstView.body.summaryLanguage, "en");
  assert.match(firstView.body.translationNotice, /English professional report controls/);
  assert.equal(firstView.body.plainLanguageSummary[0].summary, finding.clientExplanation);
  assert.equal(firstView.body.findings[0].observed, finding.observed);
  assert.equal(firstView.body.findings[0].recommendation, finding.recommendation);
  assert.equal(firstView.body.findings[0].standardRef, finding.standardRef);
  assert.equal(firstView.body.findings[0].reportPhotosCount, 1);
  assert.deepEqual(firstView.body.findings[0].media, [{
    id: firstView.body.findings[0].media[0].id,
    contentType: "image/jpeg",
    caption: "Client-safe image",
    url: `/api${share.body.shareUrl}/media/${firstView.body.findings[0].media[0].id}/original`,
    thumbnailUrl: `/api${share.body.shareUrl}/media/${firstView.body.findings[0].media[0].id}/thumbnail`,
  }]);
  const serialized = JSON.stringify(firstView.body);
  assert.doesNotMatch(serialized, /evidencePhotosCount|photosCount|backupDestination|company_drive|privateMedia|objectKey|objectPath|signedUrl|private-original|private-thumbnail|private-hash|gps|secret/);
  const privateMediaId = await pool.query(
    "select id from finding_media where finding_id = $1 and classification = 'private_evidence'",
    [finding.id],
  );
  const privateFetch = await request(
    `${reportPath}/media/${privateMediaId.rows[0].id}/original`,
  );
  assert.equal(privateFetch.status, 404);
  const firstViewReceipt = await request(reportPath, { method: "POST", testUserId: null });
  assert.equal(firstViewReceipt.status, 200);

  const firstState = await pool.query(
    "select delivery_status, report_viewed_at from inspections where id = $1",
    [inspection.id],
  );
  assert.equal(firstState.rows[0].delivery_status, "viewed");
  assert.ok(firstState.rows[0].report_viewed_at);

  const secondView = await request(reportPath, { testUserId: null });
  assert.equal(secondView.status, 200);
  const secondViewReceipt = await request(reportPath, { method: "POST", testUserId: null });
  assert.equal(secondViewReceipt.status, 200);
  const secondState = await pool.query(
    "select report_viewed_at from inspections where id = $1",
    [inspection.id],
  );
  assert.equal(
    secondState.rows[0].report_viewed_at.toISOString(),
    firstState.rows[0].report_viewed_at.toISOString(),
  );

  const historyAfterViews = await request(
    `/api/inspections/${inspection.id}/report/delivery-history`,
  );
  assert.equal(historyAfterViews.status, 200);
  assert.equal(
    historyAfterViews.body.filter((event) => event.eventType === "viewed").length,
    1,
  );
  assert.equal(
    historyAfterViews.body.find((event) => event.eventType === "viewed").actorDisplayName,
    null,
  );
  assert.doesNotMatch(
    JSON.stringify(historyAfterViews.body),
    /tokenDigest|previousTokenDigest|safe-share-token/,
  );

  const competingRotations = await Promise.all([
    request(`/api/inspections/${inspection.id}/report/rotate`, {
      method: "POST",
      body: JSON.stringify({ currentShareToken: share.body.shareUrl.split("/").at(-1) }),
    }),
    request(`/api/inspections/${inspection.id}/report/rotate`, {
      method: "POST",
      body: JSON.stringify({ currentShareToken: share.body.shareUrl.split("/").at(-1) }),
    }),
  ]);
  const rotate = competingRotations.find((result) => result.status === 200);
  assert.ok(rotate);
  assert.deepEqual(
    competingRotations.map((result) => result.status).sort(),
    [200, 409],
  );
  assert.equal(rotate.status, 200);
  assert.equal(rotate.body.action, "rotated");
  assert.equal(rotate.body.reportStatus, "ready");
  assert.equal(rotate.body.deliveryStatus, "shared");
  assert.notEqual(rotate.body.shareUrl, share.body.shareUrl);
  assert.equal((await request(reportPath)).status, 404);
  const replacementPath = `/api${rotate.body.shareUrl}`;
  assert.equal((await request(replacementPath)).status, 200);

  const revoke = await request(`/api/inspections/${inspection.id}/report/revoke`, {
    method: "POST",
    body: JSON.stringify({ currentShareToken: rotate.body.shareUrl.split("/").at(-1) }),
  });
  assert.equal(revoke.status, 200);
  assert.deepEqual(revoke.body, {
    action: "revoked",
    reportStatus: "ready",
    deliveryStatus: "not_shared",
    shareUrl: null,
    happenedAt: revoke.body.happenedAt,
  });
  assert.equal((await request(replacementPath)).status, 404);
  const revokedState = await pool.query(
    "select report_status, delivery_status, report_share_token from inspections where id = $1",
    [inspection.id],
  );
  assert.deepEqual(revokedState.rows[0], {
    report_status: "ready",
    delivery_status: "not_shared",
    report_share_token: null,
  });

  const historyAfterControls = await request(
    `/api/inspections/${inspection.id}/report/delivery-history`,
  );
  assert.equal(historyAfterControls.status, 200);
  assert.ok(historyAfterControls.body.some((event) => event.eventType === "rotated"));
  assert.ok(historyAfterControls.body.some((event) => event.eventType === "revoked"));
  assert.ok(
    historyAfterControls.body
      .filter((event) => ["rotated", "revoked"].includes(event.eventType))
      .every((event) => event.actorDisplayName === "Inspector"),
  );

  const reshare = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "client@example.test",
    }),
  });
  assert.equal(reshare.status, 200);
  assert.equal(reshare.body.deliveryStatus, "sent");
  assert.equal(reshare.body.viewedAt, null);
  const resharedPath = `/api${reshare.body.shareUrl}`;

  const mutation = await request(`/api/findings/${finding.id}`, {
    method: "PATCH",
    body: JSON.stringify({ evidencePhotosCount: 4 }),
  });
  assert.equal(mutation.status, 200);
  const revoked = await pool.query(
    "select report_status, delivery_status, report_share_token from inspections where id = $1",
    [inspection.id],
  );
  assert.deepEqual(revoked.rows[0], {
    report_status: "draft",
    delivery_status: "not_shared",
    report_share_token: null,
  });
  assert.equal((await request(resharedPath)).status, 404);
});

test("translation review is required before sharing a non-English summary", async () => {
  const inspection = await createInspection("TRANSLATION-REVIEW");
  const finding = await createFinding(inspection.id, {
    clientExplanation: "The visible junction should be checked before water entry occurs.",
  });
  await pool.query(
    `insert into finding_media
      (finding_id, classification, object_path, content_type, file_name, size_bytes, metadata)
     values
       ($1, 'client_report', '/objects/translation-report', 'image/jpeg', 'report.jpg', 1000, '{}'),
       ($1, 'private_evidence', '/objects/translation-private', 'image/jpeg', 'private.jpg', 1000, '{"gps":"secret"}')`,
    [finding.id],
  );

  const ready = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(ready.status, 200);

  const englishPreview = await request(`/api/inspections/${inspection.id}/report/translation-preview`, {
    method: "POST",
    body: JSON.stringify({ summaryLanguage: "en" }),
  });
  assert.equal(englishPreview.status, 200);
  assert.equal(englishPreview.body.translations[0].sourceText, finding.clientExplanation);
  assert.equal(englishPreview.body.translations[0].translatedText, finding.clientExplanation);
  assert.match(englishPreview.body.authorityNotice, /English professional report controls/);

  const translatedPreview = await request(`/api/inspections/${inspection.id}/report/translation-preview`, {
    method: "POST",
    headers: { "x-test-report-translation": "deterministic" },
    body: JSON.stringify({ summaryLanguage: "zh-Hans" }),
  });
  assert.equal(translatedPreview.status, 200);
  assert.equal(translatedPreview.body.translations[0].translatedText, `[translated] ${finding.clientExplanation}`);

  const missingReview = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({ recipientType: "client", summaryLanguage: "zh-Hans" }),
  });
  assert.equal(missingReview.status, 409);
  assert.match(missingReview.body.error, /Review and accept every translated/);

  const shared = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    testUserName: "Translation Reviewer",
    body: JSON.stringify({
      recipientType: "client",
      summaryLanguage: "zh-Hans",
      reviewedTranslations: [{
        id: finding.id,
         text: translatedPreview.body.translations[0].translatedText,
      }],
    }),
  });
  assert.equal(shared.status, 200);
  const report = await request(`/api${shared.body.shareUrl}`, { testUserId: null });
  assert.equal(report.status, 200);
  assert.equal(report.body.summaryLanguage, "zh-Hans");
  assert.equal(report.body.plainLanguageSummary[0].summary, `[translated] ${finding.clientExplanation}`);
  const professionalKeys = [
    "area",
    "subCategory",
    "category",
    "title",
    "location",
    "severity",
    "observed",
    "standardRef",
    "standardTitle",
    "requirement",
    "tolerance",
    "measuredValue",
    "unit",
    "assessment",
    "recommendation",
    "clientExplanation",
  ];
  assert.deepEqual(
    Object.fromEntries(professionalKeys.map((key) => [key, report.body.findings[0][key]])),
    Object.fromEntries(professionalKeys.map((key) => [key, finding[key]])),
  );
  assert.equal(report.body.findings[0].media.length, 1);
  assert.doesNotMatch(JSON.stringify(report.body.findings[0].media), /translation-private|gps|private/);
  const history = await request(`/api/inspections/${inspection.id}/report/delivery-history`);
  assert.equal(history.status, 200);
  const reviewEvent = history.body.find((event) => event.eventType === "translation_reviewed");
  assert.ok(reviewEvent);
  assert.equal(reviewEvent.reviewedSummaryLanguage, "zh-Hans");
  assert.ok(reviewEvent.reviewCompletedAt);
  assert.equal(reviewEvent.actorDisplayName, "Translation Reviewer");
  assert.doesNotMatch(
    JSON.stringify(report.body),
    /translation_reviewed|reviewedSummaryLanguage|reviewCompletedAt/,
  );
});

test("malformed translation responses are retryable and cannot reach shared reports", async () => {
  const inspection = await createInspection("TRANSLATION-FAILURE");
  const finding = await createFinding(inspection.id);
  await insertReportMedia(finding.id, "translation-failure");

  const ready = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(ready.status, 200);

  const failedPreview = await request(`/api/inspections/${inspection.id}/report/translation-preview`, {
    method: "POST",
    headers: { "x-test-report-translation": "malformed" },
    body: JSON.stringify({ summaryLanguage: "vi" }),
  });
  assert.equal(failedPreview.status, 503);
  assert.match(failedPreview.body.error, /temporarily unavailable/);

  const state = await pool.query(
    `select report_status, delivery_status, report_share_token, report_summary_language, report_summary_translations
     from inspections where id = $1`,
    [inspection.id],
  );
  assert.deepEqual(state.rows[0], {
    report_status: "ready",
    delivery_status: "not_shared",
    report_share_token: null,
    report_summary_language: null,
    report_summary_translations: null,
  });

  const blockedShare = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      summaryLanguage: "vi",
    }),
  });
  assert.equal(blockedShare.status, 409);
  assert.match(blockedShare.body.error, /Review and accept every translated/);

  const validPreview = await request(`/api/inspections/${inspection.id}/report/translation-preview`, {
    method: "POST",
    headers: { "x-test-report-translation": "deterministic" },
    body: JSON.stringify({ summaryLanguage: "vi" }),
  });
  assert.equal(validPreview.status, 200);
  assert.deepEqual(validPreview.body.translations, [{
    id: finding.id,
    title: finding.title,
    sourceText: finding.clientExplanation,
    translatedText: `[translated] ${finding.clientExplanation}`,
  }]);

  const stateAfterRetry = await pool.query(
    `select delivery_status, report_share_token, report_summary_language, report_summary_translations
     from inspections where id = $1`,
    [inspection.id],
  );
  assert.deepEqual(stateAfterRetry.rows[0], {
    delivery_status: "not_shared",
    report_share_token: null,
    report_summary_language: null,
    report_summary_translations: null,
  });

  const shared = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      summaryLanguage: "vi",
      reviewedTranslations: [{
        id: finding.id,
        text: validPreview.body.translations[0].translatedText,
      }],
    }),
  });
  assert.equal(shared.status, 200);
  const report = await request(`/api${shared.body.shareUrl}`, { testUserId: null });
  assert.equal(report.status, 200);
  assert.equal(report.body.summaryLanguage, "vi");
  assert.equal(report.body.plainLanguageSummary[0].summary, `[translated] ${finding.clientExplanation}`);
});

test("evidence-only photos cannot make a report ready", async () => {
  const inspection = await createInspection("EVIDENCE-ONLY");
  await createFinding(inspection.id, {
    photosCount: 5,
    reportPhotosCount: 0,
    evidencePhotosCount: 5,
  });

  const readiness = await request(
    `/api/inspections/${inspection.id}/report/readiness`,
  );
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.ready, false);
  const photoCheck = readiness.body.checks.find(
    (check) => check.key === "report_photos_present",
  );
  assert.equal(photoCheck.complete, false);
  assert.match(photoCheck.detail, /Private evidence does not count/);

  const ready = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(ready.status, 409);
});

test("missing plain-language explanations block readiness and sharing", async () => {
  const inspection = await createInspection("MISSING-PLAIN-LANGUAGE");
  const finding = await createFinding(inspection.id, {
    title: "Technical finding without client wording",
    clientExplanation: null,
  });

  const readiness = await request(
    `/api/inspections/${inspection.id}/report/readiness`,
  );
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.ready, false);
  const explanationCheck = readiness.body.checks.find(
    (check) => check.key === "client_explanations_complete",
  );
  assert.equal(explanationCheck.complete, false);
  assert.deepEqual(explanationCheck.missingFindings, [
    { id: finding.id, title: finding.title },
  ]);

  const ready = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(ready.status, 409);

  const share = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "client@example.test",
    }),
  });
  assert.equal(share.status, 409);
});

test("readability advisories stay internal to readiness responses", async () => {
  const inspection = await createInspection("READABILITY-BOUNDARY");
  const approvedExplanation = "Efflorescence is visible on the substrate after moisture ingress, and the condition should be reviewed by a qualified contractor before further water entry affects nearby materials because the visible signs may worsen over time.";
  const finding = await createFinding(inspection.id, {
    title: "Approved explanation with review advisories",
    clientExplanation: approvedExplanation,
  });
  await insertReportMedia(finding.id, "readability-boundary");

  const readiness = await request(
    `/api/inspections/${inspection.id}/report/readiness`,
  );
  assert.equal(readiness.status, 200);
  const advisory = readiness.body.advisories.find(
    (item) => item.id === finding.id,
  );
  assert.ok(advisory);
  assert.deepEqual(
    advisory.warnings.map((warning) => warning.kind),
    ["long_sentence", "technical_term", "technical_term", "technical_term"],
  );
  assert.deepEqual(
    advisory.warnings
      .filter((warning) => warning.kind === "technical_term")
      .map((warning) => warning.term),
    ["efflorescence", "moisture ingress", "substrate"],
  );

  const ready = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(ready.status, 200);

  const share = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "client@example.test",
      summaryLanguage: "en",
    }),
  });
  assert.equal(share.status, 200);

  const report = await request(`/api${share.body.shareUrl}`, {
    testUserId: null,
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.plainLanguageSummary[0].summary, approvedExplanation);
  assert.equal(report.body.findings[0].clientExplanation, approvedExplanation);
  assert.deepEqual(Object.keys(report.body), [
    "inspectionId",
    "reportNumber",
    "title",
    "propertyAddress",
    "clientName",
    "inspectionDate",
    "inspectorName",
    "reportType",
    "issuedAt",
    "summaryLanguage",
    "translationNotice",
    "plainLanguageSummary",
    "findings",
  ]);
  assert.equal("advisories" in report.body, false);
  assert.equal("warnings" in report.body, false);
  assert.equal("term" in report.body.findings[0], false);
  assert.doesNotMatch(
    JSON.stringify(report.body),
    /Consider explaining|splitting it into shorter sentences/,
  );
});

test("only an admin can claim a legacy unassigned inspection", async () => {
  const inspection = await createInspection("LEGACY-CLAIM");
  await pool.query(
    "update inspections set owner_id = 'legacy_unassigned' where id = $1",
    [inspection.id],
  );
  const ordinaryClaim = await request(
    `/api/admin/legacy-inspections/${inspection.id}/claim`,
    { method: "POST" },
  );
  assert.equal(ordinaryClaim.status, 403);
  const adminClaim = await request(
    `/api/admin/legacy-inspections/${inspection.id}/claim`,
    { method: "POST", testUserRole: "admin" },
  );
  assert.equal(adminClaim.status, 200);
  const claimed = await pool.query(
    "select owner_id from inspections where id = $1",
    [inspection.id],
  );
  assert.equal(claimed.rows[0].owner_id, "inspector-a");
});

test("field app can load safe inspection summaries without report credentials", async () => {
  const foreign = await request("/api/inspections", {
    method: "POST",
    testUserId: "inspector-b",
    body: JSON.stringify({
      title: `FOREIGN-${Date.now()}`,
      propertyAddress: "99 Other Owner Street",
      clientName: "Other Owner",
      inspectionDate: "2026-09-09",
      inspectorName: "Other Inspector",
      reportType: "pre_purchase",
      status: "complete",
    }),
  });
  assert.equal(foreign.status, 201);
  createdInspectionIds.push(foreign.body.id);
  const authenticated = await request("/api/inspections");
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.some((item) => item.id === foreign.body.id), false);

  const response = await request("/api/inspections", { testUserId: null });
  assert.equal(response.status, 200);
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /reportShareToken|reportRecipientEmail|reportRecipientType|ownerId/,
  );
});

test("finding media upload endpoints require inspector authentication before storage access", async () => {
  const inspection = await createInspection("MEDIA-AUTH");
  const finding = await createFinding(inspection.id);
  const uploadInput = {
    findingId: finding.id,
    classification: "client_report",
    contentType: "image/jpeg",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
  };
  const signedOutUrl = await request(`/api/inspections/${inspection.id}/media/upload-url`, {
    method: "POST",
    testUserId: null,
    body: JSON.stringify(uploadInput),
  });
  assert.equal(signedOutUrl.status, 401);
  const signedOutCompletion = await request(`/api/inspections/${inspection.id}/media/complete`, {
    method: "POST",
    testUserId: null,
    body: JSON.stringify({
      ...uploadInput,
      objectPath: `/objects/finding-media/${inspection.id}/${finding.id}/client_report/${"b".repeat(36)}`,
      fileName: "report.jpg",
      caption: null,
    }),
  });
  assert.equal(signedOutCompletion.status, 401);

  const authenticatedUrl = await request(`/api/inspections/${inspection.id}/media/upload-url`, {
    method: "POST",
    body: JSON.stringify(uploadInput),
  });
  assert.ok([201, 503].includes(authenticatedUrl.status));
});

test("editing captions, reclassifying, and deleting media preserve report boundaries and counts", async () => {
  const inspection = await createInspection("MEDIA-MUTATIONS");
  const finding = await createFinding(inspection.id);
  const mediaId = await insertReportMedia(finding.id, "reclassify");

  const ready = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(ready.status, 200);
  const share = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "client@example.test",
    }),
  });
  assert.equal(share.status, 200);

  const captioned = await request(`/api/findings/${finding.id}/media/${mediaId}`, {
    method: "PATCH",
    body: JSON.stringify({
      classification: "client_report",
      caption: "Updated client-visible roof junction",
    }),
  });
  assert.equal(captioned.status, 200);
  assert.equal(captioned.body.caption, "Updated client-visible roof junction");
  assert.equal(captioned.body.classification, "client_report");
  const afterCaption = await pool.query(
    "select photos_count, report_photos_count, evidence_photos_count from findings where id = $1",
    [finding.id],
  );
  assert.deepEqual(afterCaption.rows[0], {
    photos_count: 1,
    report_photos_count: 1,
    evidence_photos_count: 0,
  });
  assert.equal((await request(`/api${share.body.shareUrl}`)).status, 404);
  const refreshedInspection = await request(`/api/inspections/${inspection.id}`);
  assert.equal(refreshedInspection.body.findings[0].media[0].caption, "Updated client-visible roof junction");
  assert.equal((await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  })).status, 200);
  const captionShare = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "client@example.test",
    }),
  });
  assert.equal(captionShare.status, 200);
  const captionReport = await request(`/api${captionShare.body.shareUrl}`);
  assert.equal(captionReport.body.findings[0].media[0].caption, "Updated client-visible roof junction");

  const reclassified = await request(`/api/findings/${finding.id}/media/${mediaId}`, {
    method: "PATCH",
    body: JSON.stringify({ classification: "private_evidence" }),
  });
  assert.equal(reclassified.status, 200);
  assert.equal(reclassified.body.classification, "private_evidence");
  const afterReclassify = await pool.query(
    "select photos_count, report_photos_count, evidence_photos_count from findings where id = $1",
    [finding.id],
  );
  assert.deepEqual(afterReclassify.rows[0], {
    photos_count: 1,
    report_photos_count: 0,
    evidence_photos_count: 1,
  });
  assert.deepEqual(
    (await pool.query(
      "select report_status, delivery_status, report_share_token from inspections where id = $1",
      [inspection.id],
    )).rows[0],
    { report_status: "draft", delivery_status: "not_shared", report_share_token: null },
  );
  assert.equal(
    (await request(`/api/inspections/${inspection.id}/report/readiness`)).body.ready,
    false,
  );
  const privateCaption = await request(`/api/findings/${finding.id}/media/${mediaId}`, {
    method: "PATCH",
    body: JSON.stringify({
      classification: "private_evidence",
      caption: "Inspector-only moisture context",
    }),
  });
  assert.equal(privateCaption.status, 200);
  assert.equal(privateCaption.body.caption, "Inspector-only moisture context");

  const replacementMediaId = await insertReportMedia(finding.id, "delete");
  const readyAgain = await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  });
  assert.equal(readyAgain.status, 200);
  const sharedAgain = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "client@example.test",
    }),
  });
  assert.equal(sharedAgain.status, 200);
  const reportAfterPrivateCaption = await request(`/api${sharedAgain.body.shareUrl}`);
  assert.doesNotMatch(JSON.stringify(reportAfterPrivateCaption.body), /Inspector-only moisture context/);

  const deleted = await request(`/api/findings/${finding.id}/media/${replacementMediaId}`, {
    method: "DELETE",
  });
  assert.deepEqual(deleted, {
    status: 200,
    body: { id: replacementMediaId, deleted: true },
  });
  const afterReportPhotoDelete = await request(`/api/inspections/${inspection.id}`);
  assert.deepEqual(
    {
      photosCount: afterReportPhotoDelete.body.findings[0].photosCount,
      reportPhotosCount: afterReportPhotoDelete.body.findings[0].reportPhotosCount,
      evidencePhotosCount: afterReportPhotoDelete.body.findings[0].evidencePhotosCount,
    },
    { photosCount: 1, reportPhotosCount: 0, evidencePhotosCount: 1 },
  );
  const readinessAfterDelete = await request(`/api/inspections/${inspection.id}/report/readiness`);
  assert.equal(readinessAfterDelete.body.ready, false);
  assert.equal(
    readinessAfterDelete.body.checks.find((check) => check.key === "report_photos_present")?.complete,
    false,
  );
  const deletedPrivateEvidence = await request(`/api/findings/${finding.id}/media/${mediaId}`, {
    method: "DELETE",
  });
  assert.deepEqual(deletedPrivateEvidence, {
    status: 200,
    body: { id: mediaId, deleted: true },
  });
  const afterDelete = await pool.query(
    "select photos_count, report_photos_count, evidence_photos_count from findings where id = $1",
    [finding.id],
  );
  assert.deepEqual(afterDelete.rows[0], {
    photos_count: 0,
    report_photos_count: 0,
    evidence_photos_count: 0,
  });
  assert.equal((await request(`/api${sharedAgain.body.shareUrl}`)).status, 404);
});

test("failed media object cleanup preserves report state and can be retried", async () => {
  const inspection = await createInspection("MEDIA-CLEANUP-RETRY");
  const finding = await createFinding(inspection.id, {
    photosCount: 1,
    reportPhotosCount: 1,
    evidencePhotosCount: 0,
  });
  const originalPath = `/objects/finding-media/${inspection.id}/${finding.id}/client_report/${"a".repeat(32)}`;
  const thumbnailPath = `/objects/finding-media/${inspection.id}/${finding.id}/client_report/${"b".repeat(32)}`;
  const inserted = await pool.query(
    `insert into finding_media
      (finding_id, classification, object_path, thumbnail_object_path, content_type, file_name, size_bytes, metadata)
     values ($1, 'client_report', $2, $3, 'image/jpeg', 'retry.jpg', 1000, '{}')
     returning id`,
    [finding.id, originalPath, thumbnailPath],
  );
  const mediaId = inserted.rows[0].id;
  const originalFile = testMediaFilePath(originalPath);
  const thumbnailFile = testMediaFilePath(thumbnailPath);
  await mkdir(path.dirname(originalFile), { recursive: true });
  await writeFile(originalFile, "original");
  await mkdir(thumbnailFile);

  assert.equal((await request(`/api/inspections/${inspection.id}/report/ready`, {
    method: "POST",
  })).status, 200);
  const shared = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({
      recipientType: "client",
      recipientEmail: "cleanup-retry@example.test",
    }),
  });
  assert.equal(shared.status, 200);
  const stateBeforeFailure = (await pool.query(
    `select f.photos_count, f.report_photos_count, f.evidence_photos_count,
            i.report_status, i.delivery_status, i.report_share_token
       from findings f
       join inspections i on i.id = f.inspection_id
      where f.id = $1`,
    [finding.id],
  )).rows[0];

  const failedDelete = await request(`/api/findings/${finding.id}/media/${mediaId}`, {
    method: "DELETE",
  });
  assert.equal(failedDelete.status, 503);
  assert.match(failedDelete.body.error, /Try again/);
  assert.equal(
    (await pool.query("select count(*)::int as count from finding_media where id = $1", [mediaId])).rows[0].count,
    1,
  );
  const stateAfterFailure = (await pool.query(
    `select f.photos_count, f.report_photos_count, f.evidence_photos_count,
            i.report_status, i.delivery_status, i.report_share_token
       from findings f
       join inspections i on i.id = f.inspection_id
      where f.id = $1`,
    [finding.id],
  )).rows[0];
  assert.deepEqual(stateAfterFailure, stateBeforeFailure);
  assert.equal(
    (await request(`/api/inspections/${inspection.id}/report/readiness`)).body.ready,
    true,
  );
  assert.equal((await request(`/api${shared.body.shareUrl}`)).status, 200);

  await rm(thumbnailFile, { recursive: true });
  await writeFile(thumbnailFile, "thumbnail");
  const retriedDelete = await request(`/api/findings/${finding.id}/media/${mediaId}`, {
    method: "DELETE",
  });
  assert.deepEqual(retriedDelete, {
    status: 200,
    body: { id: mediaId, deleted: true },
  });
  await assert.rejects(access(originalFile), { code: "ENOENT" });
  await assert.rejects(access(thumbnailFile), { code: "ENOENT" });
  assert.equal(
    (await pool.query("select count(*)::int as count from finding_media where id = $1", [mediaId])).rows[0].count,
    0,
  );
  const afterRetry = await request(`/api/inspections/${inspection.id}`);
  assert.deepEqual(
    {
      photosCount: afterRetry.body.findings[0].photosCount,
      reportPhotosCount: afterRetry.body.findings[0].reportPhotosCount,
      evidencePhotosCount: afterRetry.body.findings[0].evidencePhotosCount,
    },
    { photosCount: 0, reportPhotosCount: 0, evidencePhotosCount: 0 },
  );
  assert.equal(
    (await request(`/api/inspections/${inspection.id}/report/readiness`)).body.ready,
    false,
  );
  assert.equal((await request(`/api${shared.body.shareUrl}`)).status, 404);
});

test("automatic link invalidations record safe reasons", async () => {
  const inspection = await createInspection("AUTO-INVALIDATE");
  const neverSharedRecovery = await request(`/api/inspections/${inspection.id}/report/recover`, {
    method: "POST",
  });
  assert.equal(neverSharedRecovery.status, 409);
  const original = await createFinding(inspection.id);
  await insertReportMedia(original.id);
  const shareAgain = async () => {
    assert.equal((await request(`/api/inspections/${inspection.id}/report/ready`, { method: "POST" })).status, 200);
    const shared = await request(`/api/inspections/${inspection.id}/report/share`, {
      method: "POST",
      body: JSON.stringify({ recipientType: "client", recipientEmail: "audit@example.test" }),
    });
    assert.equal(shared.status, 200);
    return shared;
  };
  const latestAutomaticEvent = async () => {
    const history = await request(`/api/inspections/${inspection.id}/report/delivery-history`);
    return history.body.find((event) => event.eventType === "automatically_invalidated");
  };

   const originalShare = await shareAgain();
  assert.equal((await request(`/api/inspections/${inspection.id}`, {
    method: "PATCH",
    testUserName: "Alex Inspector",
    body: JSON.stringify({
      title: "Edited inspection title",
      actorDisplayName: "Spoofed Client Name",
      actorId: "spoofed-user",
    }),
  })).status, 200);
  const inspectionEditEvent = await latestAutomaticEvent();
  assert.equal(inspectionEditEvent.reason, "inspection_edited");
  assert.equal(inspectionEditEvent.actorDisplayName, "Alex Inspector");
  assert.equal("actorId" in inspectionEditEvent, false);
   const recoveryAttempts = [
     { testUserId: "inspector-a", testUserName: "Alex Inspector (session one)" },
     {
       testUserId: "inspector-a",
       testUserName: "Alex Inspector (session two)",
     },
   ];
   const recoveryResponses = await Promise.all(recoveryAttempts.map(async (actor) => ({
     actor,
     response: await request(`/api/inspections/${inspection.id}/report/recover`, {
       method: "POST",
       ...actor,
     }),
   })));
   assert.deepEqual(
     recoveryResponses.map(({ response }) => response.status).sort(),
     [200, 409],
   );
   const successfulRecovery = recoveryResponses.find(({ response }) => response.status === 200);
   const conflictingRecovery = recoveryResponses.find(({ response }) => response.status === 409);
   assert.ok(successfulRecovery);
   assert.ok(conflictingRecovery);
   assert.match(conflictingRecovery.response.body.error, /automatically invalidated|report changed/i);
   const recovered = successfulRecovery.response;
   assert.equal(recovered.body.action, "recovered");
   assert.equal(recovered.body.reportStatus, "ready");
   assert.equal(recovered.body.deliveryStatus, "shared");
   assert.notEqual(recovered.body.shareUrl, originalShare.body.shareUrl);
   assert.equal((await request(`/api${originalShare.body.shareUrl}`)).status, 404);
   assert.equal((await request(`/api${recovered.body.shareUrl}`)).status, 200);
   const recoveredState = await pool.query(
     "select report_status, delivery_status, report_share_token, report_recipient_type, report_recipient_email from inspections where id = $1",
     [inspection.id],
   );
   assert.deepEqual(recoveredState.rows[0], {
     report_status: "ready",
     delivery_status: "shared",
     report_share_token: recovered.body.shareUrl.split("/").at(-1),
     report_recipient_type: "client",
     report_recipient_email: "client@example.test",
   });
   const recoveredHistory = await request(`/api/inspections/${inspection.id}/report/delivery-history`);
   const recoveredEvents = recoveredHistory.body.filter((event) => event.eventType === "recovered");
   assert.equal(recoveredEvents.length, 1);
   const [recoveredEvent] = recoveredEvents;
   assert.equal(recoveredEvent.reason, "recovered_after_invalidation");
   assert.equal(recoveredEvent.actorDisplayName, successfulRecovery.actor.testUserName);
   const originalToken = originalShare.body.shareUrl.split("/").at(-1);
   const replacementToken = recovered.body.shareUrl.split("/").at(-1);
   const publicHistoryJson = JSON.stringify(recoveredHistory.body);
   assert.doesNotMatch(publicHistoryJson, /tokenDigest|previousTokenDigest|safe-share-token/);
   assert.equal(publicHistoryJson.includes(originalToken), false);
   assert.equal(publicHistoryJson.includes(replacementToken), false);
   const storedRecoveries = await pool.query(
     `select count(*)::int as count,
             count(distinct token_digest)::int as distinct_token_count,
             bool_and(token_digest <> $2) as stores_digest_only
      from report_delivery_events
      where inspection_id = $1 and event_type = 'recovered'`,
     [inspection.id, replacementToken],
   );
   assert.deepEqual(storedRecoveries.rows[0], {
     count: 1,
     distinct_token_count: 1,
     stores_digest_only: true,
   });
  const storedActor = await pool.query(
    "select actor_id, actor_display_name from report_delivery_events where inspection_id = $1 and event_type = 'automatically_invalidated' order by id desc limit 1",
    [inspection.id],
  );
  assert.deepEqual(storedActor.rows[0], {
    actor_id: "inspector-a",
    actor_display_name: "Alex Inspector",
  });

  await shareAgain();
  const newFinding = await createFinding(inspection.id, { title: "New valid finding" });
  await insertReportMedia(newFinding.id);
  assert.equal(newFinding.title, "New valid finding");
  assert.equal((await latestAutomaticEvent()).reason, "finding_created");

  await shareAgain();
  assert.equal((await request(`/api/findings/${original.id}`, {
    method: "PATCH", body: JSON.stringify({ observed: "Edited visible condition." }),
  })).status, 200);
  assert.equal((await latestAutomaticEvent()).reason, "finding_edited");

  await shareAgain();
  await pool.query("update findings set recommendation = '' where id = $1", [original.id]);
  const failedShare = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({ recipientType: "client", recipientEmail: "audit@example.test" }),
  });
  assert.equal(failedShare.status, 409);
  assert.equal((await latestAutomaticEvent()).reason, "readiness_failed");
});

test("interrupted field sync reuses one finding and one completed media record", async () => {
  const inspection = await createInspection("FIELD-SYNC-IDEMPOTENCY");
  const creationRequestId = `queue_${Date.now()}`;
  const input = {
    category: "wet_area",
    title: "Live shower leak",
    location: "Shower enclosure",
    severity: "high",
    observed: "Water escaped during operation.",
    standardRef: "Inspector review required",
    standardTitle: "Camera analysis is not a standards assessment",
    requirement: "Confirm the applicable requirement during inspector review.",
    tolerance: "Not assessed by camera analysis.",
    assessment: "monitor",
    recommendation: "Have a qualified contractor investigate.",
    creationRequestId,
  };
  const firstCreate = await request(`/api/inspections/${inspection.id}/findings`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const retriedCreate = await request(`/api/inspections/${inspection.id}/findings`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  assert.equal(firstCreate.status, 201);
  assert.equal(retriedCreate.status, 200);
  assert.equal(retriedCreate.body.id, firstCreate.body.id);
  const findingCount = await pool.query(
    "select count(*)::int as count from findings where inspection_id = $1 and creation_request_id = $2",
    [inspection.id, creationRequestId],
  );
  assert.equal(findingCount.rows[0].count, 1);

  const objectPath = `/objects/finding-media/${inspection.id}/${firstCreate.body.id}/client_report/${"a".repeat(32)}`;
  const seeded = await pool.query(
    `insert into finding_media
      (finding_id, classification, object_path, content_type, file_name, size_bytes, sha256, metadata)
     values ($1, 'client_report', $2, 'image/jpeg', 'leak.jpg', 1000, $3, '{"verifiedUpload":true}')
     returning id`,
    [firstCreate.body.id, objectPath, "b".repeat(64)],
  );
  const completionInput = {
    findingId: firstCreate.body.id,
    classification: "client_report",
    objectPath,
    fileName: "leak.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1000,
    sha256: "b".repeat(64),
  };
  const firstCompletion = await request(`/api/inspections/${inspection.id}/media/complete`, {
    method: "POST",
    body: JSON.stringify(completionInput),
  });
  const retriedCompletion = await request(`/api/inspections/${inspection.id}/media/complete`, {
    method: "POST",
    body: JSON.stringify(completionInput),
  });
  assert.equal(firstCompletion.status, 200);
  assert.equal(retriedCompletion.status, 200);
  assert.equal(firstCompletion.body.id, seeded.rows[0].id);
  assert.equal(retriedCompletion.body.id, seeded.rows[0].id);
  const mediaCount = await pool.query(
    "select count(*)::int as count from finding_media where object_path = $1",
    [objectPath],
  );
  assert.equal(mediaCount.rows[0].count, 1);
});

test("managers can claim legacy inspections and reassign owned inspections", async () => {
  const legacy = await createInspection("LEGACY-ASSIGNMENT");
  await pool.query(
    "update inspections set owner_id = 'legacy_unassigned' where id = $1",
    [legacy.id],
  );

  const ordinaryInspectors = await request("/api/admin/inspectors", {
    testUserRole: "inspector",
  });
  assert.equal(ordinaryInspectors.status, 403);

  const inspectors = await request("/api/admin/inspectors", {
    testUserId: "manager-a",
    testUserRole: "manager",
  });
  assert.equal(inspectors.status, 200);
  assert.ok(inspectors.body.some((inspector) => inspector.id === "inspector-b"));

  const legacyRows = await request("/api/admin/legacy-inspections", {
    testUserId: "manager-a",
    testUserRole: "manager",
  });
  assert.equal(legacyRows.status, 200);
  assert.ok(legacyRows.body.some((inspection) => inspection.id === legacy.id));

  const legacyClaim = await request(`/api/admin/inspections/${legacy.id}/assignment`, {
    method: "PATCH",
    testUserId: "manager-a",
    testUserRole: "manager",
    body: JSON.stringify({ ownerId: "inspector-b" }),
  });
  assert.equal(legacyClaim.status, 200);
  assert.equal(legacyClaim.body.ownerId, "inspector-b");

  const legacyAudit = await pool.query(
    `select event_type, reason, actor_id
     from report_delivery_events
     where inspection_id = $1 and event_type = 'inspection_assigned'
     order by id desc limit 1`,
    [legacy.id],
  );
  assert.deepEqual(legacyAudit.rows[0], {
    event_type: "inspection_assigned",
    reason: "legacy_claimed",
    actor_id: "manager-a",
  });

  const owned = await createInspection("REASSIGNMENT");
  const forbiddenTransfer = await request(`/api/admin/inspections/${owned.id}/assignment`, {
    method: "PATCH",
    testUserId: "inspector-a",
    testUserRole: "inspector",
    body: JSON.stringify({ ownerId: "inspector-b" }),
  });
  assert.equal(forbiddenTransfer.status, 403);

  const managerRegister = await request("/api/inspections", {
    testUserId: "manager-a",
    testUserRole: "manager",
  });
  assert.ok(managerRegister.body.some((inspection) => inspection.id === owned.id));

  const ordinaryRegister = await request("/api/inspections", {
    testUserId: "inspector-b",
    testUserRole: "inspector",
  });
  assert.equal(ordinaryRegister.status, 200);
  assert.equal(ordinaryRegister.body.some((inspection) => inspection.id === owned.id), false);
});

test("reassignment revokes an active client link and preserves inspector isolation", async () => {
  const inspection = await createInspection("ACTIVE-LINK-REASSIGNMENT");
  const finding = await createFinding(inspection.id);
  await insertReportMedia(finding.id);
  assert.equal((await request(`/api/inspections/${inspection.id}/report/ready`, { method: "POST" })).status, 200);
  const shared = await request(`/api/inspections/${inspection.id}/report/share`, {
    method: "POST",
    body: JSON.stringify({ recipientType: "client", recipientEmail: "assignment@example.test" }),
  });
  assert.equal(shared.status, 200);
  const currentToken = shared.body.shareUrl.split("/").at(-1);

  const assignment = await request(`/api/admin/inspections/${inspection.id}/assignment`, {
    method: "PATCH",
    testUserId: "manager-a",
    testUserRole: "manager",
    body: JSON.stringify({ ownerId: "inspector-b" }),
  });
  assert.equal(assignment.status, 200);
  assert.equal(assignment.body.ownerId, "inspector-b");
  assert.equal(assignment.body.reportStatus, "draft");
  assert.equal(assignment.body.reportShareToken, null);

  const storedState = await pool.query(
    "select owner_id, report_status, report_share_token from inspections where id = $1",
    [inspection.id],
  );
  assert.deepEqual(storedState.rows[0], {
    owner_id: "inspector-b",
    report_status: "draft",
    report_share_token: null,
  });

  const oldInspector = await request(`/api/inspections/${inspection.id}`, {
    testUserId: "inspector-a",
    testUserRole: "inspector",
  });
  assert.equal(oldInspector.status, 404);
  const newInspector = await request(`/api/inspections/${inspection.id}`, {
    testUserId: "inspector-b",
    testUserRole: "inspector",
  });
  assert.equal(newInspector.status, 200);
  assert.equal(newInspector.body.ownerId, "inspector-b");

  const oldReport = await request(`/api/reports/${currentToken}`, { testUserId: null });
  assert.equal(oldReport.status, 404);
  const audit = await pool.query(
    `select event_type, reason, actor_id
     from report_delivery_events
     where inspection_id = $1
     order by id desc`,
    [inspection.id],
  );
  assert.ok(audit.rows.some((event) =>
    event.event_type === "inspection_assigned"
      && event.reason === "inspection_reassigned"
      && event.actor_id === "manager-a",
  ));
  assert.ok(audit.rows.some((event) =>
    event.event_type === "automatically_invalidated"
      && event.reason === "inspection_reassigned"
      && event.actor_id === "manager-a",
  ));
});

test("workspace managers can manage an advisory client-language glossary", async () => {
  const workspaceA = `glossary-a-${Date.now()}`;
  const workspaceB = `glossary-b-${Date.now()}`;
  const workspaceHeaders = (workspaceId) => ({
    "x-test-workspace-id": workspaceId,
  });

  const initial = await request("/api/admin/client-language-glossary", {
    testUserId: "manager-a",
    testUserRole: "manager",
    headers: workspaceHeaders(workspaceA),
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.length, 10);
  assert.equal(initial.body.every((term) => term.active), true);

  const customTerm = `rising damp ${Date.now()}`;
  const created = await request("/api/admin/client-language-glossary", {
    method: "POST",
    testUserId: "manager-a",
    testUserRole: "manager",
    headers: workspaceHeaders(workspaceA),
    body: JSON.stringify({
      term: customTerm,
      suggestedMeaning: "water moving up through a wall",
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.term, customTerm);

  const otherWorkspace = await request("/api/client-language-glossary", {
    testUserId: "inspector-b",
    testUserRole: "inspector",
    headers: workspaceHeaders(workspaceB),
  });
  assert.equal(otherWorkspace.status, 200);
  assert.equal(otherWorkspace.body.some((term) => term.term === customTerm), false);

  const inspectionResponse = await request("/api/inspections", {
    method: "POST",
    testUserId: "inspector-a",
    testUserRole: "inspector",
    headers: workspaceHeaders(workspaceA),
    body: JSON.stringify({
      title: `GLOSSARY-${Date.now()}`,
      propertyAddress: "1 Glossary Street",
      clientName: "Glossary Test",
      inspectionDate: "2026-09-09",
      inspectorName: "Test Inspector",
      reportType: "pre_purchase",
      status: "complete",
    }),
  });
  assert.equal(inspectionResponse.status, 201);
  createdInspectionIds.push(inspectionResponse.body.id);
  const finding = await createFinding(inspectionResponse.body.id, {
    clientExplanation: `The ${customTerm} condition should be monitored.`,
  });
  await insertReportMedia(finding.id, "glossary");

  const readiness = await request(`/api/inspections/${inspectionResponse.body.id}/report/readiness`, {
    testUserId: "inspector-a",
    testUserRole: "inspector",
    headers: workspaceHeaders(workspaceA),
  });
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.ready, true);
  assert.equal(readiness.body.advisories.some((advisory) =>
    advisory.warnings.some((warning) => warning.term === customTerm),
  ), true);
  const storedFinding = await request(`/api/inspections/${inspectionResponse.body.id}`, {
    testUserId: "inspector-a",
    testUserRole: "inspector",
    headers: workspaceHeaders(workspaceA),
  });
  assert.equal(storedFinding.body.findings[0].clientExplanation, `The ${customTerm} condition should be monitored.`);

  const editedTerm = `${customTerm} updated`;
  const edited = await request(`/api/admin/client-language-glossary/${created.body.id}`, {
    method: "PATCH",
    testUserId: "manager-a",
    testUserRole: "manager",
    testUserName: "Morgan Manager",
    headers: workspaceHeaders(workspaceA),
    body: JSON.stringify({
      term: editedTerm,
      suggestedMeaning: "moisture moving upward through masonry",
    }),
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.term, editedTerm);

  const retired = await request(`/api/admin/client-language-glossary/${created.body.id}`, {
    method: "PATCH",
    testUserId: "manager-a",
    testUserRole: "manager",
    testUserName: "Morgan Manager",
    headers: workspaceHeaders(workspaceA),
    body: JSON.stringify({ active: false }),
  });
  assert.equal(retired.status, 200);
  assert.equal(retired.body.active, false);
  const activeAfterRetire = await request("/api/client-language-glossary", {
    testUserId: "inspector-a",
    testUserRole: "inspector",
    headers: workspaceHeaders(workspaceA),
  });
  assert.equal(activeAfterRetire.body.some((term) => term.term === customTerm), false);
  const restored = await request(`/api/admin/client-language-glossary/${created.body.id}`, {
    method: "PATCH",
    testUserId: "manager-a",
    testUserRole: "manager",
    testUserName: "Morgan Manager",
    headers: workspaceHeaders(workspaceA),
    body: JSON.stringify({ active: true }),
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.active, true);

  const history = await request("/api/admin/client-language-glossary/history", {
    testUserId: "manager-a",
    testUserRole: "manager",
    headers: workspaceHeaders(workspaceA),
  });
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.slice(0, 4).map((event) => event.action), [
    "restored",
    "retired",
    "edited",
    "added",
  ]);
  assert.equal(history.body.every((event) => event.actorDisplayName === "Morgan Manager" || event.action === "added"), true);
  assert.equal(history.body.find((event) => event.action === "edited").previousTerm, customTerm);
  assert.equal("actorId" in history.body[0], false);
  assert.equal("workspaceId" in history.body[0], false);

  const isolatedHistory = await request("/api/admin/client-language-glossary/history", {
    testUserId: "manager-b",
    testUserRole: "manager",
    headers: workspaceHeaders(workspaceB),
  });
  assert.deepEqual(isolatedHistory, { status: 200, body: [] });
  const inspectorHistory = await request("/api/admin/client-language-glossary/history", {
    testUserId: "inspector-a",
    testUserRole: "inspector",
    headers: workspaceHeaders(workspaceA),
  });
  assert.equal(inspectorHistory.status, 403);
});