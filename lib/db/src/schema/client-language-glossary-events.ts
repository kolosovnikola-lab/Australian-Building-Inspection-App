import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientLanguageGlossaryEventsTable = pgTable("client_language_glossary_events", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  glossaryTermId: integer("glossary_term_id").notNull(),
  action: text("action").notNull(),
  term: text("term").notNull(),
  suggestedMeaning: text("suggested_meaning").notNull(),
  previousTerm: text("previous_term"),
  previousSuggestedMeaning: text("previous_suggested_meaning"),
  actorId: text("actor_id").notNull(),
  actorDisplayName: text("actor_display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("client_language_glossary_events_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const insertClientLanguageGlossaryEventSchema = createInsertSchema(clientLanguageGlossaryEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertClientLanguageGlossaryEvent = z.infer<typeof insertClientLanguageGlossaryEventSchema>;
export type ClientLanguageGlossaryEvent = typeof clientLanguageGlossaryEventsTable.$inferSelect;