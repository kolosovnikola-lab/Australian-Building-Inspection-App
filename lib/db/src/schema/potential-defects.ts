import { doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";

export const potentialDefectsTable = pgTable("potential_defects", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  detectionSource: text("detection_source").notNull().default("manual"),
  status: text("status").notNull().default("potential"),
  title: text("title").notNull(),
  note: text("note"),
  anchorX: doublePrecision("anchor_x").notNull(),
  anchorY: doublePrecision("anchor_y").notNull(),
  standardCode: text("standard_code").notNull(),
  standardTitle: text("standard_title").notNull(),
  clauseNumber: text("clause_number").notNull(),
  clauseExtract: text("clause_extract").notNull(),
  pageReference: text("page_reference").notNull(),
  sourceEdition: text("source_edition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPotentialDefectSchema = createInsertSchema(potentialDefectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPotentialDefect = z.infer<typeof insertPotentialDefectSchema>;
export type PotentialDefect = typeof potentialDefectsTable.$inferSelect;