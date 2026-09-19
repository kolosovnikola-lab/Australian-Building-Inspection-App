import { createHash, randomBytes } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";
import { getPrivateMediaFile } from "./report-media-storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_TTL_MS = 15 * 60_000;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
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

function getObjectHandle(objectPath: string): File {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid object storage path");
  const entityPath = objectPath.slice("/objects/".length);
  if (!entityPath || entityPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid object storage path");
  }
  const { bucketName, objectName } = parseStoragePath(`${privateObjectDirectory()}${entityPath}`);
  return storage.bucket(bucketName).file(objectName);
}

export function isMediaUploadConfigured() {
  return Boolean(process.env.PRIVATE_OBJECT_DIR);
}

export function validateMediaUploadMetadata({
  contentType,
  sizeBytes,
  sha256,
}: {
  contentType: string;
  sizeBytes: number;
  sha256: string;
}) {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error("Only JPEG, PNG, and WebP images can be uploaded");
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_MEDIA_BYTES) {
    throw new Error(`Media must be between 1 byte and ${MAX_MEDIA_BYTES} bytes`);
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error("A SHA-256 checksum is required");
  }
}

export function buildMediaObjectPath({
  inspectionId,
  findingId,
  classification,
}: {
  inspectionId: number;
  findingId: number;
  classification: "client_report" | "private_evidence";
}) {
  return `/objects/finding-media/${inspectionId}/${findingId}/${classification}/${randomBytes(18).toString("hex")}`;
}

export async function createMediaUploadUrl({
  objectPath,
  contentType,
  sha256,
}: {
  objectPath: string;
  contentType: string;
  sha256: string;
}) {
  const file = getObjectHandle(objectPath);
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + SIGNED_URL_TTL_MS,
    contentType,
    extensionHeaders: {
      "x-goog-meta-sha256": sha256.toLowerCase(),
    },
  });
  return { uploadUrl, expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS) };
}

export async function verifyUploadedMedia({
  objectPath,
  expectedContentType,
  expectedSizeBytes,
  expectedSha256,
}: {
  objectPath: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
}) {
  const file = await getPrivateMediaFile(objectPath);
  if (!file) throw new Error("Uploaded media was not found");
  const [metadata] = await file.getMetadata();
  const contentType = String(metadata.contentType ?? "");
  const sizeBytes = Number(metadata.size ?? 0);
  if (contentType !== expectedContentType || sizeBytes !== expectedSizeBytes) {
    throw new Error("Uploaded media metadata did not match the requested upload");
  }
  validateMediaUploadMetadata({ contentType, sizeBytes, sha256: expectedSha256 });

  const digest = await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = file.createReadStream();
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_MEDIA_BYTES) {
        stream.destroy(new Error("Media exceeds the maximum upload size"));
        return;
      }
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
  if (digest !== expectedSha256.toLowerCase()) {
    throw new Error("Uploaded media checksum did not match");
  }
  return { contentType, sizeBytes, sha256: digest };
}

export { ALLOWED_CONTENT_TYPES, MAX_MEDIA_BYTES };