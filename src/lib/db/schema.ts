import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type {
  AgentMessage, Calibration, Conditions, Drift, ExistingPlant, MissingInfoItem, Photo, PlanOp, Pt, Shape,
  SiteFeature, Zone,
} from "../types";

// Nested geometry and lists are stored as JSON text; the data-access layer in
// repo.ts is the only code that touches these tables, so the store can move to
// Postgres (e.g. Supabase) without the rest of the app changing.

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aerialUrl: text("aerial_url"),
  aerialSize: text("aerial_size", { mode: "json" }).$type<{ w: number; h: number } | null>(),
  calibration: text("calibration", { mode: "json" }).$type<Calibration | null>(),
  features: text("features", { mode: "json" }).$type<SiteFeature[]>().notNull(),
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
});

export const beds = sqliteTable("beds", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  origin: text("origin", { mode: "json" }).$type<Pt>().notNull(),
  outline: text("outline", { mode: "json" }).$type<Shape>().notNull(),
  zones: text("zones", { mode: "json" }).$type<Zone[]>().notNull(),
  conditions: text("conditions", { mode: "json" }).$type<Conditions>().notNull(),
  existing: text("existing", { mode: "json" }).$type<ExistingPlant[]>().notNull(),
  photos: text("photos", { mode: "json" }).$type<Photo[]>().notNull(),
  dismissedChecks: text("dismissed_checks", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
});

export const planVersions = sqliteTable("plan_versions", {
  id: text("id").primaryKey(),
  bedId: text("bed_id").notNull().references(() => beds.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  drifts: text("drifts", { mode: "json" }).$type<Drift[]>().notNull(),
  zoneNotes: text("zone_notes", { mode: "json" }).$type<Record<string, string>>().notNull(),
  author: text("author").$type<"agent" | "template" | "user">().notNull(),
  rationale: text("rationale").notNull(),
  createdAt: text("created_at").notNull(),
  seq: integer("seq").notNull(),
});

export const suggestions = sqliteTable("suggestions", {
  id: text("id").primaryKey(),
  planVersionId: text("plan_version_id").notNull().references(() => planVersions.id, { onDelete: "cascade" }),
  issue: text("issue").notNull(),
  detail: text("detail").notNull(),
  source: text("source").notNull(),
  severity: text("severity").$type<"info" | "warn" | "error">().notNull(),
  driftIds: text("drift_ids", { mode: "json" }).$type<string[]>().notNull(),
  anchor: text("anchor", { mode: "json" }).$type<Pt | null>(),
  ops: text("ops", { mode: "json" }).$type<PlanOp[]>().notNull(),
  status: text("status").$type<"open" | "applied" | "dismissed">().notNull(),
  createdAt: text("created_at").notNull(),
});

export const renders = sqliteTable("renders", {
  id: text("id").primaryKey(),
  planVersionId: text("plan_version_id").notNull().references(() => planVersions.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  viewpoint: text("viewpoint").$type<"street" | "overhead">().notNull(),
  prompt: text("prompt").notNull(),
  imageUrl: text("image_url"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const agentSessions = sqliteTable("agent_sessions", {
  bedId: text("bed_id").primaryKey().references(() => beds.id, { onDelete: "cascade" }),
  messages: text("messages", { mode: "json" }).$type<AgentMessage[]>().notNull(),
  checklist: text("checklist", { mode: "json" }).$type<MissingInfoItem[]>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, aerial_url TEXT, aerial_size TEXT, calibration TEXT,
  features TEXT NOT NULL, user_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS beds (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, origin TEXT NOT NULL, outline TEXT NOT NULL, zones TEXT NOT NULL,
  conditions TEXT NOT NULL, existing TEXT NOT NULL, photos TEXT NOT NULL,
  dismissed_checks TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY, bed_id TEXT NOT NULL REFERENCES beds(id) ON DELETE CASCADE, parent_id TEXT,
  drifts TEXT NOT NULL, zone_notes TEXT NOT NULL, author TEXT NOT NULL, rationale TEXT NOT NULL,
  created_at TEXT NOT NULL, seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_versions_bed ON plan_versions(bed_id, seq);
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY, plan_version_id TEXT NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  issue TEXT NOT NULL, detail TEXT NOT NULL, source TEXT NOT NULL, severity TEXT NOT NULL,
  drift_ids TEXT NOT NULL, anchor TEXT, ops TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY, plan_version_id TEXT NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  month INTEGER NOT NULL, viewpoint TEXT NOT NULL, prompt TEXT NOT NULL, image_url TEXT, error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  bed_id TEXT PRIMARY KEY REFERENCES beds(id) ON DELETE CASCADE, messages TEXT NOT NULL,
  checklist TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

/** Columns added after the first release, applied to existing databases on startup. */
export const ADDED_COLUMNS: { table: string; column: string; sql: string }[] = [
  { table: "beds", column: "dismissed_checks", sql: "ALTER TABLE beds ADD COLUMN dismissed_checks TEXT NOT NULL DEFAULT '[]'" },
];
