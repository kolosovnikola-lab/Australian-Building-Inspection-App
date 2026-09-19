import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inspectionsTable = pgTable("inspections", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("legacy_unassigned"),
  title: text("title").notNull(),
  propertyAddress: text("property_address").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  agentEmail: text("agent_email"),
  inspectionDate: date("inspection_date", { mode: "string" }).notNull(),
  inspectorName: text("inspector_name").notNull(),
  reportType: text("report_type").notNull().default("pre_purchase"),
  status: text("status").notNull().default("draft"),
  reportStatus: text("report_status").notNull().default("draft"),
  deliveryStatus: text("delivery_status").notNull().default("not_shared"),
  reportRecipientType: text("report_recipient_type"),
  reportRecipientEmail: text("report_recipient_email"),
  reportSummaryLanguage: text("report_summary_language"),
  reportSummaryTranslations: text("report_summary_translations"),
  reportShareToken: text("report_share_token"),
  reportDeliveryAttemptId: text("report_delivery_attempt_id"),
  reportDeliveryIdempotencyKey: text("report_delivery_idempotency_key"),
  reportDeliveryProviderId: text("report_delivery_provider_id"),
  reportDeliveryError: text("report_delivery_error"),
  reportReadyAt: timestamp("report_ready_at", { withTimezone: true }),
  reportDeliveryAttemptedAt: timestamp("report_delivery_attempted_at", { withTimezone: true }),
  reportSharedAt: timestamp("report_shared_at", { withTimezone: true }),
  reportDeliveredAt: timestamp("report_delivered_at", { withTimezone: true }),
  reportViewedAt: timestamp("report_viewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInspectionSchema = createInsertSchema(inspectionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type Inspection = typeof inspectionsTable.$inferSelect;
