import assert from "node:assert/strict";
import test from "node:test";
import type { Finding, FindingMedia } from "@workspace/db";
import {
  buildSharedDeliveryUpdate,
  getReportReadiness,
  reviewClientExplanation,
  revokeReportDelivery,
  getReportMediaObjectPath,
  toClientReportMedia,
  toClientReportFindings,
} from "./report-policy.ts";

function finding(
  overrides: Partial<Finding> = {},
): Finding {
  return {
    id: 12,
    inspectionId: 7,
    creationRequestId: null,
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
    backupDestination: "private_archive",
    createdAt: new Date("2026-09-09T10:00:00.000Z"),
    ...overrides,
  };
}

test("client report projection excludes all private evidence and media metadata", () => {
  const source = {
    ...finding(),
    privateMedia: [
      {
        objectKey: "private/inspection-7/original.jpg",
        downloadUrl: "https://private.invalid/signed-original",
        sha256: "private-hash",
      },
    ],
    backupDetails: {
      destination: "private_archive",
      objectKey: "backups/original.jpg",
    },
  } as Finding & {
    privateMedia: unknown[];
    backupDetails: unknown;
  };

  const [publicFinding] = toClientReportFindings([source], [{
    id: 1,
    findingId: source.id,
    classification: "client_report",
    objectPath: "/objects/report-original",
    thumbnailObjectPath: null,
    contentType: "image/jpeg",
    fileName: "report.jpg",
    caption: null,
    sha256: null,
    sizeBytes: 100,
    metadata: {},
    createdAt: new Date("2026-09-09T10:00:00.000Z"),
  }]);

  assert.equal(publicFinding.reportPhotosCount, 1);
  assert.equal("photosCount" in publicFinding, false);
  assert.equal("evidencePhotosCount" in publicFinding, false);
  assert.equal("backupDestination" in publicFinding, false);
  assert.equal("backupDetails" in publicFinding, false);
  assert.equal("privateMedia" in publicFinding, false);
  assert.doesNotMatch(JSON.stringify(publicFinding), /private_archive|signed-original|private-hash/);
});

test("report media projection exposes only report-scoped proxy URLs", () => {
  const base = {
    findingId: 12,
    contentType: "image/jpeg",
    fileName: "original.jpg",
    caption: "Roof junction",
    sha256: "must-not-leak",
    sizeBytes: 1234,
    metadata: { gps: "-37.8,144.9", signedUrl: "https://private.invalid" },
    createdAt: new Date("2026-09-09T10:00:00.000Z"),
  };
  const reportMedia = {
    ...base,
    id: 1,
    classification: "client_report",
    objectPath: "/objects/report-original",
    thumbnailObjectPath: "/objects/report-thumbnail",
  } satisfies FindingMedia;
  const privateMedia = {
    ...base,
    id: 2,
    classification: "private_evidence",
    objectPath: "/objects/private-original",
    thumbnailObjectPath: "/objects/private-thumbnail",
  } satisfies FindingMedia;

  const projected = toClientReportMedia([reportMedia, privateMedia], "report-token");

  assert.deepEqual(projected, [{
    id: 1,
    contentType: "image/jpeg",
    caption: "Roof junction",
    url: "/api/reports/report-token/media/1/original",
    thumbnailUrl: "/api/reports/report-token/media/1/thumbnail",
  }]);
  assert.equal(getReportMediaObjectPath(reportMedia, "original"), "/objects/report-original");
  assert.equal(getReportMediaObjectPath(reportMedia, "thumbnail"), "/objects/report-thumbnail");
  assert.equal(getReportMediaObjectPath(privateMedia, "original"), null);
  assert.doesNotMatch(JSON.stringify(projected), /object|sha256|gps|signedUrl|private/);
});

test("private evidence never satisfies the report photo readiness requirement", () => {
  const evidenceOnly = finding({
    photosCount: 5,
    reportPhotosCount: 0,
    evidencePhotosCount: 5,
  });

  const readiness = getReportReadiness(
    { status: "complete" },
    [evidenceOnly],
  );
  const photoCheck = readiness.checks.find(
    (check) => check.key === "report_photos_present",
  );

  assert.equal(readiness.ready, false);
  assert.equal(photoCheck?.complete, false);
  assert.match(photoCheck?.detail ?? "", /Private evidence does not count/);
});

test("every finding needs a report photo even when other findings have one", () => {
  const readiness = getReportReadiness(
    { status: "complete" },
    [
      finding({ id: 1, reportPhotosCount: 1, evidencePhotosCount: 0 }),
      finding({ id: 2, reportPhotosCount: 0, evidencePhotosCount: 8 }),
    ],
  );

  assert.equal(readiness.ready, false);
  assert.equal(
    readiness.checks.find((check) => check.key === "report_photos_present")
      ?.complete,
    false,
  );
});

test("readiness names every finding missing a client explanation", () => {
  const readiness = getReportReadiness(
    { status: "complete" },
    [
      finding({ id: 21, title: "Approved wording", clientExplanation: "This is clear." }),
      finding({ id: 22, title: "Missing wording", clientExplanation: null }),
      finding({ id: 23, title: "Blank wording", clientExplanation: "   " }),
    ],
  );
  const explanationCheck = readiness.checks.find(
    (check) => check.key === "client_explanations_complete",
  );

  assert.equal(readiness.ready, false);
  assert.equal(explanationCheck?.complete, false);
  assert.deepEqual(explanationCheck?.missingFindings, [
    { id: 22, title: "Missing wording" },
    { id: 23, title: "Blank wording" },
  ]);
  assert.match(explanationCheck?.detail ?? "", /2 findings need/);
});

test("readability warnings are advisory and do not block concise explanations", () => {
  const concise = "Water is getting in near the window. A builder should inspect the seal.";
  assert.deepEqual(reviewClientExplanation(concise), []);

  const technical = finding({
    clientExplanation: "Efflorescence is visible on the substrate after moisture ingress.",
  });
  const readiness = getReportReadiness(
    { status: "complete" },
    [technical],
    [{ findingId: technical.id, classification: "client_report" }],
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.checks.find((check) => check.key === "client_explanations_complete")?.complete, true);
  assert.equal(readiness.advisories.length, 1);
  assert.deepEqual(
    readiness.advisories[0].warnings.map((warning) => warning.term),
    ["efflorescence", "moisture ingress", "substrate"],
  );
});

test("readability warnings flag long sentences without changing the saved wording", () => {
  const explanation = "This is a deliberately long client explanation that describes the visible condition, the likely path for water entry, the possible impact on nearby materials, and the recommended next step so the client can understand what was observed and what should happen next.";
  const warnings = reviewClientExplanation(explanation);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, "long_sentence");
  assert.match(warnings[0].message, /splitting it into shorter sentences/);
  assert.equal(explanation.includes("deliberately long client explanation"), true);
});

test("sharing records the recipient and resets viewed state", () => {
  const sharedAt = new Date("2026-09-09T11:00:00.000Z");
  const update = buildSharedDeliveryUpdate({
    token: "safe-share-token",
    recipientType: "client",
    recipientEmail: "client@example.test",
    summaryLanguage: "en",
    summaryTranslations: [{ id: 1, text: "Water is entering near the window." }],
    sharedAt,
  });

  assert.equal(update.deliveryStatus, "shared");
  assert.equal(update.reportShareToken, "safe-share-token");
  assert.equal(update.reportViewedAt, null);
  assert.equal(update.reportSharedAt, sharedAt);
  assert.equal(update.reportSummaryLanguage, "en");
  assert.deepEqual(JSON.parse(update.reportSummaryTranslations), [{ id: 1, text: "Water is entering near the window." }]);
});

test("delivery revocation clears all sharing and viewed state", () => {
  assert.deepEqual(revokeReportDelivery, {
    reportStatus: "draft",
    deliveryStatus: "not_shared",
    reportRecipientType: null,
    reportRecipientEmail: null,
    reportSummaryLanguage: null,
    reportSummaryTranslations: null,
    reportShareToken: null,
    reportDeliveryAttemptId: null,
    reportDeliveryIdempotencyKey: null,
    reportDeliveryProviderId: null,
    reportDeliveryError: null,
    reportReadyAt: null,
    reportDeliveryAttemptedAt: null,
    reportSharedAt: null,
    reportDeliveredAt: null,
    reportViewedAt: null,
  });
});