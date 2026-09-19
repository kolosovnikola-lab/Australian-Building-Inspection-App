import { Storage, type File } from "@google-cloud/storage";
import { unlink } from "node:fs/promises";
import path from "node:path";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateObjectDirectory(): string {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return directory.endsWith("/") ? directory : `${directory}/`;
}

function parseStoragePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid object storage path");
  }
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

function getPrivateMediaHandle(objectPath: string): File | null {
  if (!objectPath.startsWith("/objects/")) return null;
  const entityPath = objectPath.slice("/objects/".length);
  if (!entityPath || entityPath.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  const { bucketName, objectName } = parseStoragePath(
    `${privateObjectDirectory()}${entityPath}`,
  );
  return storage.bucket(bucketName).file(objectName);
}

function testMediaFilePath(objectPath: string): string | null {
  const root = process.env.NODE_ENV === "test" ? process.env.TEST_MEDIA_STORAGE_DIR : undefined;
  if (!root || !objectPath.startsWith("/objects/")) return null;
  const parts = objectPath.slice("/objects/".length).split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid object storage path");
  }
  return path.join(root, ...parts);
}

export type StoredFindingMediaObject = {
  objectPath: string;
  createdAt: Date;
  sizeBytes: number | null;
};

export function isFindingMediaObjectPath(objectPath: string): boolean {
  return /^\/objects\/finding-media\/[0-9]+\/[0-9]+\/(client_report|private_evidence)\/[a-f0-9]+$/.test(objectPath);
}

export async function listStoredFindingMediaObjects(): Promise<StoredFindingMediaObject[]> {
  const privateDirectory = privateObjectDirectory().replace(/\/+$/, "");
  const { bucketName, objectName: findingMediaDirectory } = parseStoragePath(
    `${privateDirectory}/finding-media`,
  );
  const prefix = `${findingMediaDirectory}/`;
  const [files] = await storage.bucket(bucketName).getFiles({ prefix });
  const privatePrefix = parseStoragePath(privateDirectory).objectName;
  const normalizedPrivatePrefix = privatePrefix.endsWith("/") ? privatePrefix : `${privatePrefix}/`;
  const objects: StoredFindingMediaObject[] = [];

  for (const file of files) {
    if (!file.name.startsWith(normalizedPrivatePrefix)) continue;
    const objectPath = `/objects/${file.name.slice(normalizedPrivatePrefix.length)}`;
    if (!isFindingMediaObjectPath(objectPath)) continue;
    const [metadata] = await file.getMetadata();
    const createdAt = new Date(metadata.timeCreated ?? "");
    if (!Number.isFinite(createdAt.getTime())) continue;
    const parsedSize = Number(metadata.size);
    objects.push({
      objectPath,
      createdAt,
      sizeBytes: Number.isSafeInteger(parsedSize) ? parsedSize : null,
    });
  }

  return objects.sort((left, right) => left.objectPath.localeCompare(right.objectPath));
}

export async function getPrivateMediaFile(objectPath: string): Promise<File | null> {
  const file = getPrivateMediaHandle(objectPath);
  if (!file) return null;
  const [exists] = await file.exists();
  return exists ? file : null;
}

export async function deletePrivateMediaObject(objectPath: string | null | undefined): Promise<void> {
  if (!objectPath) return;
  const testPath = testMediaFilePath(objectPath);
  if (testPath) {
    try {
      await unlink(testPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  const file = getPrivateMediaHandle(objectPath);
  if (!file) throw new Error("Invalid object storage path");
  await file.delete({ ignoreNotFound: true });
}