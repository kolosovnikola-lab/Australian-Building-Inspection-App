import assert from "node:assert/strict";
import test from "node:test";
import {
  findOrphanedFindingMediaObjects,
  referencedFindingMediaPaths,
} from "./orphaned-finding-media-cleanup.ts";
import { isFindingMediaObjectPath } from "./report-media-storage.ts";

test("cleanup candidates exclude originals and thumbnails referenced by active rows", () => {
  const references = referencedFindingMediaPaths([
    {
      objectPath: "/objects/finding-media/10/20/client_report/aaaa",
      thumbnailObjectPath: "/objects/finding-media/10/20/client_report/bbbb",
    },
    {
      objectPath: "/objects/finding-media/10/20/private_evidence/cccc",
      thumbnailObjectPath: null,
    },
  ]);
  const before = new Date("2026-09-10T00:00:00.000Z");
  const candidates = findOrphanedFindingMediaObjects([
    { objectPath: "/objects/finding-media/10/20/client_report/aaaa", createdAt: new Date("2026-09-01"), sizeBytes: 1 },
    { objectPath: "/objects/finding-media/10/20/client_report/bbbb", createdAt: new Date("2026-09-01"), sizeBytes: 2 },
    { objectPath: "/objects/finding-media/10/20/private_evidence/cccc", createdAt: new Date("2026-09-01"), sizeBytes: 3 },
    { objectPath: "/objects/finding-media/10/20/private_evidence/dddd", createdAt: new Date("2026-09-01"), sizeBytes: 4 },
    { objectPath: "/objects/finding-media/10/20/client_report/eeee", createdAt: new Date("2026-09-12"), sizeBytes: 5 },
  ], references, before);

  assert.deepEqual(candidates.map((candidate) => candidate.objectPath), [
    "/objects/finding-media/10/20/private_evidence/dddd",
  ]);
});

test("cleanup namespace accepts only canonical finding-media object paths", () => {
  assert.equal(isFindingMediaObjectPath("/objects/finding-media/1/2/client_report/abc123"), true);
  assert.equal(isFindingMediaObjectPath("/objects/finding-media/1/2/private_evidence/abc123"), true);
  assert.equal(isFindingMediaObjectPath("/objects/finding-media/1/2/client_report/abc123/thumbnail"), false);
  assert.equal(isFindingMediaObjectPath("/objects/unrelated/1/2/client_report/abc123"), false);
  assert.equal(isFindingMediaObjectPath("/objects/finding-media/1/2/client_report/not-a-hex-id"), false);
});