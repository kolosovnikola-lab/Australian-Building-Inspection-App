import { db, findingMediaTable, pool } from "@workspace/db";
import { or, eq, sql } from "drizzle-orm";
import {
  findOrphanedFindingMediaObjects,
  referencedFindingMediaPaths,
} from "../lib/orphaned-finding-media-cleanup";
import {
  deletePrivateMediaObject,
  listStoredFindingMediaObjects,
} from "../lib/report-media-storage";

const deleteObjects = process.argv.includes("--delete");
const beforeArgument = process.argv.find((argument) => argument.startsWith("--before="));

if (deleteObjects && !beforeArgument) {
  throw new Error("Cleanup deletion requires an explicit --before=<ISO timestamp> cutoff");
}

const before = beforeArgument
  ? new Date(beforeArgument.slice("--before=".length))
  : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

if (!Number.isFinite(before.getTime()) || before.getTime() >= Date.now()) {
  throw new Error("--before must be a valid timestamp in the past");
}

const references = await db.select({
  objectPath: findingMediaTable.objectPath,
  thumbnailObjectPath: findingMediaTable.thumbnailObjectPath,
}).from(findingMediaTable);
const storedObjects = await listStoredFindingMediaObjects();
const candidates = findOrphanedFindingMediaObjects(
  storedObjects,
  referencedFindingMediaPaths(references),
  before,
);

const report = {
  mode: deleteObjects ? "delete" : "dry-run",
  cutoff: before.toISOString(),
  scannedFindingMediaObjects: storedObjects.length,
  referencedPaths: referencedFindingMediaPaths(references).size,
  candidates: candidates.map((candidate) => ({
    objectPath: candidate.objectPath,
    createdAt: candidate.createdAt.toISOString(),
    sizeBytes: candidate.sizeBytes,
  })),
};

console.log(JSON.stringify(report, null, 2));

if (deleteObjects && candidates.length > 0) {
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`lock table finding_media in share mode`);
    const deleted: string[] = [];
    const skippedReferenced: string[] = [];
    const failed: Array<{ objectPath: string; error: string }> = [];

    for (const candidate of candidates) {
      const [currentReference] = await tx.select({ id: findingMediaTable.id })
        .from(findingMediaTable)
        .where(or(
          eq(findingMediaTable.objectPath, candidate.objectPath),
          eq(findingMediaTable.thumbnailObjectPath, candidate.objectPath),
        ))
        .limit(1);
      if (currentReference) {
        skippedReferenced.push(candidate.objectPath);
        continue;
      }
      try {
        await deletePrivateMediaObject(candidate.objectPath);
        deleted.push(candidate.objectPath);
      } catch (error) {
        failed.push({
          objectPath: candidate.objectPath,
          error: error instanceof Error ? error.message : "Unknown storage error",
        });
      }
    }

    return { deleted, skippedReferenced, failed };
  });
  console.log(JSON.stringify({ cleanup: outcome }, null, 2));
  if (outcome.failed.length > 0) process.exitCode = 1;
}

await pool.end();