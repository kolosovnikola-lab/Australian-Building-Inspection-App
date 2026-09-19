import { Router, type IRouter, type Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { checklistTable, clientLanguageGlossaryEventsTable, clientLanguageGlossaryTable, db, findingMediaTable, findingsTable, inspectionsTable, potentialDefectsTable, reportDeliveryEventsTable, standardsTable } from "@workspace/db";
import {
  CreateFindingBody,
  CreateFindingParams,
  CreateFindingResponse,
  CreateInspectionBody,
  CreateInspectionResponse,
  CreatePotentialDefectBody,
  CreatePotentialDefectParams,
  CreatePotentialDefectResponse,
  GetDashboardResponse,
  GetInspectionParams,
  GetInspectionResponse,
  ListInspectionsQueryParams,
  ListInspectionsResponse,
  ListPotentialDefectsParams,
  ListPotentialDefectsResponse,
  ListChecklistQueryParams,
  ListChecklistResponse,
  ListStandardsQueryParams,
  ListStandardsResponse,
  GetReportReadinessParams,
  GetReportReadinessResponse,
  GetSharedReportParams,
  GetSharedReportResponse,
  ListReportDeliveryHistoryParams,
  ListReportDeliveryHistoryResponse,
  MarkReportViewedParams,
  MarkReportViewedResponse,
  MarkReportReadyParams,
  MarkReportReadyResponse,
  ShareReportBody,
  ShareReportParams,
  ShareReportResponse,
  PreviewReportTranslationBody,
  PreviewReportTranslationParams,
  PreviewReportTranslationResponse,
  GetWorkspaceUsageResponse,
  RevokeReportLinkParams,
  RevokeReportLinkBody,
  RevokeReportLinkResponse,
  RotateReportLinkParams,
  RotateReportLinkBody,
  RotateReportLinkResponse,
  RecoverReportLinkParams,
  RecoverReportLinkResponse,
  ListClientLanguageGlossaryResponse,
  ListManagedClientLanguageGlossaryResponse,
  ListClientLanguageGlossaryHistoryResponse,
  CreateClientLanguageGlossaryTermBody,
  CreateClientLanguageGlossaryTermResponse,
  UpdateClientLanguageGlossaryTermParams,
  UpdateClientLanguageGlossaryTermBody,
  UpdateClientLanguageGlossaryTermResponse,
  UpdateFindingBody,
  UpdateFindingParams,
  UpdateFindingResponse,
  UpdateInspectionBody,
  UpdateInspectionParams,
  UpdateInspectionResponse,
  UpdatePotentialDefectBody,
  UpdatePotentialDefectParams,
  UpdatePotentialDefectResponse,
  RequestFindingMediaUploadBody,
  RequestFindingMediaUploadResponse,
  CompleteFindingMediaUploadBody,
  CompleteFindingMediaUploadResponse,
  UpdateFindingMediaClassificationBody,
  UpdateFindingMediaClassificationParams,
  UpdateFindingMediaClassificationResponse,
  DeleteFindingMediaParams,
  DeleteFindingMediaResponse,
} from "@workspace/api-zod";
import {
  getReportReadiness,
  DEFAULT_CLIENT_LANGUAGE_GLOSSARY,
  invalidateReportDelivery,
  toClientReportFindings,
  toClientPlainLanguageSummary,
  getReportMediaObjectPath,
} from "./report-policy";
import {
  REPORT_SUMMARY_LANGUAGES,
  parseStoredTranslations,
  reportTranslationNotice,
  translateApprovedExplanations,
  type ReportSummaryLanguage,
} from "../lib/report-translation";
import { deletePrivateMediaObject, getPrivateMediaFile } from "../lib/report-media-storage";
import {
  buildMediaObjectPath,
  createMediaUploadUrl,
  isMediaUploadConfigured,
  validateMediaUploadMetadata,
  verifyUploadedMedia,
} from "../lib/report-media-upload";
import { getReportEmailEvent, ReportEmailSubmissionError, sendReportEmail } from "../lib/report-email";
import { isWorkspaceManager, requireWorkspaceManager } from "../middlewares/inspectorAuth";
import { getWorkspaceUsage } from "../lib/workspace-usage";

const router: IRouter = Router();
const LEGACY_UNASSIGNED_OWNER = "legacy_unassigned";

router.get("/admin/inspectors", requireWorkspaceManager, async (_req, res): Promise<void> => {
  if (process.env.NODE_ENV === "test") {
    res.json([
      { id: "inspector-a", displayName: "Inspector A", email: "inspector-a@example.test", role: "inspector" },
      { id: "inspector-b", displayName: "Inspector B", email: "inspector-b@example.test", role: "inspector" },
    ]);
    return;
  }
  const users = await clerkClient.users.getUserList({ limit: 100, orderBy: "-created_at" });
  res.json(users.data.map((user) => ({
    id: user.id,
    displayName: safeInspectorDisplayName(user),
    email: user.primaryEmailAddress?.emailAddress ?? null,
    role: workspaceRole(user),
  })));
});

router.get("/admin/legacy-inspections", requireWorkspaceManager, async (_req, res): Promise<void> => {
  const rows = await db.select().from(inspectionsTable)
    .where(eq(inspectionsTable.ownerId, LEGACY_UNASSIGNED_OWNER))
    .orderBy(desc(inspectionsTable.updatedAt));
  res.json(ListInspectionsResponse.parse(await Promise.all(rows.map(inspectionWithCounts))));
});

router.post("/admin/legacy-inspections/:id/claim", requireWorkspaceManager, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid inspection id" });
    return;
  }
  const happenedAt = new Date();
  const inspection = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(inspectionsTable).where(and(
      eq(inspectionsTable.id, id),
      eq(inspectionsTable.ownerId, LEGACY_UNASSIGNED_OWNER),
    )).for("update");
    if (!current) return null;
    const [updated] = await tx.update(inspectionsTable).set({
      ownerId: req.inspectorUserId!,
      ...(current.reportShareToken ? invalidateReportDelivery : {}),
      updatedAt: happenedAt,
    }).where(eq(inspectionsTable.id, id)).returning();
    if (!updated) return null;
    await tx.insert(reportDeliveryEventsTable).values({
      inspectionId: id,
      eventType: "inspection_assigned",
      reason: "legacy_claimed",
      ...inspectorActor(req),
      createdAt: happenedAt,
    });
    if (current.reportShareToken) {
      await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: id,
        eventType: "automatically_invalidated",
        recipientType: current.reportRecipientType,
        recipientEmail: current.reportRecipientEmail,
        previousTokenDigest: tokenDigest(current.reportShareToken),
        reason: "inspection_reassigned",
        ...inspectorActor(req),
        createdAt: happenedAt,
      });
    }
    return updated;
  });
  if (!inspection) {
    res.status(404).json({ error: "Legacy inspection not found" });
    return;
  }
  res.json(GetInspectionResponse.parse({
    ...(await inspectionWithCounts(inspection)),
    findings: await findingsWithDerivedMediaCounts(inspection.id),
  }));
});

const workspaceRole = (user: {
  publicMetadata?: Record<string, unknown>;
}) => {
  const role = String(user.publicMetadata?.role ?? "inspector");
  return ["inspector", "manager", "admin"].includes(role) ? role : "inspector";
};

const safeInspectorDisplayName = (user: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
}) => {
  const value = [user.firstName, user.lastName].filter(Boolean).join(" ")
    || user.username
    || user.primaryEmailAddress?.emailAddress
    || "Inspector";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120).trim() || "Inspector";
};

async function isAssignableWorkspaceUser(ownerId: string) {
  if (process.env.NODE_ENV === "test") return true;
  try {
    const user = await clerkClient.users.getUser(ownerId);
    return workspaceRole(user) === "inspector"
      || workspaceRole(user) === "manager"
      || workspaceRole(user) === "admin";
  } catch {
    return false;
  }
}

router.patch("/admin/inspections/:id/assignment", requireWorkspaceManager, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const ownerId = typeof req.body?.ownerId === "string" ? req.body.ownerId.trim() : "";
  if (!Number.isInteger(id) || id <= 0 || !ownerId) {
    res.status(400).json({ error: "A valid inspection id and inspector ownerId are required." });
    return;
  }
  if (!(await isAssignableWorkspaceUser(ownerId))) {
    res.status(400).json({ error: "That account is not an eligible SiteCheck inspector." });
    return;
  }

  const assigned = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(inspectionsTable).where(eq(inspectionsTable.id, id)).for("update");
    if (!current) return null;
    if (current.ownerId === ownerId) return current;

    const happenedAt = new Date();
    const [updated] = await tx.update(inspectionsTable).set({
      ownerId,
       ...(current.reportShareToken ? invalidateReportDelivery : {}),
      updatedAt: happenedAt,
    }).where(eq(inspectionsTable.id, id)).returning();
    if (!updated) return null;

    await tx.insert(reportDeliveryEventsTable).values({
      inspectionId: id,
      eventType: "inspection_assigned",
      reason: current.ownerId === LEGACY_UNASSIGNED_OWNER ? "legacy_claimed" : "inspection_reassigned",
      ...inspectorActor(req),
      createdAt: happenedAt,
    });
    if (current.reportShareToken) {
      await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: id,
        eventType: "automatically_invalidated",
        recipientType: current.reportRecipientType,
        recipientEmail: current.reportRecipientEmail,
        previousTokenDigest: tokenDigest(current.reportShareToken),
        reason: "inspection_reassigned",
        ...inspectorActor(req),
        createdAt: happenedAt,
      });
    }
    return updated;
  });
  if (!assigned) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  res.json(UpdateInspectionResponse.parse(await inspectionWithCounts(assigned)));
});

const toDate = (value: Date | string): string | Date => value;
const tokenDigest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const inspectorActor = (req: Request) => ({
  actorId: req.inspectorUserId!,
  actorDisplayName: req.inspectorDisplayName || "Inspector",
});

async function refreshDelivery(inspection: typeof inspectionsTable.$inferSelect) {
  const reconcilingViewedDelivery = inspection.deliveryStatus === "viewed" && !inspection.reportDeliveredAt;
  if (!inspection.reportDeliveryProviderId || !inspection.reportDeliveryAttemptId || (inspection.deliveryStatus !== "sent" && !reconcilingViewedDelivery)) return inspection;
  const providerId = inspection.reportDeliveryProviderId;
  const attemptId = inspection.reportDeliveryAttemptId;
  try {
    const event = await getReportEmailEvent(providerId);
    const delivered = event === "delivered";
    const failed = ["bounced", "complained", "failed", "canceled"].includes(event ?? "");
    if (!delivered && !failed) return inspection;
    if (inspection.deliveryStatus === "viewed") {
      if (!delivered) return inspection;
      const [updated] = await db.update(inspectionsTable).set({
        reportDeliveredAt: new Date(),
      }).where(and(
        eq(inspectionsTable.id, inspection.id),
        eq(inspectionsTable.reportDeliveryProviderId, providerId),
        eq(inspectionsTable.reportDeliveryAttemptId, attemptId),
        eq(inspectionsTable.deliveryStatus, "viewed"),
        isNull(inspectionsTable.reportDeliveredAt),
      )).returning();
      return updated ?? inspection;
    }
    const [updated] = await db.update(inspectionsTable).set({
      deliveryStatus: delivered ? "delivered" : "failed",
      reportDeliveredAt: delivered ? (inspection.reportDeliveredAt ?? new Date()) : inspection.reportDeliveredAt,
      reportDeliveryError: failed ? `Email provider reported: ${event}.` : null,
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportDeliveryProviderId, providerId),
      eq(inspectionsTable.reportDeliveryAttemptId, attemptId),
      eq(inspectionsTable.deliveryStatus, "sent"),
    )).returning();
    return updated ?? inspection;
  } catch {
    return inspection;
  }
}

async function inspectionWithCounts(inspection: typeof inspectionsTable.$inferSelect) {
  const [counts] = await db
    .select({
      findingsCount: sql<number>`count(${findingsTable.id})::int`,
      highRiskCount: sql<number>`count(*) filter (where ${findingsTable.severity} in ('critical', 'high'))::int`,
    })
    .from(findingsTable)
    .where(eq(findingsTable.inspectionId, inspection.id));

  return {
    ...inspection,
    inspectionDate: toDate(inspection.inspectionDate),
    findingsCount: Number(counts?.findingsCount ?? 0),
    highRiskCount: Number(counts?.highRiskCount ?? 0),
  };
}

async function ensureClientLanguageGlossary(workspaceId: string) {
  const existing = await db.select().from(clientLanguageGlossaryTable)
    .where(eq(clientLanguageGlossaryTable.workspaceId, workspaceId))
    .orderBy(asc(clientLanguageGlossaryTable.id));
  if (existing.length > 0) return existing;
  const seeded = await db.insert(clientLanguageGlossaryTable).values(
    DEFAULT_CLIENT_LANGUAGE_GLOSSARY.map(({ term, suggestedMeaning }) => ({
      workspaceId,
      term,
      suggestedMeaning,
      active: true,
    })),
  ).returning();
  return seeded.length > 0 ? seeded : existing;
}

async function activeClientLanguageGlossary(workspaceId?: string) {
  if (!workspaceId) return DEFAULT_CLIENT_LANGUAGE_GLOSSARY;
  const terms = await ensureClientLanguageGlossary(workspaceId);
  return terms
    .filter((term) => term.active)
    .map(({ term, suggestedMeaning }) => ({ term, suggestedMeaning }));
}

function glossaryResponse(term: typeof clientLanguageGlossaryTable.$inferSelect) {
  return {
    id: term.id,
    term: term.term,
    suggestedMeaning: term.suggestedMeaning,
    active: term.active,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

async function reportReadiness(inspection: typeof inspectionsTable.$inferSelect, workspaceId?: string) {
  const findings = await db.select().from(findingsTable).where(eq(findingsTable.inspectionId, inspection.id));
  const media = findings.length
    ? await db.select({
      findingId: findingMediaTable.findingId,
      classification: findingMediaTable.classification,
    }).from(findingMediaTable).where(inArray(
      findingMediaTable.findingId,
      findings.map((finding) => finding.id),
    ))
    : [];
  return getReportReadiness(inspection, findings, media, await activeClientLanguageGlossary(workspaceId));
}

async function approvedReportExplanations(inspectionId: number, findingId?: number) {
  const findings = await db.select({
    id: findingsTable.id,
    title: findingsTable.title,
    clientExplanation: findingsTable.clientExplanation,
  }).from(findingsTable).where(and(
    eq(findingsTable.inspectionId, inspectionId),
    ...(findingId ? [eq(findingsTable.id, findingId)] : []),
  ));
  return findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    text: finding.clientExplanation?.trim() ?? "",
  }));
}

async function findingsWithDerivedMediaCounts(inspectionId: number) {
  const findings = await db.select().from(findingsTable)
    .where(eq(findingsTable.inspectionId, inspectionId))
    .orderBy(asc(findingsTable.createdAt));
  if (!findings.length) return findings;
  const media = await db.select({
    id: findingMediaTable.id,
    findingId: findingMediaTable.findingId,
    classification: findingMediaTable.classification,
    contentType: findingMediaTable.contentType,
    fileName: findingMediaTable.fileName,
    caption: findingMediaTable.caption,
    sizeBytes: findingMediaTable.sizeBytes,
    createdAt: findingMediaTable.createdAt,
  }).from(findingMediaTable).where(inArray(
    findingMediaTable.findingId,
    findings.map((finding) => finding.id),
  )).orderBy(asc(findingMediaTable.createdAt), asc(findingMediaTable.id));
  return findings.map((finding) => {
    const findingMedia = media.filter((item) => item.findingId === finding.id);
    const reportPhotosCount = findingMedia.filter((item) => item.classification === "client_report").length;
    const evidencePhotosCount = findingMedia.filter((item) => item.classification === "private_evidence").length;
    return {
      ...finding,
      photosCount: findingMedia.length,
      reportPhotosCount,
      evidencePhotosCount,
      media: findingMedia.map(({ id, findingId, classification, contentType, fileName, caption, sizeBytes, createdAt }) => ({
        id,
        findingId,
        classification,
        contentType,
        fileName,
        caption,
        sizeBytes,
        createdAt,
      })),
    };
  });
}

async function refreshFindingMediaCounts(tx: any, findingId: number) {
  const [counts] = await tx.select({
    photosCount: sql<number>`count(*)::int`,
    reportPhotosCount: sql<number>`count(*) filter (where ${findingMediaTable.classification} = 'client_report')::int`,
    evidencePhotosCount: sql<number>`count(*) filter (where ${findingMediaTable.classification} = 'private_evidence')::int`,
  }).from(findingMediaTable).where(eq(findingMediaTable.findingId, findingId));
  await tx.update(findingsTable).set({
    photosCount: Number(counts?.photosCount ?? 0),
    reportPhotosCount: Number(counts?.reportPhotosCount ?? 0),
    evidencePhotosCount: Number(counts?.evidencePhotosCount ?? 0),
  }).where(eq(findingsTable.id, findingId));
}

router.get("/dashboard", async (req, res): Promise<void> => {
  const inspections = await db.select().from(inspectionsTable)
    .where(eq(inspectionsTable.ownerId, req.inspectorUserId!))
    .orderBy(desc(inspectionsTable.updatedAt));
  const summaries = await Promise.all(inspections.map(inspectionWithCounts));
  const findings = await db.select({ finding: findingsTable }).from(findingsTable)
    .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
    .where(eq(inspectionsTable.ownerId, req.inspectorUserId!))
    .then((rows) => rows.map((row) => row.finding));
  const severityCounts = {
    critical: findings.filter((finding) => finding.severity === "critical").length,
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    low: findings.filter((finding) => finding.severity === "low").length,
    advisory: findings.filter((finding) => finding.severity === "advisory").length,
  };

  res.json(GetDashboardResponse.parse({
    activeInspections: inspections.filter((inspection) => inspection.status !== "complete").length,
    completedInspections: inspections.filter((inspection) => inspection.status === "complete").length,
    openFindings: findings.filter((finding) => finding.assessment !== "compliant").length,
    highRiskFindings: findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length,
    severityCounts,
    recentInspections: summaries.slice(0, 5),
  }));
});

router.get("/usage", async (req, res): Promise<void> => {
  res.json(GetWorkspaceUsageResponse.parse(await getWorkspaceUsage(req)));
});

router.get("/client-language-glossary", async (req, res): Promise<void> => {
  const terms = await ensureClientLanguageGlossary(req.workspaceId!);
  res.json(ListClientLanguageGlossaryResponse.parse(terms.filter((term) => term.active).map(glossaryResponse)));
});

router.get("/admin/client-language-glossary", requireWorkspaceManager, async (req, res): Promise<void> => {
  const terms = await ensureClientLanguageGlossary(req.workspaceId!);
  res.json(ListManagedClientLanguageGlossaryResponse.parse(terms.map(glossaryResponse)));
});

router.get("/admin/client-language-glossary/history", requireWorkspaceManager, async (req, res): Promise<void> => {
  const events = await db.select().from(clientLanguageGlossaryEventsTable)
    .where(eq(clientLanguageGlossaryEventsTable.workspaceId, req.workspaceId!))
    .orderBy(desc(clientLanguageGlossaryEventsTable.createdAt), desc(clientLanguageGlossaryEventsTable.id))
    .limit(100);
  res.json(ListClientLanguageGlossaryHistoryResponse.parse(events.map((event) => ({
    id: event.id,
    glossaryTermId: event.glossaryTermId,
    action: event.action,
    term: event.term,
    suggestedMeaning: event.suggestedMeaning,
    previousTerm: event.previousTerm,
    previousSuggestedMeaning: event.previousSuggestedMeaning,
    actorDisplayName: event.actorDisplayName,
    happenedAt: event.createdAt,
  }))));
});

router.post("/admin/client-language-glossary", requireWorkspaceManager, async (req, res): Promise<void> => {
  const body = CreateClientLanguageGlossaryTermBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const workspaceId = req.workspaceId!;
  const term = body.data.term.trim().toLowerCase();
  const suggestedMeaning = body.data.suggestedMeaning.trim();
  const existing = await ensureClientLanguageGlossary(workspaceId);
  if (existing.some((item) => item.term.toLowerCase() === term)) {
    res.status(409).json({ error: "That glossary term already exists." });
    return;
  }
  const [created] = await db.transaction(async (tx) => {
    const [next] = await tx.insert(clientLanguageGlossaryTable).values({
      workspaceId,
      term,
      suggestedMeaning,
      active: true,
    }).returning();
    await tx.insert(clientLanguageGlossaryEventsTable).values({
      workspaceId,
      glossaryTermId: next.id,
      action: "added",
      term: next.term,
      suggestedMeaning: next.suggestedMeaning,
      ...inspectorActor(req),
    });
    return [next];
  });
  res.status(201).json(CreateClientLanguageGlossaryTermResponse.parse(glossaryResponse(created)));
});

router.patch("/admin/client-language-glossary/:id", requireWorkspaceManager, async (req, res): Promise<void> => {
  const params = UpdateClientLanguageGlossaryTermParams.safeParse(req.params);
  const body = UpdateClientLanguageGlossaryTermBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.term === undefined && body.data.suggestedMeaning === undefined && body.data.active === undefined) {
    res.status(400).json({ error: "Provide a term, suggested meaning, or active state to update." });
    return;
  }
  const workspaceId = req.workspaceId!;
  const [current] = await db.select().from(clientLanguageGlossaryTable).where(and(
    eq(clientLanguageGlossaryTable.id, params.data.id),
    eq(clientLanguageGlossaryTable.workspaceId, workspaceId),
  ));
  if (!current) {
    res.status(404).json({ error: "Glossary term not found." });
    return;
  }
  const term = body.data.term?.trim().toLowerCase();
  const suggestedMeaning = body.data.suggestedMeaning?.trim();
  const nextTerm = term ?? current.term;
  const duplicate = await db.select({ id: clientLanguageGlossaryTable.id, term: clientLanguageGlossaryTable.term })
    .from(clientLanguageGlossaryTable)
    .where(eq(clientLanguageGlossaryTable.workspaceId, workspaceId));
  if (duplicate.some((item) => item.id !== current.id && item.term.toLowerCase() === nextTerm)) {
    res.status(409).json({ error: "That glossary term already exists." });
    return;
  }
  const [updated] = await db.transaction(async (tx) => {
    const [next] = await tx.update(clientLanguageGlossaryTable).set({
      ...(term !== undefined ? { term } : {}),
      ...(suggestedMeaning !== undefined ? { suggestedMeaning } : {}),
      ...(body.data.active !== undefined ? { active: body.data.active } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(clientLanguageGlossaryTable.id, current.id),
      eq(clientLanguageGlossaryTable.workspaceId, workspaceId),
    )).returning();
    const action = body.data.active !== undefined && body.data.active !== current.active
      ? body.data.active ? "restored" : "retired"
      : "edited";
    await tx.insert(clientLanguageGlossaryEventsTable).values({
      workspaceId,
      glossaryTermId: next.id,
      action,
      term: next.term,
      suggestedMeaning: next.suggestedMeaning,
      previousTerm: action === "edited" ? current.term : null,
      previousSuggestedMeaning: action === "edited" ? current.suggestedMeaning : null,
      ...inspectorActor(req),
    });
    return [next];
  });
  res.json(UpdateClientLanguageGlossaryTermResponse.parse(glossaryResponse(updated)));
});

router.get("/inspections", async (req, res): Promise<void> => {
  const query = ListInspectionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters = req.inspectorUserId && !isWorkspaceManager(req)
    ? [eq(inspectionsTable.ownerId, req.inspectorUserId)]
    : [];
  if (query.data.status) filters.push(eq(inspectionsTable.status, query.data.status));
  if (query.data.search) {
    const searchFilter = or(
      ilike(inspectionsTable.title, `%${query.data.search}%`),
      ilike(inspectionsTable.propertyAddress, `%${query.data.search}%`),
      ilike(inspectionsTable.clientName, `%${query.data.search}%`),
    );
    if (searchFilter) filters.push(searchFilter);
  }

  const inspections = await db
    .select()
    .from(inspectionsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(inspectionsTable.updatedAt));
  const data = await Promise.all(inspections.map(inspectionWithCounts));
  if (!req.inspectorUserId) {
    res.json(data.map((inspection) => ({
      id: inspection.id,
      title: inspection.title,
      propertyAddress: inspection.propertyAddress,
      inspectionDate: inspection.inspectionDate,
      inspectorName: inspection.inspectorName,
      reportType: inspection.reportType,
      status: inspection.status,
      findingsCount: inspection.findingsCount,
      highRiskCount: inspection.highRiskCount,
      updatedAt: inspection.updatedAt,
    })));
    return;
  }
  res.json(ListInspectionsResponse.parse(data));
});

router.post("/inspections", async (req, res): Promise<void> => {
  const body = CreateInspectionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [inspection] = await db.insert(inspectionsTable).values({
    ...body.data,
    ownerId: req.inspectorUserId!,
    inspectionDate: body.data.inspectionDate.toISOString().slice(0, 10),
    status: body.data.status ?? "draft",
  }).returning();
  res.status(201).json(CreateInspectionResponse.parse(await inspectionWithCounts(inspection)));
});

router.get("/inspections/:id", async (req, res): Promise<void> => {
  const params = GetInspectionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [storedInspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  const inspection = storedInspection ? await refreshDelivery(storedInspection) : undefined;
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }

  const findings = await findingsWithDerivedMediaCounts(inspection.id);
  const data = {
    ...(await inspectionWithCounts(inspection)),
    findings,
  };
  res.json(GetInspectionResponse.parse(data));
});

router.patch("/inspections/:id", async (req, res): Promise<void> => {
  const params = UpdateInspectionParams.safeParse(req.params);
  const body = UpdateInspectionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const changesReport = ["title", "propertyAddress", "clientName", "inspectionDate", "inspectorName", "status", "reportType"]
    .some((key) => body.data[key as keyof typeof body.data] !== undefined);
  const updates: Partial<typeof inspectionsTable.$inferInsert> = { ...(changesReport ? invalidateReportDelivery : {}), updatedAt: new Date() };
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.propertyAddress !== undefined) updates.propertyAddress = body.data.propertyAddress;
  if (body.data.clientName !== undefined) updates.clientName = body.data.clientName;
  if (body.data.clientEmail !== undefined) updates.clientEmail = body.data.clientEmail;
  if (body.data.agentEmail !== undefined) updates.agentEmail = body.data.agentEmail;
  if (body.data.inspectionDate !== undefined) updates.inspectionDate = body.data.inspectionDate.toISOString().slice(0, 10);
  if (body.data.inspectorName !== undefined) updates.inspectorName = body.data.inspectorName;
  if (body.data.status !== undefined) updates.status = body.data.status;
  const inspection = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id)).for("update");
    const [updated] = await tx.update(inspectionsTable).set(updates).where(eq(inspectionsTable.id, params.data.id)).returning();
    if (current?.reportShareToken) {
      await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: current.id, eventType: "automatically_invalidated",
        recipientType: current.reportRecipientType, recipientEmail: current.reportRecipientEmail,
        previousTokenDigest: tokenDigest(current.reportShareToken), reason: "inspection_edited",
        ...inspectorActor(req),
      });
    }
    return updated;
  });
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  res.json(UpdateInspectionResponse.parse(await inspectionWithCounts(inspection)));
});

router.get("/inspections/:id/report/readiness", async (req, res): Promise<void> => {
  const params = GetReportReadinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  res.json(GetReportReadinessResponse.parse(await reportReadiness(inspection, req.workspaceId)));
});

router.post("/inspections/:id/report/ready", async (req, res): Promise<void> => {
  const params = MarkReportReadyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const readiness = await reportReadiness(inspection, req.workspaceId);
  if (!readiness.ready) {
    res.status(409).json({ error: "Complete every report readiness check before marking the report ready.", readiness });
    return;
  }
  const [updated] = await db.update(inspectionsTable).set({ reportStatus: "ready", reportReadyAt: new Date(), updatedAt: new Date() }).where(eq(inspectionsTable.id, inspection.id)).returning();
  res.json(MarkReportReadyResponse.parse(await inspectionWithCounts(updated)));
});

router.post("/inspections/:id/report/translation-preview", async (req, res): Promise<void> => {
  const params = PreviewReportTranslationParams.safeParse(req.params);
  const body = PreviewReportTranslationBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const readiness = await reportReadiness(inspection, req.workspaceId);
  if (!readiness.ready) {
    res.status(409).json({ error: "Complete every report readiness check before reviewing a translation.", readiness });
    return;
  }
  const explanations = await approvedReportExplanations(inspection.id, body.data.findingId);
  if (!explanations.length || explanations.some((explanation) => !explanation.text)) {
    res.status(409).json({ error: "Every finding needs an approved plain-language explanation before translation." });
    return;
  }
  try {
    const translations = await translateApprovedExplanations(
      body.data.summaryLanguage as ReportSummaryLanguage,
      explanations.map(({ id, text }) => ({ id, text })),
      process.env.NODE_ENV === "test"
        ? (() => {
          const mode = req.header("x-test-report-translation");
          return mode === "deterministic" || mode === "failure" || mode === "malformed" ? mode : undefined;
        })()
        : undefined,
    );
    res.json(PreviewReportTranslationResponse.parse({
      summaryLanguage: body.data.summaryLanguage,
      authorityNotice: reportTranslationNotice,
      translations: translations.map((translation) => {
        const source = explanations.find((explanation) => explanation.id === translation.id)!;
        return {
          id: translation.id,
          title: source.title,
          sourceText: source.text,
          translatedText: translation.text,
        };
      }),
    }));
  } catch (error) {
    req.log.error({ error, language: body.data.summaryLanguage }, "Report translation preview failed");
    res.status(503).json({ error: `The ${REPORT_SUMMARY_LANGUAGES[body.data.summaryLanguage as ReportSummaryLanguage]} summary is temporarily unavailable.` });
  }
});

router.post("/inspections/:id/report/share", async (req, res): Promise<void> => {
  const params = ShareReportParams.safeParse(req.params);
  const body = ShareReportBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  if (inspection.reportStatus !== "ready") {
    res.status(409).json({ error: "Mark the report ready before sharing it." });
    return;
  }
  const readiness = await reportReadiness(inspection, req.workspaceId);
  if (!readiness.ready) {
    await db.transaction(async (tx) => {
       const [invalidated] = await tx.update(inspectionsTable).set({ ...invalidateReportDelivery, updatedAt: new Date() }).where(and(
        eq(inspectionsTable.id, inspection.id),
        inspection.reportShareToken
          ? eq(inspectionsTable.reportShareToken, inspection.reportShareToken)
          : isNull(inspectionsTable.reportShareToken),
      )).returning();
      if (invalidated && inspection.reportShareToken) await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: inspection.id, eventType: "automatically_invalidated",
        recipientType: inspection.reportRecipientType, recipientEmail: inspection.reportRecipientEmail,
        previousTokenDigest: tokenDigest(inspection.reportShareToken), reason: "readiness_failed",
        ...inspectorActor(req),
      });
    });
    res.status(409).json({ error: "The report changed and no longer passes completion checks.", readiness });
    return;
  }
  const recipientEmail = body.data.recipientType === "client" ? inspection.clientEmail : inspection.agentEmail;
  if (!recipientEmail) {
    res.status(409).json({ error: `Record the ${body.data.recipientType} email on the inspection before sending.` });
    return;
  }
   const reportFindings = await approvedReportExplanations(inspection.id);
  const summaryLanguage = body.data.summaryLanguage as ReportSummaryLanguage;
   let summaryTranslations;
   if (summaryLanguage === "en") {
     summaryTranslations = reportFindings.map(({ id, text }) => ({ id, text }));
   } else {
     const reviewed = body.data.reviewedTranslations ?? [];
     const expectedIds = new Set(reportFindings.map((finding) => finding.id));
     const reviewedIds = new Set(reviewed.map((translation) => translation.id));
     if (
       reviewed.length !== reportFindings.length
       || reviewedIds.size !== expectedIds.size
       || [...expectedIds].some((id) => !reviewedIds.has(id))
     ) {
       res.status(409).json({ error: "Review and accept every translated plain-language explanation before sharing." });
       return;
     }
     summaryTranslations = reviewed.map((translation) => ({
       id: translation.id,
       text: translation.text.trim(),
     }));
   }
  const attemptedAt = new Date();
  const staleBefore = new Date(attemptedAt.getTime() - 2 * 60 * 1000);
  const ambiguousFailedAttempt = inspection.deliveryStatus === "failed" && !inspection.reportDeliveryProviderId;
  const staleSendingAttempt = inspection.deliveryStatus === "sending"
    && Boolean(inspection.reportDeliveryAttemptedAt)
    && inspection.reportDeliveryAttemptedAt! < staleBefore;
  const replayingAmbiguousDelivery = (ambiguousFailedAttempt || staleSendingAttempt)
    && inspection.reportRecipientType === body.data.recipientType
    && inspection.reportRecipientEmail === recipientEmail
    && !inspection.reportDeliveryProviderId
    && Boolean(inspection.reportDeliveryIdempotencyKey)
    && Boolean(inspection.reportShareToken);
  const token = replayingAmbiguousDelivery ? inspection.reportShareToken! : randomBytes(24).toString("hex");
  const idempotencyKey = replayingAmbiguousDelivery ? inspection.reportDeliveryIdempotencyKey! : `report-${inspection.id}-${randomBytes(16).toString("hex")}`;
  const attemptId = randomBytes(16).toString("hex");
  const claimed = await db.transaction(async (tx) => {
    const [nextInspection] = await tx.update(inspectionsTable).set({
      reportShareToken: token,
      reportDeliveryAttemptId: attemptId,
      reportDeliveryIdempotencyKey: idempotencyKey,
      reportRecipientType: body.data.recipientType,
      reportRecipientEmail: recipientEmail,
      reportSummaryLanguage: summaryLanguage,
      reportSummaryTranslations: JSON.stringify(summaryTranslations),
      deliveryStatus: "sending",
      reportDeliveryProviderId: null,
      reportDeliveryError: null,
      reportDeliveryAttemptedAt: attemptedAt,
      reportSharedAt: null,
      reportDeliveredAt: null,
      reportViewedAt: null,
      updatedAt: attemptedAt,
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportStatus, "ready"),
      or(
        ne(inspectionsTable.deliveryStatus, "sending"),
        isNull(inspectionsTable.reportDeliveryAttemptedAt),
        lt(inspectionsTable.reportDeliveryAttemptedAt, staleBefore),
      ),
    )).returning();
    if (!nextInspection) return undefined;
    if (summaryLanguage !== "en") {
      await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: nextInspection.id,
        eventType: "translation_reviewed",
        reviewedSummaryLanguage: summaryLanguage,
        reviewCompletedAt: attemptedAt,
        createdAt: attemptedAt,
        ...inspectorActor(req),
      });
    }
    return nextInspection;
  });
  if (!claimed) {
    res.status(409).json({ error: "This report email is already being sent." });
    return;
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const configuredOrigin = process.env.PUBLIC_APP_URL?.replace(/\/+$/, "").trim();
  const publicOrigin = configuredOrigin || (domain ? `https://${domain}` : "");
  if (!publicOrigin || !/^https:\/\/[^/]+$/i.test(publicOrigin)) {
    await db.update(inspectionsTable).set({
      deliveryStatus: "failed",
      reportDeliveryIdempotencyKey: null,
      reportDeliveryError: "The public app address is not configured.",
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportDeliveryAttemptId, attemptId),
      eq(inspectionsTable.deliveryStatus, "sending"),
    ));
    res.status(500).json({ error: "The public app address is not configured." });
    return;
  }
  const reportUrl = `${publicOrigin}/reports/${token}`;
  let updated: typeof inspectionsTable.$inferSelect | undefined;
  try {
    const delivery = await sendReportEmail({
      to: recipientEmail,
      recipientType: body.data.recipientType,
      clientName: inspection.clientName,
      propertyAddress: inspection.propertyAddress,
      inspectorName: inspection.inspectorName,
      reportNumber: `SC-${String(inspection.id).padStart(4, "0")}`,
      reportUrl,
      idempotencyKey,
    });
    const sentAt = new Date();
    [updated] = await db.update(inspectionsTable).set({
      reportDeliveryProviderId: delivery.id,
      deliveryStatus: "sent",
      reportSharedAt: sentAt,
      reportDeliveryError: null,
      updatedAt: sentAt,
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportShareToken, token),
      eq(inspectionsTable.reportDeliveryAttemptId, attemptId),
      eq(inspectionsTable.deliveryStatus, "sending"),
    )).returning();
    if (updated) {
      await db.insert(reportDeliveryEventsTable).values({
        inspectionId: updated.id,
        eventType: "email_sent",
        recipientType: updated.reportRecipientType,
        recipientEmail: updated.reportRecipientEmail,
        tokenDigest: tokenDigest(token),
        createdAt: sentAt,
        ...inspectorActor(req),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed.";
    const submissionAmbiguous = !(error instanceof ReportEmailSubmissionError) || error.ambiguous;
    [updated] = await db.update(inspectionsTable).set({
      deliveryStatus: "failed",
      reportDeliveryIdempotencyKey: submissionAmbiguous ? idempotencyKey : null,
      reportDeliveryError: message,
      updatedAt: new Date(),
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportShareToken, token),
      eq(inspectionsTable.reportDeliveryAttemptId, attemptId),
      eq(inspectionsTable.deliveryStatus, "sending"),
    )).returning();
    req.log.error({ inspectionId: inspection.id, error: message }, "Report email delivery failed");
    if (updated) {
      await db.insert(reportDeliveryEventsTable).values({
        inspectionId: updated.id,
        eventType: "email_failed",
        recipientType: updated.reportRecipientType,
        recipientEmail: updated.reportRecipientEmail,
        tokenDigest: tokenDigest(token),
        reason: message.slice(0, 500),
        ...inspectorActor(req),
      });
    }
  }
  if (!updated) {
    res.status(409).json({ error: "The report changed while the email was being sent. Its delivery state was not overwritten." });
    return;
  }
  res.json(ShareReportResponse.parse({
    deliveryStatus: updated.deliveryStatus,
    recipientType: updated.reportRecipientType,
    recipientEmail: updated.reportRecipientEmail,
    summaryLanguage: updated.reportSummaryLanguage ?? "en",
    shareUrl: `/reports/${token}`,
    deliveryError: updated.reportDeliveryError,
    attemptedAt: updated.reportDeliveryAttemptedAt,
    sentAt: updated.reportSharedAt,
    deliveredAt: updated.reportDeliveredAt,
    viewedAt: updated.reportViewedAt,
  }));
});

router.post("/inspections/:id/report/revoke", async (req, res): Promise<void> => {
  const params = RevokeReportLinkParams.safeParse(req.params);
  const body = RevokeReportLinkBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  if (
    inspection.reportStatus !== "ready" ||
    !inspection.reportShareToken ||
    inspection.reportShareToken !== body.data.currentShareToken
  ) {
    res.status(409).json({ error: "There is no active report link to revoke." });
    return;
  }
  const currentToken = body.data.currentShareToken;
  const happenedAt = new Date();
  const revoked = await db.transaction(async (tx) => {
    const [nextInspection] = await tx.update(inspectionsTable).set({
      deliveryStatus: "not_shared",
      reportRecipientType: null,
      reportRecipientEmail: null,
      reportShareToken: null,
      reportDeliveryAttemptId: null,
      reportDeliveryIdempotencyKey: null,
      reportDeliveryProviderId: null,
      reportDeliveryError: null,
      reportDeliveryAttemptedAt: null,
      reportSharedAt: null,
      reportDeliveredAt: null,
      reportViewedAt: null,
      updatedAt: happenedAt,
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportStatus, "ready"),
      eq(inspectionsTable.reportShareToken, currentToken),
    )).returning({ id: inspectionsTable.id });
    if (!nextInspection) return false;
    await tx.insert(reportDeliveryEventsTable).values({
      inspectionId: inspection.id,
      eventType: "revoked",
      recipientType: inspection.reportRecipientType,
      recipientEmail: inspection.reportRecipientEmail,
      previousTokenDigest: tokenDigest(currentToken),
      createdAt: happenedAt,
      ...inspectorActor(req),
    });
    return true;
  });
  if (!revoked) {
    res.status(409).json({ error: "The report link changed. Refresh and try again." });
    return;
  }
  res.json(RevokeReportLinkResponse.parse({
    action: "revoked",
    reportStatus: "ready",
    deliveryStatus: "not_shared",
    shareUrl: null,
    happenedAt,
  }));
});

router.post("/inspections/:id/report/rotate", async (req, res): Promise<void> => {
  const params = RotateReportLinkParams.safeParse(req.params);
  const body = RotateReportLinkBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  if (
    inspection.reportStatus !== "ready" ||
    !inspection.reportShareToken ||
    inspection.reportShareToken !== body.data.currentShareToken ||
    !inspection.reportRecipientType ||
    !inspection.reportRecipientEmail
  ) {
    res.status(409).json({ error: "Share the ready report before replacing its link." });
    return;
  }
  const currentToken = body.data.currentShareToken;
  const readiness = await reportReadiness(inspection, req.workspaceId);
  if (!readiness.ready) {
    res.status(409).json({ error: "The report no longer passes completion checks.", readiness });
    return;
  }
  const replacementToken = randomBytes(24).toString("hex");
  const happenedAt = new Date();
  const rotated = await db.transaction(async (tx) => {
    const [nextInspection] = await tx.update(inspectionsTable).set({
      reportShareToken: replacementToken,
      deliveryStatus: "shared",
      reportDeliveryAttemptId: null,
      reportDeliveryIdempotencyKey: null,
      reportDeliveryProviderId: null,
      reportDeliveryError: null,
      reportDeliveryAttemptedAt: null,
      reportSharedAt: happenedAt,
      reportDeliveredAt: null,
      reportViewedAt: null,
      updatedAt: happenedAt,
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportStatus, "ready"),
      eq(inspectionsTable.reportShareToken, currentToken),
    )).returning({ id: inspectionsTable.id });
    if (!nextInspection) return false;
    await tx.insert(reportDeliveryEventsTable).values({
      inspectionId: inspection.id,
      eventType: "rotated",
      recipientType: inspection.reportRecipientType,
      recipientEmail: inspection.reportRecipientEmail,
      tokenDigest: tokenDigest(replacementToken),
      previousTokenDigest: tokenDigest(currentToken),
      createdAt: happenedAt,
      ...inspectorActor(req),
    });
    return true;
  });
  if (!rotated) {
    res.status(409).json({ error: "The report link changed. Refresh and try again." });
    return;
  }
  res.json(RotateReportLinkResponse.parse({
    action: "rotated",
    reportStatus: "ready",
    deliveryStatus: "shared",
    shareUrl: `/reports/${replacementToken}`,
    happenedAt,
  }));
});

router.post("/inspections/:id/report/recover", async (req, res): Promise<void> => {
  const params = RecoverReportLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  if (inspection.reportShareToken || inspection.reportStatus === "ready") {
    res.status(409).json({ error: "This report does not have an automatically invalidated link to recover." });
    return;
  }
  if (!inspection.reportRecipientType || !inspection.reportRecipientEmail) {
    res.status(409).json({ error: "No previously shared client link is available to recover." });
    return;
  }
  const [latestInvalidation] = await db.select({ id: reportDeliveryEventsTable.id })
    .from(reportDeliveryEventsTable)
    .where(and(
      eq(reportDeliveryEventsTable.inspectionId, inspection.id),
      eq(reportDeliveryEventsTable.eventType, "automatically_invalidated"),
    ))
    .orderBy(desc(reportDeliveryEventsTable.createdAt), desc(reportDeliveryEventsTable.id))
    .limit(1);
  if (!latestInvalidation) {
    res.status(409).json({ error: "No previously shared client link is available to recover." });
    return;
  }
  const readiness = await reportReadiness(inspection, req.workspaceId);
  if (!readiness.ready) {
    res.status(409).json({ error: "Complete every report readiness check before generating a replacement link.", readiness });
    return;
  }
  const replacementToken = randomBytes(24).toString("hex");
  const happenedAt = new Date();
  const recovered = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspection.id))
      .for("update");
    if (
      !current
      || current.reportStatus === "ready"
      || current.reportShareToken
      || !current.reportRecipientType
      || !current.reportRecipientEmail
    ) return false;
    const [updated] = await tx.update(inspectionsTable).set({
      reportStatus: "ready",
      reportReadyAt: happenedAt,
      reportShareToken: replacementToken,
      deliveryStatus: "shared",
      reportSummaryLanguage: "en",
      reportSummaryTranslations: null,
      reportDeliveryAttemptId: null,
      reportDeliveryIdempotencyKey: null,
      reportDeliveryProviderId: null,
      reportDeliveryError: null,
      reportDeliveryAttemptedAt: null,
      reportSharedAt: happenedAt,
      reportDeliveredAt: null,
      reportViewedAt: null,
      updatedAt: happenedAt,
    }).where(and(
      eq(inspectionsTable.id, inspection.id),
      eq(inspectionsTable.reportStatus, "draft"),
      isNull(inspectionsTable.reportShareToken),
    )).returning({ id: inspectionsTable.id });
    if (!updated) return false;
    await tx.insert(reportDeliveryEventsTable).values({
      inspectionId: inspection.id,
      eventType: "recovered",
      recipientType: current.reportRecipientType,
      recipientEmail: current.reportRecipientEmail,
      tokenDigest: tokenDigest(replacementToken),
      reason: "recovered_after_invalidation",
      createdAt: happenedAt,
      ...inspectorActor(req),
    });
    return true;
  });
  if (!recovered) {
    res.status(409).json({ error: "The report changed while the replacement link was being generated. Refresh and try again." });
    return;
  }
  res.json(RecoverReportLinkResponse.parse({
    action: "recovered",
    reportStatus: "ready",
    deliveryStatus: "shared",
    shareUrl: `/reports/${replacementToken}`,
    happenedAt,
  }));
});

router.get("/inspections/:id/report/delivery-history", async (req, res): Promise<void> => {
  const params = ListReportDeliveryHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [inspection] = await db.select({ id: inspectionsTable.id }).from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const events = await db.select().from(reportDeliveryEventsTable)
    .where(eq(reportDeliveryEventsTable.inspectionId, inspection.id))
    .orderBy(desc(reportDeliveryEventsTable.createdAt), desc(reportDeliveryEventsTable.id));
  res.json(ListReportDeliveryHistoryResponse.parse(events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    recipientType: event.recipientType,
    recipientEmail: event.recipientEmail,
    reason: event.reason,
    reviewedSummaryLanguage: event.reviewedSummaryLanguage,
    reviewCompletedAt: event.reviewCompletedAt,
    actorDisplayName: event.actorDisplayName,
    createdAt: event.createdAt,
  }))));
});

router.get("/reports/:token", async (req, res): Promise<void> => {
  const params = GetSharedReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [inspection] = await db.select().from(inspectionsTable).where(and(
    eq(inspectionsTable.reportShareToken, params.data.token),
    eq(inspectionsTable.reportStatus, "ready"),
    inArray(inspectionsTable.deliveryStatus, ["shared", "sent", "delivered", "viewed"]),
  ));
  if (!inspection) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  const readiness = await reportReadiness(inspection);
  if (!readiness.ready) {
    await db.transaction(async (tx) => {
       const [invalidated] = await tx.update(inspectionsTable).set({ ...invalidateReportDelivery, updatedAt: new Date() }).where(and(
        eq(inspectionsTable.id, inspection.id),
        inspection.reportShareToken
          ? eq(inspectionsTable.reportShareToken, inspection.reportShareToken)
          : isNull(inspectionsTable.reportShareToken),
      )).returning();
      if (invalidated && inspection.reportShareToken) await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: inspection.id, eventType: "automatically_invalidated",
        recipientType: inspection.reportRecipientType, recipientEmail: inspection.reportRecipientEmail,
        previousTokenDigest: tokenDigest(inspection.reportShareToken), reason: "readiness_failed",
      });
    });
    res.status(404).json({ error: "Report not found" });
    return;
  }
  const findings = await db.select().from(findingsTable).where(eq(findingsTable.inspectionId, inspection.id)).orderBy(asc(findingsTable.createdAt));
  const findingIds = findings.map((finding) => finding.id);
  const media = findingIds.length
    ? await db.select().from(findingMediaTable).where(inArray(findingMediaTable.findingId, findingIds))
    : [];
  const summaryLanguage = (inspection.reportSummaryLanguage ?? "en") as ReportSummaryLanguage;
  const storedTranslations = parseStoredTranslations(inspection.reportSummaryTranslations);
  const summaryTranslations = storedTranslations.length > 0
    ? storedTranslations
    : findings.map((finding) => ({
      id: finding.id,
      text: finding.clientExplanation?.trim() ?? "",
    }));
  res.json(GetSharedReportResponse.parse({
    inspectionId: inspection.id,
    reportNumber: `SC-${String(inspection.id).padStart(4, "0")}`,
    title: inspection.title,
    propertyAddress: inspection.propertyAddress,
    clientName: inspection.clientName,
    inspectionDate: inspection.inspectionDate,
    inspectorName: inspection.inspectorName,
    reportType: inspection.reportType,
    issuedAt: inspection.reportReadyAt ?? inspection.updatedAt,
    summaryLanguage,
    translationNotice: reportTranslationNotice,
    plainLanguageSummary: toClientPlainLanguageSummary(findings, summaryTranslations),
    findings: toClientReportFindings(findings, media, params.data.token),
  }));
});

router.post("/reports/:token", async (req, res): Promise<void> => {
  const params = MarkReportViewedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const viewedAt = new Date();
  const inspection = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(inspectionsTable).where(and(
      eq(inspectionsTable.reportShareToken, params.data.token),
      eq(inspectionsTable.reportStatus, "ready"),
      inArray(inspectionsTable.deliveryStatus, ["shared", "sent", "delivered", "viewed"]),
    ));
    if (!current) return null;
    if (current.reportViewedAt) return current;
    const [viewed] = await tx.update(inspectionsTable).set({
      deliveryStatus: "viewed",
      reportViewedAt: viewedAt,
    }).where(and(
      eq(inspectionsTable.id, current.id),
      eq(inspectionsTable.reportShareToken, params.data.token),
      eq(inspectionsTable.reportStatus, "ready"),
      isNull(inspectionsTable.reportViewedAt),
    )).returning();
    if (!viewed) return null;
    await tx.insert(reportDeliveryEventsTable).values({
      inspectionId: viewed.id,
      eventType: "viewed",
      recipientType: viewed.reportRecipientType,
      recipientEmail: viewed.reportRecipientEmail,
      tokenDigest: tokenDigest(params.data.token),
      createdAt: viewedAt,
    });
    return viewed;
  });
  if (!inspection) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(MarkReportViewedResponse.parse({ viewedAt: inspection.reportViewedAt ?? viewedAt }));
});

router.get("/reports/:token/media/:mediaId/:variant", async (req, res): Promise<void> => {
  const mediaId = Number(req.params.mediaId);
  const variant = req.params.variant;
  if (
    !req.params.token ||
    !Number.isInteger(mediaId) ||
    mediaId <= 0 ||
    (variant !== "original" && variant !== "thumbnail")
  ) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  const [record] = await db
    .select({ media: findingMediaTable, inspection: inspectionsTable })
    .from(findingMediaTable)
    .innerJoin(findingsTable, eq(findingsTable.id, findingMediaTable.findingId))
    .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
    .where(and(
      eq(findingMediaTable.id, mediaId),
      eq(findingMediaTable.classification, "client_report"),
      eq(inspectionsTable.reportShareToken, req.params.token),
      eq(inspectionsTable.reportStatus, "ready"),
    ));
  if (!record) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  const readiness = await reportReadiness(record.inspection);
  const objectPath = getReportMediaObjectPath(record.media, variant);
  if (!readiness.ready || !objectPath) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  try {
    const file = await getPrivateMediaFile(objectPath);
    if (!file) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType || record.media.contentType));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    file.createReadStream()
      .on("error", (error) => {
        req.log.error({ err: error, mediaId }, "Failed to stream report media");
        if (!res.headersSent) res.status(404).end();
        else res.destroy(error);
      })
      .pipe(res);
  } catch (error) {
    req.log.error({ err: error, mediaId }, "Failed to load report media");
    res.status(404).json({ error: "Media not found" });
  }
});

router.post("/inspections/:id/findings", async (req, res): Promise<void> => {
  const params = CreateFindingParams.safeParse(req.params);
  const body = CreateFindingBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [currentInspection] = await tx.select().from(inspectionsTable)
      .where(eq(inspectionsTable.id, params.data.id)).for("update");
    if (body.data.creationRequestId) {
      const [existing] = await tx.select().from(findingsTable).where(and(
        eq(findingsTable.inspectionId, params.data.id),
        eq(findingsTable.creationRequestId, body.data.creationRequestId),
      ));
      if (existing) return { finding: existing, created: false };
    }
    const [created] = await tx.insert(findingsTable).values({
      ...body.data,
      inspectionId: params.data.id,
      reportPhotosCount: 0,
      evidencePhotosCount: 0,
      photosCount: 0,
      backupDestination: body.data.backupDestination ?? "app_only",
    }).returning();
    await tx.update(inspectionsTable).set({ ...invalidateReportDelivery, updatedAt: new Date() }).where(eq(inspectionsTable.id, params.data.id));
    if (currentInspection?.reportShareToken) await tx.insert(reportDeliveryEventsTable).values({
      inspectionId: currentInspection.id, eventType: "automatically_invalidated",
      recipientType: currentInspection.reportRecipientType, recipientEmail: currentInspection.reportRecipientEmail,
      previousTokenDigest: tokenDigest(currentInspection.reportShareToken), reason: "finding_created",
      ...inspectorActor(req),
    });
    return { finding: created, created: true };
  });
  res.status(result.created ? 201 : 200).json(CreateFindingResponse.parse({
    ...result.finding,
    media: [],
  }));
});

router.post("/inspections/:id/media/upload-url", async (req, res): Promise<void> => {
  const params = GetInspectionParams.safeParse(req.params);
  const body = RequestFindingMediaUploadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : (body.error?.message ?? "Invalid request") });
    return;
  }
  if (!isMediaUploadConfigured()) {
    res.status(503).json({ error: "App Storage is not configured" });
    return;
  }
  try {
    validateMediaUploadMetadata(body.data);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid media metadata" });
    return;
  }
  const [finding] = await db
    .select({ id: findingsTable.id })
    .from(findingsTable)
    .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
    .where(and(
      eq(findingsTable.id, body.data.findingId),
      eq(findingsTable.inspectionId, params.data.id),
      eq(inspectionsTable.ownerId, req.inspectorUserId!),
    ));
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  try {
    const objectPath = buildMediaObjectPath({
      inspectionId: params.data.id,
      findingId: body.data.findingId,
      classification: body.data.classification,
    });
    const upload = await createMediaUploadUrl({
      objectPath,
      contentType: body.data.contentType,
      sha256: body.data.sha256,
    });
    res.status(201).json(RequestFindingMediaUploadResponse.parse({ ...upload, objectPath }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create finding media upload URL");
    res.status(503).json({ error: "App Storage is unavailable" });
  }
});

router.post("/inspections/:id/media/complete", async (req, res): Promise<void> => {
  const params = GetInspectionParams.safeParse(req.params);
  const body = CompleteFindingMediaUploadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : (body.error?.message ?? "Invalid request") });
    return;
  }
  const expectedPath = new RegExp(
    `^/objects/finding-media/${params.data.id}/${body.data.findingId}/${body.data.classification}/[a-f0-9]+$`,
  );
  if (!expectedPath.test(body.data.objectPath)) {
    res.status(400).json({ error: "Object path does not match this inspection, finding, or classification" });
    return;
  }
  const [finding] = await db
    .select({ id: findingsTable.id })
    .from(findingsTable)
    .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
    .where(and(
      eq(findingsTable.id, body.data.findingId),
      eq(findingsTable.inspectionId, params.data.id),
      eq(inspectionsTable.ownerId, req.inspectorUserId!),
    ));
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  const [existing] = await db.select()
    .from(findingMediaTable)
    .where(eq(findingMediaTable.objectPath, body.data.objectPath));
  if (existing) {
    if (existing.findingId !== body.data.findingId || existing.classification !== body.data.classification) {
      res.status(409).json({ error: "This upload has already been attached to a different finding" });
      return;
    }
    res.json(CompleteFindingMediaUploadResponse.parse(existing));
    return;
  }
  if (!isMediaUploadConfigured()) {
    res.status(503).json({ error: "App Storage is not configured" });
    return;
  }
  try {
    const verified = await verifyUploadedMedia({
      objectPath: body.data.objectPath,
      expectedContentType: body.data.contentType,
      expectedSizeBytes: body.data.sizeBytes,
      expectedSha256: body.data.sha256,
    });
    const safeFileName = body.data.fileName
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/]/g, "_")
      .trim();
    if (!safeFileName) {
      res.status(400).json({ error: "A file name is required" });
      return;
    }
    const media = await db.transaction(async (tx) => {
      const [lockedFinding] = await tx.select().from(findingsTable)
        .where(eq(findingsTable.id, body.data.findingId))
        .for("update");
      const [inspection] = await tx.select().from(inspectionsTable)
        .where(eq(inspectionsTable.id, params.data.id))
        .for("update");
      if (!lockedFinding || !inspection || inspection.ownerId !== req.inspectorUserId) {
        return null;
      }
      const [created] = await tx.insert(findingMediaTable).values({
        findingId: body.data.findingId,
        classification: body.data.classification,
        objectPath: body.data.objectPath,
        thumbnailObjectPath: null,
        contentType: verified.contentType,
        fileName: safeFileName,
        caption: body.data.caption ?? null,
        sha256: verified.sha256,
        sizeBytes: verified.sizeBytes,
        metadata: { verifiedUpload: true },
      }).returning();
      const reportIncrement = body.data.classification === "client_report" ? 1 : 0;
      const evidenceIncrement = body.data.classification === "private_evidence" ? 1 : 0;
      await tx.update(findingsTable).set({
        photosCount: sql`${findingsTable.photosCount} + 1`,
        reportPhotosCount: sql`${findingsTable.reportPhotosCount} + ${reportIncrement}`,
        evidencePhotosCount: sql`${findingsTable.evidencePhotosCount} + ${evidenceIncrement}`,
      }).where(eq(findingsTable.id, body.data.findingId));
      await tx.update(inspectionsTable)
        .set({ ...invalidateReportDelivery, updatedAt: new Date() })
        .where(eq(inspectionsTable.id, params.data.id));
      if (inspection.reportShareToken) {
        await tx.insert(reportDeliveryEventsTable).values({
          inspectionId: inspection.id,
          eventType: "automatically_invalidated",
          recipientType: inspection.reportRecipientType,
          recipientEmail: inspection.reportRecipientEmail,
          previousTokenDigest: tokenDigest(inspection.reportShareToken),
          reason: "finding_edited",
          ...inspectorActor(req),
        });
      }
      return created;
    });
    if (!media) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }
    res.status(201).json(CompleteFindingMediaUploadResponse.parse(media));
  } catch (error) {
    req.log.warn({ err: error }, "Finding media upload verification failed");
    res.status(409).json({ error: error instanceof Error ? error.message : "Upload verification failed" });
  }
});

router.patch("/findings/:id/media/:mediaId", async (req, res): Promise<void> => {
  const params = UpdateFindingMediaClassificationParams.safeParse(req.params);
  const body = UpdateFindingMediaClassificationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : (body.error?.message ?? "Invalid request") });
    return;
  }
  const [record] = await db.select({
    media: findingMediaTable,
    inspection: inspectionsTable,
  }).from(findingMediaTable)
    .innerJoin(findingsTable, eq(findingsTable.id, findingMediaTable.findingId))
    .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
    .where(and(
      eq(findingMediaTable.id, params.data.mediaId),
      eq(findingMediaTable.findingId, params.data.id),
      eq(inspectionsTable.ownerId, req.inspectorUserId!),
    ));
  if (!record) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [inspection] = await tx.select().from(inspectionsTable)
      .where(eq(inspectionsTable.id, record.inspection.id))
      .for("update");
    const [changed] = await tx.update(findingMediaTable).set({
      classification: body.data.classification,
      ...(body.data.caption !== undefined ? { caption: body.data.caption } : {}),
    }).where(and(
      eq(findingMediaTable.id, record.media.id),
      eq(findingMediaTable.findingId, params.data.id),
    )).returning();
    if (!changed) return null;
    await refreshFindingMediaCounts(tx, params.data.id);
    await tx.update(inspectionsTable).set({ ...invalidateReportDelivery, updatedAt: new Date() })
      .where(eq(inspectionsTable.id, record.inspection.id));
    if (inspection?.reportShareToken) {
      await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: inspection.id,
        eventType: "automatically_invalidated",
        recipientType: inspection.reportRecipientType,
        recipientEmail: inspection.reportRecipientEmail,
        previousTokenDigest: tokenDigest(inspection.reportShareToken),
        reason: "finding_edited",
        ...inspectorActor(req),
      });
    }
    return changed;
  });
  if (!updated) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  res.json(UpdateFindingMediaClassificationResponse.parse(updated));
});

router.delete("/findings/:id/media/:mediaId", async (req, res): Promise<void> => {
  const params = DeleteFindingMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db.select({
    media: findingMediaTable,
    inspection: inspectionsTable,
  }).from(findingMediaTable)
    .innerJoin(findingsTable, eq(findingsTable.id, findingMediaTable.findingId))
    .innerJoin(inspectionsTable, eq(inspectionsTable.id, findingsTable.inspectionId))
    .where(and(
      eq(findingMediaTable.id, params.data.mediaId),
      eq(findingMediaTable.findingId, params.data.id),
      eq(inspectionsTable.ownerId, req.inspectorUserId!),
    ));
  if (!record) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  try {
    await Promise.all([
      deletePrivateMediaObject(record.media.objectPath),
      deletePrivateMediaObject(record.media.thumbnailObjectPath),
    ]);
  } catch (error) {
    req.log.error({ err: error, mediaId: record.media.id }, "Finding media object cleanup failed");
    res.status(503).json({ error: "Media could not be removed from App Storage. Try again." });
    return;
  }
  const deleted = await db.transaction(async (tx) => {
    const [inspection] = await tx.select().from(inspectionsTable)
      .where(eq(inspectionsTable.id, record.inspection.id))
      .for("update");
    const [removed] = await tx.delete(findingMediaTable).where(and(
      eq(findingMediaTable.id, record.media.id),
      eq(findingMediaTable.findingId, params.data.id),
    )).returning({ id: findingMediaTable.id });
    if (!removed) return false;
    await refreshFindingMediaCounts(tx, params.data.id);
    await tx.update(inspectionsTable).set({ ...invalidateReportDelivery, updatedAt: new Date() })
      .where(eq(inspectionsTable.id, record.inspection.id));
    if (inspection?.reportShareToken) {
      await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: inspection.id,
        eventType: "automatically_invalidated",
        recipientType: inspection.reportRecipientType,
        recipientEmail: inspection.reportRecipientEmail,
        previousTokenDigest: tokenDigest(inspection.reportShareToken),
        reason: "finding_edited",
        ...inspectorActor(req),
      });
    }
    return true;
  });
  if (!deleted) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  res.json(DeleteFindingMediaResponse.parse({ id: params.data.mediaId, deleted: true }));
});

router.get("/inspections/:id/potential-defects", async (req, res): Promise<void> => {
  const params = ListPotentialDefectsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const alerts = await db.select().from(potentialDefectsTable).where(eq(potentialDefectsTable.inspectionId, params.data.id)).orderBy(desc(potentialDefectsTable.createdAt));
  res.json(ListPotentialDefectsResponse.parse(alerts));
});

router.post("/inspections/:id/potential-defects", async (req, res): Promise<void> => {
  const params = CreatePotentialDefectParams.safeParse(req.params);
  const body = CreatePotentialDefectBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [inspection] = await db.select({ id: inspectionsTable.id }).from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const [alert] = await db.insert(potentialDefectsTable).values({ ...body.data, inspectionId: params.data.id, status: "potential" }).returning();
  res.status(201).json(CreatePotentialDefectResponse.parse(alert));
});

router.patch("/potential-defects/:id", async (req, res): Promise<void> => {
  const params = UpdatePotentialDefectParams.safeParse(req.params);
  const body = UpdatePotentialDefectBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [alert] = await db.update(potentialDefectsTable).set({ ...body.data, updatedAt: new Date() }).where(eq(potentialDefectsTable.id, params.data.id)).returning();
  if (!alert) {
    res.status(404).json({ error: "Potential defect not found" });
    return;
  }
  res.json(UpdatePotentialDefectResponse.parse(alert));
});

router.patch("/findings/:id", async (req, res): Promise<void> => {
  const params = UpdateFindingParams.safeParse(req.params);
  const body = UpdateFindingBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const {
    photosCount: ignoredPhotosCount,
    reportPhotosCount: ignoredReportPhotosCount,
    evidencePhotosCount: ignoredEvidencePhotosCount,
    ...findingUpdates
  } = body.data;
  void ignoredPhotosCount;
  void ignoredReportPhotosCount;
  void ignoredEvidencePhotosCount;
  const finding = await db.transaction(async (tx) => {
    const [updated] = Object.keys(findingUpdates).length
      ? await tx.update(findingsTable).set(findingUpdates).where(eq(findingsTable.id, params.data.id)).returning()
      : await tx.select().from(findingsTable).where(eq(findingsTable.id, params.data.id));
    if (updated) {
      const [inspection] = await tx.select().from(inspectionsTable).where(eq(inspectionsTable.id, updated.inspectionId)).for("update");
      await tx.update(inspectionsTable).set({ ...invalidateReportDelivery, updatedAt: new Date() }).where(eq(inspectionsTable.id, updated.inspectionId));
      if (inspection?.reportShareToken) await tx.insert(reportDeliveryEventsTable).values({
        inspectionId: inspection.id, eventType: "automatically_invalidated",
        recipientType: inspection.reportRecipientType, recipientEmail: inspection.reportRecipientEmail,
        previousTokenDigest: tokenDigest(inspection.reportShareToken), reason: "finding_edited",
        ...inspectorActor(req),
      });
    }
    return updated;
  });
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  const media = await db.select({
    id: findingMediaTable.id,
    findingId: findingMediaTable.findingId,
    classification: findingMediaTable.classification,
    contentType: findingMediaTable.contentType,
    fileName: findingMediaTable.fileName,
    caption: findingMediaTable.caption,
    sizeBytes: findingMediaTable.sizeBytes,
    createdAt: findingMediaTable.createdAt,
  }).from(findingMediaTable)
    .where(eq(findingMediaTable.findingId, finding.id))
    .orderBy(asc(findingMediaTable.createdAt), asc(findingMediaTable.id));
  res.json(UpdateFindingResponse.parse({ ...finding, media }));
});

router.get("/standards", async (req, res): Promise<void> => {
  const query = ListStandardsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const term = query.data.search;
  const standards = await db
    .select()
    .from(standardsTable)
    .where(term ? or(
      ilike(standardsTable.code, `%${term}%`),
      ilike(standardsTable.title, `%${term}%`),
      ilike(standardsTable.category, `%${term}%`),
    ) : undefined)
    .orderBy(asc(standardsTable.code));
  res.json(ListStandardsResponse.parse(standards));
});

router.get("/checklist", async (req, res): Promise<void> => {
  const query = ListChecklistQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const items = await db
    .select()
    .from(checklistTable)
    .where(eq(checklistTable.reportType, query.data.reportType))
    .orderBy(asc(checklistTable.sortOrder), asc(checklistTable.area));
  res.json(ListChecklistResponse.parse(items));
});

export default router;