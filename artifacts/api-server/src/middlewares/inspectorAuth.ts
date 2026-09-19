import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db, findingsTable, inspectionsTable, potentialDefectsTable } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      inspectorUserId?: string;
      inspectorRole?: string;
      inspectorDisplayName?: string;
      workspaceId?: string;
      workspacePlan?: "solo" | "team" | "practice";
      workspaceBillingPeriod?: "monthly" | "annual";
    }
  }
}

const displayNameCache = new Map<string, { value: string; expiresAt: number }>();

function safeDisplayName(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 120)
    .trim();
}

async function resolveClerkDisplayName(userId: string) {
  const cached = displayNameCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const user = await clerkClient.users.getUser(userId);
  const value = safeDisplayName(
    [user.firstName, user.lastName].filter(Boolean).join(" ")
      || user.username
      || user.primaryEmailAddress?.emailAddress
      || "Inspector",
  ) || "Inspector";
  displayNameCache.set(userId, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

async function populateInspectorIdentity(req: Parameters<RequestHandler>[0]) {
  const testUserId = process.env.NODE_ENV === "test"
    ? req.header("x-test-user-id")
    : undefined;
  const auth = getAuth(req);
  const userId = testUserId || auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) return false;
  req.inspectorUserId = String(userId);
  const claims = (auth?.sessionClaims ?? {}) as Record<string, unknown>;
  const metadata = (claims.metadata ?? {}) as Record<string, unknown>;
  const testDisplayName = process.env.NODE_ENV === "test"
    ? req.header("x-test-user-name")
    : undefined;
  const firstName = String(claims.firstName ?? claims.first_name ?? "").trim();
  const lastName = String(claims.lastName ?? claims.last_name ?? "").trim();
  const claimDisplayName = String(
    claims.fullName ?? claims.full_name ?? claims.name ?? `${firstName} ${lastName}`,
  ).trim();
  let displayName = safeDisplayName(testDisplayName || claimDisplayName);
  if (!displayName && process.env.NODE_ENV !== "test") {
    try {
      displayName = await resolveClerkDisplayName(String(userId));
    } catch {
      req.log?.warn("Could not resolve inspector display name from Clerk");
    }
  }
  req.inspectorDisplayName = displayName || "Inspector";
  req.inspectorRole = process.env.NODE_ENV === "test"
    ? req.header("x-test-user-role") || "inspector"
    : String((auth?.sessionClaims?.metadata as { role?: string } | undefined)?.role || "inspector");
  const claimedWorkspaceId = String(
    claims.org_id
      ?? claims.organization_id
      ?? claims.organizationId
      ?? "",
  ).trim();
  const workspaceId = process.env.NODE_ENV === "test"
    ? req.header("x-test-workspace-id")?.trim()
    : claimedWorkspaceId;
  req.workspaceId = workspaceId || String(userId);
  const claimedPlan = String(
    process.env.NODE_ENV === "test"
      ? req.header("x-test-plan") || ""
      : metadata.plan ?? claims.plan ?? "",
  ).trim();
  req.workspacePlan = claimedPlan === "team" || claimedPlan === "practice" ? claimedPlan : "solo";
  const claimedBillingPeriod = String(
    process.env.NODE_ENV === "test"
      ? req.header("x-test-billing-period") || ""
      : metadata.billingPeriod ?? claims.billingPeriod ?? "",
  ).trim();
  req.workspaceBillingPeriod = claimedBillingPeriod === "annual" ? "annual" : "monthly";
  return true;
}

export const populateOptionalInspectorAuth: RequestHandler = async (req, _res, next) => {
  await populateInspectorIdentity(req);
  next();
};

export const requireInspectorAuth: RequestHandler = async (req, res, next) => {
  const authenticated = await populateInspectorIdentity(req);
  const userId = req.inspectorUserId;
  if (!authenticated || !userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

export function isWorkspaceManager(req: Parameters<RequestHandler>[0]) {
  return req.inspectorRole === "admin" || req.inspectorRole === "manager";
}

export const requireWorkspaceManager: RequestHandler = (req, res, next) => {
  if (!isWorkspaceManager(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};

export const requireWorkspaceAdmin = requireWorkspaceManager;

export const authorizeInspectorResource: RequestHandler = async (req, res, next) => {
  const userId = req.inspectorUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const inspectionMatch = req.path.match(/^\/inspections\/(\d+)/);
  const findingMatch = req.path.match(/^\/findings\/(\d+)/);
  const defectMatch = req.path.match(/^\/potential-defects\/(\d+)/);
  let permitted = true;
  if (inspectionMatch && !(isWorkspaceManager(req) && req.method === "GET")) {
    const [row] = await db.select({ id: inspectionsTable.id }).from(inspectionsTable).where(and(
      eq(inspectionsTable.id, Number(inspectionMatch[1])),
      eq(inspectionsTable.ownerId, userId),
    ));
    permitted = Boolean(row);
  } else if (findingMatch && !(isWorkspaceManager(req) && req.method === "GET")) {
    const [row] = await db.select({ id: findingsTable.id }).from(findingsTable)
      .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
      .where(and(eq(findingsTable.id, Number(findingMatch[1])), eq(inspectionsTable.ownerId, userId)));
    permitted = Boolean(row);
  } else if (defectMatch && !(isWorkspaceManager(req) && req.method === "GET")) {
    const [row] = await db.select({ id: potentialDefectsTable.id }).from(potentialDefectsTable)
      .innerJoin(inspectionsTable, eq(inspectionsTable.id, potentialDefectsTable.inspectionId))
      .where(and(eq(potentialDefectsTable.id, Number(defectMatch[1])), eq(inspectionsTable.ownerId, userId)));
    permitted = Boolean(row);
  }
  if (!permitted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
};