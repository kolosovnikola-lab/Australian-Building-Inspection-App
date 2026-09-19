import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const standardsTable = pgTable("standards", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  clause: text("clause").notNull(),
  requirement: text("requirement").notNull(),
  tolerance: text("tolerance").notNull(),
  source: text("source").notNull(),
});

export const insertStandardSchema = createInsertSchema(standardsTable).omit({ id: true });
export type InsertStandard = z.infer<typeof insertStandardSchema>;
export type Standard = typeof standardsTable.$inferSelect;