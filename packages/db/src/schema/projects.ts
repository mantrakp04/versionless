import {
  foreignKey,
  index,
  jsonb,
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

/**
 * Canonical API surface artifacts uploaded by `versionless snapshot` during
 * a configured build. One immutable contract exists per project + version.
 */
export const projectVersions = pgTable(
  "project_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    version: text("version").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "project_versions_project_id_projects_id_fk",
    }).onDelete("cascade"),
    uniqueIndex("project_versions_project_version_unique").on(
      table.projectId,
      table.version,
    ),
    index("project_versions_project_id_idx").on(table.projectId),
  ],
);

export type ProjectVersion = typeof projectVersions.$inferSelect;

/**
 * Sunset schedule declared by `v.sunset(...)` in the customer's own code and
 * carried up by `versionless snapshot`. A sunset on version X applies to every
 * version <= X, so this is release metadata rather than a per-version flag —
 * a project can retire a whole cohort with one entry.
 *
 * Kept out of `project_versions.snapshot` on purpose: a sunset date is edited
 * after a version ships, and the snapshot is an immutable contract whose
 * integrity hash must not move when a retirement date is set or pushed back.
 */
export const projectSunsets = pgTable(
  "project_sunsets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    /** Sunsets every version <= this one. */
    version: text("version").notNull(),
    /** Last day the cohort is served, `YYYY-MM-DD` UTC. */
    after: text("after").notNull(),
    message: text("message"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "project_sunsets_project_id_projects_id_fk",
    }).onDelete("cascade"),
    uniqueIndex("project_sunsets_project_version_unique").on(
      table.projectId,
      table.version,
    ),
    index("project_sunsets_project_id_idx").on(table.projectId),
  ],
);

export type ProjectSunset = typeof projectSunsets.$inferSelect;
