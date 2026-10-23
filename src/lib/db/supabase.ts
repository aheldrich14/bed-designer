import { getSupabase, TABLE_PREFIX } from "../supabase";
import type { Backend, VersionRow, VersionSummary } from "./backend";
import type { AgentSession, Bed, Project, Render, Suggestion } from "../types";

// Supabase (Postgres via PostgREST) backend. Tables mirror schema.ts with
// jsonb for nested data and a prefix (supabase/migrations) so they can live in
// a shared project.

const table = (name: string) => getSupabase().from(TABLE_PREFIX + name);

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Renames top-level keys only; jsonb contents are stored as-is. */
function toRow(obj: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [snake(k), v]));
}
function fromRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v])) as T;
}

type Result = { data: unknown; error: { message: string } | null };

async function rows<T>(q: PromiseLike<Result>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => fromRow<T>(r));
}
async function one<T>(q: PromiseLike<Result>): Promise<T | null> {
  return (await rows<T>(q))[0] ?? null;
}
async function run(q: PromiseLike<Result>): Promise<void> {
  const { error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);
}

export const supabaseBackend: Backend = {
  async listProjects() {
    const projects = await rows<Project>(table("projects").select("*").order("created_at", { ascending: false }));
    const beds = await rows<{ projectId: string }>(table("beds").select("project_id"));
    return projects.map((p) => ({ ...p, bedCount: beds.filter((b) => b.projectId === p.id).length }));
  },
  getProject: (id) => one<Project>(table("projects").select("*").eq("id", id).limit(1)),
  insertProject: (p) => run(table("projects").insert(toRow(p))),
  async updateProject(id, patch) {
    if (Object.keys(patch).length) await run(table("projects").update(toRow(patch)).eq("id", id));
  },
  deleteProject: (id) => run(table("projects").delete().eq("id", id)),

  listBeds: (projectId) => rows<Bed>(table("beds").select("*").eq("project_id", projectId).order("created_at")),
  getBed: (id) => one<Bed>(table("beds").select("*").eq("id", id).limit(1)),
  insertBed: (b) => run(table("beds").insert(toRow(b))),
  async updateBed(id, patch) {
    if (Object.keys(patch).length) await run(table("beds").update(toRow(patch)).eq("id", id));
  },
  deleteBed: (id) => run(table("beds").delete().eq("id", id)),

  // A view counts drifts in Postgres so the list doesn't pull every snapshot.
  listVersions: (bedId) =>
    rows<VersionSummary>(table("plan_versions_list").select("*").eq("bed_id", bedId).order("seq", { ascending: false })),
  getVersion: (id) => one<VersionRow>(table("plan_versions").select("*").eq("id", id).limit(1)),
  latestVersion: (bedId) =>
    one<VersionRow>(table("plan_versions").select("*").eq("bed_id", bedId).order("seq", { ascending: false }).limit(1)),
  async maxSeq(bedId) {
    const top = await one<{ seq: number }>(table("plan_versions").select("seq").eq("bed_id", bedId).order("seq", { ascending: false }).limit(1));
    return top?.seq ?? 0;
  },
  insertVersion: (v) => run(table("plan_versions").insert(toRow(v))),

  listSuggestions: (planVersionId) =>
    rows<Suggestion>(table("suggestions").select("*").eq("plan_version_id", planVersionId).order("created_at")),
  deleteOpenSuggestions: (planVersionId) =>
    run(table("suggestions").delete().eq("plan_version_id", planVersionId).eq("status", "open")),
  async insertSuggestions(list) {
    if (list.length) await run(table("suggestions").insert(list.map(toRow)));
  },
  getSuggestion: (id) => one<Suggestion>(table("suggestions").select("*").eq("id", id).limit(1)),
  setSuggestionStatus: (id, status) => run(table("suggestions").update({ status }).eq("id", id)),
  async suggestionsForVersions(versionIds) {
    if (!versionIds.length) return [];
    return rows<Suggestion>(table("suggestions").select("*").in("plan_version_id", versionIds));
  },

  listRenders: (planVersionId) => rows<Render>(table("renders").select("*").eq("plan_version_id", planVersionId).order("month")),
  findRender: (planVersionId, month, viewpoint) =>
    one<Render>(
      table("renders").select("*").eq("plan_version_id", planVersionId).eq("month", month).eq("viewpoint", viewpoint).limit(1),
    ),
  deleteRender: (id) => run(table("renders").delete().eq("id", id)),
  insertRender: (r) => run(table("renders").insert(toRow(r))),

  getAgentSession: (bedId) => one<AgentSession>(table("agent_sessions").select("*").eq("bed_id", bedId).limit(1)),
  upsertAgentSession: (s) => run(table("agent_sessions").upsert(toRow(s), { onConflict: "bed_id" })),
};
