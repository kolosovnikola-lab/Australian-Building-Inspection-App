import { integer, pgTable, serial, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";

export const findingsTable = pgTable("findings", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  creationRequestId: text("creation_request_id"),
  area: text("area").notNull().default("General"),
  subCategory: text("sub_category").notNull().default("General"),
  category: text("category").notNull(),
  title: text("title").notNull(),
  location: text("location").notNull(),
  severity: text("severity").notNull(),
  pestRelevance: text("pest_relevance").notNull().default("not_applicable"),
  observed: text("observed").notNull(),
  standardRef: text("standard_ref").notNull(),
  standardTitle: text("standard_title").notNull(),
  requirement: text("requirement").notNull(),
  tolerance: text("tolerance").notNull(),
  measuredValue: doublePrecision("measured_value"),
  unit: text("unit"),
  assessment: text("assessment").notNull(),
  recommendation: text("recommendation").notNull(),
  clientExplanation: text("client_explanation"),
  photosCount: integer("photos_count").notNull().default(0),
  reportPhotosCount: integer("report_photos_count").notNull().default(0),
  evidencePhotosCount: integer("evidence_photos_count").notNull().default(0),
  backupDestination: text("backup_destination").notNull().default("app_only"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFindingSchema = createInsertSchema(findingsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFinding = z.infer<typeof insertFindingSchema>;
export type Finding = typeof findingsTable.$inferSelect;