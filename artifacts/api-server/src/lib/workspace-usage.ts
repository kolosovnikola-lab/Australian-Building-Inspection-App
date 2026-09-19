import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Request } from "express";
import { db, findingMediaTable, findingsTable, inspectionsTable, workspaceUsageEventsTable } from "@workspace/db";
import { isWorkspaceManager } from "../middlewares/inspectorAuth";

export type WorkspacePlan = "solo" | "team" | "practice";
export type WorkspaceBillingPeriod = "monthly" | "annual";

const GIGABYTE = 1_000_000_000;

export const PLAN_LIMITS: Record<WorkspacePlan, Record<WorkspaceBillingPeriod, {
  inspections: number;
  reports: number;
  aiAssists: number;
  storageBytes: number;
  seats: number;
}>> = {
  solo: {
    monthly: { inspections: 12, reports: 12, aiAssists: 40, storageBytes: 10 * GIGABYTE, seats: 1 },
    annual: { inspections: 150, reports: 150, aiAssists: 500, storageBytes: 10 * GIGABYTE, seats: 1 },
  },
  team: {
    monthly: { inspections: 45, reports: 45, aiAssists: 200, storageBytes: 100 * GIGABYTE, seats: 5 },
    annual: { inspections: 600, reports: 600, aiAssists: 2_400, storageBytes: 100 * GIGABYTE, seats: 5 },
  },
  practice: {
    monthly: { inspections: 120, reports: 120, aiAssists: 600, storageBytes: 500 * GIGABYTE, seats: 15 },
    annual: { inspections: 1_800, reports: 1_800, aiAssists: 8_000, storageBytes: 500 * GIGABYTE, seats: 15 },
  },
};

const PLAN_NAMES: Record<WorkspacePlan, string> = {
  solo: "Solo",
  team: "Team",
  practice: "Practice",
};

function periodBounds(now: Date, billingPeriod: WorkspaceBillingPeriod) {
  if (billingPeriod === "annual") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)) };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

function metricStatus(used: number, limit: number) {
  if (used >= limit) return "at_limit" as const;
  if (used / limit >= 0.8) return "warning" as const;
  return "healthy" as const;
}

function metric(key: string, label: string, used: number, limit: number, unit: string) {
  return {
    key,
    label,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    unit,
    percentUsed: Math.min(Math.round((used / limit) * 100), 100),
    status: metricStatus(used, limit),
  };
}

function usageOwnerCondition(req: Request) {
  return isWorkspaceManager(req)
    ? undefined
    : eq(inspectionsTable.ownerId, req.inspectorUserId!);
}

export async function recordWorkspaceUsageEvent(workspaceId: string, eventType: string, quantity = 1) {
  await db.insert(workspaceUsageEventsTable).values({ workspaceId, eventType, quantity });
}

export async function getWorkspaceUsage(req: Request) {
  const plan = req.workspacePlan ?? "solo";
  const billingPeriod = req.workspaceBillingPeriod ?? "monthly";
  const limits = PLAN_LIMITS[plan][billingPeriod];
  const now = new Date();
  const { start, end } = periodBounds(now, billingPeriod);
  const ownerCondition = usageOwnerCondition(req);
  const inspectionScope = ownerCondition ? and(ownerCondition) : undefined;
  const createdInspectionWhere = inspectionScope
    ? and(inspectionScope, gte(inspectionsTable.createdAt, start), sql`${inspectionsTable.createdAt} < ${end}`)
    : and(gte(inspectionsTable.createdAt, start), sql`${inspectionsTable.createdAt} < ${end}`);
  const readyReportWhere = inspectionScope
    ? and(inspectionScope, isNotNull(inspectionsTable.reportReadyAt), gte(inspectionsTable.reportReadyAt, start), sql`${inspectionsTable.reportReadyAt} < ${end}`)
    : and(isNotNull(inspectionsTable.reportReadyAt), gte(inspectionsTable.reportReadyAt, start), sql`${inspectionsTable.reportReadyAt} < ${end}`);

  const [[inspectionUsage], [reportUsage], [storageUsage], [seatUsage]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(inspectionsTable).where(createdInspectionWhere),
    db.select({ count: sql<number>`count(*)::int` }).from(inspectionsTable).where(readyReportWhere),
    db.select({ bytes: sql<number>`coalesce(sum(${findingMediaTable.sizeBytes}), 0)::bigint` })
      .from(findingMediaTable)
      .innerJoin(findingsTable, eq(findingsTable.id, findingMediaTable.findingId))
      .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
      .where(inspectionScope),
    db.select({ seatsUsed: sql<number>`count(distinct ${inspectionsTable.ownerId})::int` })
      .from(inspectionsTable)
      .where(inspectionScope),
  ]);
  const inspectionsUsed = inspectionUsage?.count ?? 0;
  const reportsUsed = reportUsage?.count ?? 0;
  const storageBytes = storageUsage?.bytes ?? 0;
  const seatsUsed = seatUsage?.seatsUsed ?? 0;

  const aiWhere = req.workspaceId
    ? and(
      eq(workspaceUsageEventsTable.workspaceId, req.workspaceId),
      eq(workspaceUsageEventsTable.eventType, "ai_assist"),
      gte(workspaceUsageEventsTable.createdAt, start),
      sql`${workspaceUsageEventsTable.createdAt} < ${end}`,
    )
    : undefined;
  const [aiUsage] = await db.select({
    count: sql<number>`coalesce(sum(${workspaceUsageEventsTable.quantity}), 0)::int`,
  }).from(workspaceUsageEventsTable).where(aiWhere);
  const aiAssistsUsed = aiUsage?.count ?? 0;

  const metrics = [
    metric("inspections", "Inspections", Number(inspectionsUsed ?? 0), limits.inspections, "records"),
    metric("reports", "Reports ready", Number(reportsUsed ?? 0), limits.reports, "reports"),
    metric("storage", "Evidence storage", Number(storageBytes ?? 0), limits.storageBytes, "bytes"),
    metric("seats", "Inspector seats", Number(seatsUsed ?? 0), limits.seats, "seats"),
    metric("ai_assists", "AI assists", Number(aiAssistsUsed ?? 0), limits.aiAssists, "assists"),
  ];
  const warnings = metrics
    .filter((item) => item.status !== "healthy")
    .map((item) => item.status === "at_limit"
      ? `${item.label} has reached the ${item.limit.toLocaleString()} ${item.unit} allowance on the ${PLAN_NAMES[plan]} plan.`
      : `${item.label} is at ${item.percentUsed}% of the ${item.limit.toLocaleString()} ${item.unit} allowance on the ${PLAN_NAMES[plan]} plan.`);

  return {
    plan: { id: plan, name: PLAN_NAMES[plan], billingPeriod },
    period: { startsAt: start.toISOString(), endsAt: end.toISOString() },
    metrics,
    warnings,
  };
}