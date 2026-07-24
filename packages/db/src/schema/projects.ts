import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("projects_team_name_unique").on(
      table.teamId,
      table.name,
    ),
    index("projects_team_id_idx").on(table.teamId),
  ],
);

export const projectSchema = createSelectSchema(projects);
export type Project = typeof projects.$inferSelect;

/**
 * Binds an account-scoped secret to the first telemetry project it is used
 * with. Only a SHA-256 fingerprint is stored; the bearer secret never enters
 * Postgres or ClickHouse.
 */
export const telemetryIngestKeys = pgTable(
  "telemetry_ingest_keys",
  {
    fingerprint: text("fingerprint").primaryKey(),
    teamId: text("team_id").notNull(),
    projectId: uuid("project_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "telemetry_ingest_keys_project_id_projects_id_fk",
    }).onDelete("cascade"),
    index("telemetry_ingest_keys_project_id_idx").on(table.projectId),
  ],
);

export type TelemetryIngestKey = typeof telemetryIngestKeys.$inferSelect;
