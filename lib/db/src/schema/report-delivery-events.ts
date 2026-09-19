import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { inspectionsTable } from "./inspections";

export const reportDeliveryEventsTable = pgTable("report_delivery_events", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id")
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  recipientType: text("recipient_type"),
  recipientEmail: text("recipient_email"),
  tokenDigest: text("token_digest"),
  previousTokenDigest: text("previous_token_digest"),
  reason: text("reason"),
  reviewedSummaryLanguage: text("reviewed_summary_language"),
  reviewCompletedAt: timestamp("review_completed_at", { withTimezone: true }),
  actorId: text("actor_id"),
  actorDisplayName: text("actor_display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReportDeliveryEvent =
  typeof reportDeliveryEventsTable.$inferSelect;