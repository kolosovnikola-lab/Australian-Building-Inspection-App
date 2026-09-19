import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workspaceUsageEventsTable = pgTable("workspace_usage_events", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  eventType: text("event_type").notNull(),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("workspace_usage_events_scope_idx").on(table.workspaceId, table.eventType, table.createdAt),
]);

export const insertWorkspaceUsageEventSchema = createInsertSchema(workspaceUsageEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWorkspaceUsageEvent = z.infer<typeof insertWorkspaceUsageEventSchema>;
export type WorkspaceUsageEvent = typeof workspaceUsageEventsTable.$inferSelect;