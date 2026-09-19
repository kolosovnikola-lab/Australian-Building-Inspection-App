import { index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { findingsTable } from "./findings";

export const mediaClassificationEnum = pgEnum("media_classification", [
  "client_report",
  "private_evidence",
]);

export const findingMediaTable = pgTable("finding_media", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").notNull().references(() => findingsTable.id, { onDelete: "cascade" }),
  classification: mediaClassificationEnum("classification").notNull(),
  objectPath: text("object_path").notNull(),
  thumbnailObjectPath: text("thumbnail_object_path"),
  contentType: text("content_type").notNull(),
  fileName: text("file_name").notNull(),
  caption: text("caption"),
  sha256: text("sha256"),
  sizeBytes: integer("size_bytes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("finding_media_finding_classification_idx").on(table.findingId, table.classification),
]);

export const insertFindingMediaSchema = createInsertSchema(findingMediaTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFindingMedia = z.infer<typeof insertFindingMediaSchema>;
export type FindingMedia = typeof findingMediaTable.$inferSelect;