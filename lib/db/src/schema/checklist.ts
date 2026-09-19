import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const checklistTable = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  reportType: text("report_type").notNull(),
  area: text("area").notNull(),
  subCategory: text("sub_category").notNull(),
  category: text("category").notNull(),
  prompt: text("prompt").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertChecklistSchema = createInsertSchema(checklistTable).omit({ id: true });
export type InsertChecklist = z.infer<typeof insertChecklistSchema>;
export type ChecklistItem = typeof checklistTable.$inferSelect;