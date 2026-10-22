import { and, desc, eq, inArray, max } from "drizzle-orm";
import { getDb } from "./client";
import * as t from "./schema";
import { newId } from "../plan";
import type {
  AgentSession, Bed, Conditions, Plan, PlanAuthor, PlanVersion, Project, Render, Suggestion,
} from "../types";

// The data-access layer: the only module that knows about tables.

const now = () => new Date().toISOString();

export const DEFAULT_CONDITIONS: Conditions = {
  orientation: "W", sunHours: null, soil: null, moisture: null, canopy: "none", notes: "",
};

// ---- Projects -----------------------------------------------------------------

export function listProjects(): (Project & { bedCount: number })[] {
  const db = getDb();
  const rows = db.select().from(t.projects).orderBy(desc(t.projects.createdAt)).all();
  const bedRows = db.select({ projectId: t.beds.projectId }).from(t.beds).all();
  return rows.map((p) => ({
    ...toProject(p),
    bedCount: bedRows.filter((b) => b.projectId === p.id).length,
  }));
}

export function getProject(id: string): Project | null {
  const row = getDb().select().from(t.projects).where(eq(t.projects.id, id)).get();
  return row ? toProject(row) : null;
}

export function createProject(name: string): Project {
  const p: Project = {
    id: newId("p_"), name, aerialUrl: null, aerialSize: null, calibration: null, features: [], userId: null, createdAt: now(),
  };
  getDb().insert(t.projects).values(p).run();
  return p;
}

export function updateProject(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>): Project | null {
  getDb().update(t.projects).set(patch).where(eq(t.projects.id, id)).run();
  return getProject(id);
}

export function deleteProject(id: string) {
  getDb().delete(t.projects).where(eq(t.projects.id, id)).run();
}

function toProject(r: typeof t.projects.$inferSelect): Project {
  return { ...r, features: r.features ?? [], aerialSize: r.aerialSize ?? null, calibration: r.calibration ?? null };
}

// ---- Beds ---------------------------------------------------------------------

export function listBeds(projectId: string): Bed[] {
  return getDb().select().from(t.beds).where(eq(t.beds.projectId, projectId)).orderBy(t.beds.createdAt).all();
}

export function getBed(id: string): Bed | null {
  return getDb().select().from(t.beds).where(eq(t.beds.id, id)).get() ?? null;
}

export function createBed(projectId: string, input: Partial<Bed> & { name: string }): Bed {
  const bed: Bed = {
    id: newId("b_"),
    projectId,
    name: input.name,
    origin: input.origin ?? { x: 0, y: 0 },
    outline: input.outline ?? { points: [] },
    zones: input.zones ?? [],
    conditions: { ...DEFAULT_CONDITIONS, ...input.conditions },
    existing: input.existing ?? [],
    photos: input.photos ?? [],
    createdAt: now(),
  };
  getDb().insert(t.beds).values(bed).run();
  return bed;
}

export function updateBed(id: string, patch: Partial<Omit<Bed, "id" | "projectId" | "createdAt">>): Bed | null {
  if (Object.keys(patch).length) getDb().update(t.beds).set(patch).where(eq(t.beds.id, id)).run();
  return getBed(id);
}

export function deleteBed(id: string) {
  getDb().delete(t.beds).where(eq(t.beds.id, id)).run();
}

// ---- Plan versions (immutable snapshots) ---------------------------------------

export function listVersions(bedId: string): (Omit<PlanVersion, "drifts" | "zoneNotes"> & { seq: number; driftCount: number })[] {
  return getDb()
    .select()
    .from(t.planVersions)
    .where(eq(t.planVersions.bedId, bedId))
    .orderBy(desc(t.planVersions.seq))
    .all()
    .map(({ drifts, zoneNotes: _z, ...rest }) => ({ ...rest, driftCount: drifts.length }));
}

export function getVersion(id: string): (PlanVersion & { seq: number }) | null {
  return getDb().select().from(t.planVersions).where(eq(t.planVersions.id, id)).get() ?? null;
}

export function latestVersion(bedId: string): (PlanVersion & { seq: number }) | null {
  return (
    getDb().select().from(t.planVersions).where(eq(t.planVersions.bedId, bedId)).orderBy(desc(t.planVersions.seq)).limit(1).get() ??
    null
  );
}

export function createVersion(
  bedId: string,
  plan: Plan,
  author: PlanAuthor,
  rationale: string,
  parentId: string | null,
): PlanVersion & { seq: number } {
  const db = getDb();
  const top = db.select({ m: max(t.planVersions.seq) }).from(t.planVersions).where(eq(t.planVersions.bedId, bedId)).get();
  const v = {
    id: newId("v_"),
    bedId,
    parentId,
    drifts: plan.drifts,
    zoneNotes: plan.zoneNotes ?? {},
    author,
    rationale,
    createdAt: now(),
    seq: (top?.m ?? 0) + 1,
  };
  db.insert(t.planVersions).values(v).run();
  return v;
}

// ---- Suggestions ---------------------------------------------------------------

export function listSuggestions(planVersionId: string): Suggestion[] {
  return getDb().select().from(t.suggestions).where(eq(t.suggestions.planVersionId, planVersionId)).orderBy(t.suggestions.createdAt).all();
}

export function replaceOpenSuggestions(planVersionId: string, items: Omit<Suggestion, "id" | "planVersionId" | "status" | "createdAt">[]): Suggestion[] {
  const db = getDb();
  db.delete(t.suggestions).where(and(eq(t.suggestions.planVersionId, planVersionId), eq(t.suggestions.status, "open"))).run();
  const created = now();
  const rows: Suggestion[] = items.map((s) => ({ ...s, id: newId("s_"), planVersionId, status: "open", createdAt: created }));
  if (rows.length) db.insert(t.suggestions).values(rows).run();
  return listSuggestions(planVersionId);
}

export function getSuggestion(id: string): Suggestion | null {
  return getDb().select().from(t.suggestions).where(eq(t.suggestions.id, id)).get() ?? null;
}

export function setSuggestionStatus(id: string, status: Suggestion["status"]) {
  getDb().update(t.suggestions).set({ status }).where(eq(t.suggestions.id, id)).run();
}

/** Suggestions for every version of a bed, newest version first. */
export function suggestionsForVersions(versionIds: string[]): Suggestion[] {
  if (!versionIds.length) return [];
  return getDb().select().from(t.suggestions).where(inArray(t.suggestions.planVersionId, versionIds)).all();
}

// ---- Renders ---------------------------------------------------------------------

export function listRenders(planVersionId: string): Render[] {
  return getDb().select().from(t.renders).where(eq(t.renders.planVersionId, planVersionId)).orderBy(t.renders.month).all();
}

export function findRender(planVersionId: string, month: number, viewpoint: Render["viewpoint"]): Render | null {
  return (
    getDb()
      .select()
      .from(t.renders)
      .where(and(eq(t.renders.planVersionId, planVersionId), eq(t.renders.month, month), eq(t.renders.viewpoint, viewpoint)))
      .get() ?? null
  );
}

export function saveRender(r: Omit<Render, "id" | "createdAt">): Render {
  const db = getDb();
  const existing = findRender(r.planVersionId, r.month, r.viewpoint);
  if (existing) db.delete(t.renders).where(eq(t.renders.id, existing.id)).run();
  const row: Render = { ...r, id: newId("r_"), createdAt: now() };
  db.insert(t.renders).values(row).run();
  return row;
}

// ---- Agent sessions ----------------------------------------------------------------

export function getAgentSession(bedId: string): AgentSession | null {
  return getDb().select().from(t.agentSessions).where(eq(t.agentSessions.bedId, bedId)).get() ?? null;
}

export function saveAgentSession(s: Omit<AgentSession, "updatedAt">): AgentSession {
  const row = { ...s, updatedAt: now() };
  getDb()
    .insert(t.agentSessions)
    .values(row)
    .onConflictDoUpdate({ target: t.agentSessions.bedId, set: { messages: row.messages, checklist: row.checklist, updatedAt: row.updatedAt } })
    .run();
  return row;
}
