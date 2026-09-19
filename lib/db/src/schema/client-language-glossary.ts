import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientLanguageGlossaryTable = pgTable("client_language_glossary", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  term: text("term").notNull(),
  suggestedMeaning: text("suggested_meaning").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientLanguageGlossarySchema = createInsertSchema(clientLanguageGlossaryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientLanguageGlossary = z.infer<typeof insertClientLanguageGlossarySchema>;
export type ClientLanguageGlossary = typeof clientLanguageGlossaryTable.$inferSelect;