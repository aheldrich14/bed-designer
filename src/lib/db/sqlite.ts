import { and, desc, eq, inArray, max } from "drizzle-orm";
import { getDb } from "./client";
import * as t from "./schema";
import type { Backend } from "./backend";
import type { Project } from "../types";

// SQLite backend (local file via better-sqlite3 + Drizzle).

function toProject(r: typeof t.projects.$inferSelect): Project {
  return { ...r, features: r.features ?? [], aerialSize: r.aerialSize ?? null, calibration: r.calibration ?? null };
}

export const sqliteBackend: Backend = {
  async listProjects() {
    const db = getDb();
    const rows = db.select().from(t.projects).orderBy(desc(t.projects.createdAt)).all();
    const bedRows = db.select({ projectId: t.beds.projectId }).from(t.beds).all();
    return rows.map((p) => ({ ...toProject(p), bedCount: bedRows.filter((b) => b.projectId === p.id).length }));
  },
  async getProject(id) {
    const row = getDb().select().from(t.projects).where(eq(t.projects.id, id)).get();
    return row ? toProject(row) : null;
  },
  async insertProject(p) {
    getDb().insert(t.projects).values(p).run();
  },
  async updateProject(id, patch) {
    if (Object.keys(patch).length) getDb().update(t.projects).set(patch).where(eq(t.projects.id, id)).run();
  },
  async deleteProject(id) {
    getDb().delete(t.projects).where(eq(t.projects.id, id)).run();
  },

  async listBeds(projectId) {
    return getDb().select().from(t.beds).where(eq(t.beds.projectId, projectId)).orderBy(t.beds.createdAt).all();
  },
  async getBed(id) {
    return getDb().select().from(t.beds).where(eq(t.beds.id, id)).get() ?? null;
  },
  async insertBed(b) {
    getDb().insert(t.beds).values(b).run();
  },
  async updateBed(id, patch) {
    if (Object.keys(patch).length) getDb().update(t.beds).set(patch).where(eq(t.beds.id, id)).run();
  },
  async deleteBed(id) {
    getDb().delete(t.beds).where(eq(t.beds.id, id)).run();
  },

  async listVersions(bedId) {
    return getDb()
      .select()
      .from(t.planVersions)
      .where(eq(t.planVersions.bedId, bedId))
      .orderBy(desc(t.planVersions.seq))
      .all()
      .map(({ drifts, zoneNotes: _z, ...rest }) => ({ ...rest, driftCount: drifts.length }));
  },
  async getVersion(id) {
    return getDb().select().from(t.planVersions).where(eq(t.planVersions.id, id)).get() ?? null;
  },
  async latestVersion(bedId) {
    return (
      getDb().select().from(t.planVersions).where(eq(t.planVersions.bedId, bedId)).orderBy(desc(t.planVersions.seq)).limit(1).get() ??
      null
    );
  },
  async maxSeq(bedId) {
    const top = getDb().select({ m: max(t.planVersions.seq) }).from(t.planVersions).where(eq(t.planVersions.bedId, bedId)).get();
    return top?.m ?? 0;
  },
  async insertVersion(v) {
    getDb().insert(t.planVersions).values(v).run();
  },

  async listSuggestions(planVersionId) {
    return getDb().select().from(t.suggestions).where(eq(t.suggestions.planVersionId, planVersionId)).orderBy(t.suggestions.createdAt).all();
  },
  async deleteOpenSuggestions(planVersionId) {
    getDb().delete(t.suggestions).where(and(eq(t.suggestions.planVersionId, planVersionId), eq(t.suggestions.status, "open"))).run();
  },
  async insertSuggestions(rows) {
    if (rows.length) getDb().insert(t.suggestions).values(rows).run();
  },
  async getSuggestion(id) {
    return getDb().select().from(t.suggestions).where(eq(t.suggestions.id, id)).get() ?? null;
  },
  async setSuggestionStatus(id, status) {
    getDb().update(t.suggestions).set({ status }).where(eq(t.suggestions.id, id)).run();
  },
  async suggestionsForVersions(versionIds) {
    if (!versionIds.length) return [];
    return getDb().select().from(t.suggestions).where(inArray(t.suggestions.planVersionId, versionIds)).all();
  },

  async listRenders(planVersionId) {
    return getDb().select().from(t.renders).where(eq(t.renders.planVersionId, planVersionId)).orderBy(t.renders.month).all();
  },
  async findRender(planVersionId, month, viewpoint) {
    return (
      getDb()
        .select()
        .from(t.renders)
        .where(and(eq(t.renders.planVersionId, planVersionId), eq(t.renders.month, month), eq(t.renders.viewpoint, viewpoint)))
        .get() ?? null
    );
  },
  async deleteRender(id) {
    getDb().delete(t.renders).where(eq(t.renders.id, id)).run();
  },
  async insertRender(r) {
    getDb().insert(t.renders).values(r).run();
  },

  async getAgentSession(bedId) {
    return getDb().select().from(t.agentSessions).where(eq(t.agentSessions.bedId, bedId)).get() ?? null;
  },
  async upsertAgentSession(s) {
    getDb()
      .insert(t.agentSessions)
      .values(s)
      .onConflictDoUpdate({ target: t.agentSessions.bedId, set: { messages: s.messages, checklist: s.checklist, updatedAt: s.updatedAt } })
      .run();
  },
};
