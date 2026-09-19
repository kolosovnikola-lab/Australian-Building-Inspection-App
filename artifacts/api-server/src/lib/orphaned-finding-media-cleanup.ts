import type { StoredFindingMediaObject } from "./report-media-storage";

export type FindingMediaReference = {
  objectPath: string;
  thumbnailObjectPath: string | null;
};

export function referencedFindingMediaPaths(rows: readonly FindingMediaReference[]) {
  const paths = new Set<string>();
  for (const row of rows) {
    paths.add(row.objectPath);
    if (row.thumbnailObjectPath) paths.add(row.thumbnailObjectPath);
  }
  return paths;
}

export function findOrphanedFindingMediaObjects(
  objects: readonly StoredFindingMediaObject[],
  references: ReadonlySet<string>,
  before: Date,
) {
  return objects.filter((object) =>
    object.createdAt.getTime() < before.getTime()
    && !references.has(object.objectPath),
  );
}