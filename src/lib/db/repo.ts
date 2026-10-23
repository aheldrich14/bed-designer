import { newId } from "../plan";
import { supabaseConfig } from "../supabase";
import type { Backend, NewSuggestion, VersionRow, VersionSummary } from "./backend";
import type {
  AgentSession, Bed, Conditions, Plan, PlanAuthor, Project, Render, Suggestion,
} from "../types";

// The data-access layer: the only module the app uses for persistence. The
// storage itself is a Backend: SQLite (default) or Supabase, chosen by
// DB_BACKEND=sqlite|supabase (default: supabase when its env vars are set).

export type DbBackendName = "sqlite" | "supabase";

export function backendName(): DbBackendName {
  const forced = process.env.DB_BACKEND?.toLowerCase();
  if (forced === "sqlite" || forced === "supabase") return forced;
  return supabaseConfig() ? "supabase" : "sqlite";
}

let cached: Promise<Backend> | null = null;

/** Loaded lazily so the Supabase build never touches the native SQLite module. */
function db(): Promise<Backend> {
  cached ??=
    backendName() === "supabase"
      ? import("./supabase").then((m) => m.supabaseBackend)
      : import("./sqlite").then((m) => m.sqliteBackend);
  return cached;
}

const now = () => new Date().toISOString();

export const DEFAULT_CONDITIONS: Conditions = {
  orientation: "W", sunHours: null, soil: null, moisture: null, canopy: "none", notes: "",
};

// ---- Projects -----------------------------------------------------------------

export async function listProjects(): Promise<(Project & { bedCount: number })[]> {
  return (await db()).listProjects();
}

export async function getProject(id: string): Promise<Project | null> {
  return (await db()).getProject(id);
}

export async function createProject(name: string): Promise<Project> {
  const p: Project = {
    id: newId("p_"), name, aerialUrl: null, aerialSize: null, calibration: null, features: [], userId: null, createdAt: now(),
  };
  await (await db()).insertProject(p);
  return p;
}

export async function updateProject(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>): Promise<Project | null> {
  await (await db()).updateProject(id, patch);
  return getProject(id);
}

export async function deleteProject(id: string) {
  await (await db()).deleteProject(id);
}

// ---- Beds ---------------------------------------------------------------------

export async function listBeds(projectId: string): Promise<Bed[]> {
  return (await db()).listBeds(projectId);
}

export async function getBed(id: string): Promise<Bed | null> {
  return (await db()).getBed(id);
}

export async function createBed(projectId: string, input: Partial<Bed> & { name: string }): Promise<Bed> {
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
  await (await db()).insertBed(bed);
  return bed;
}

export async function updateBed(id: string, patch: Partial<Omit<Bed, "id" | "projectId" | "createdAt">>): Promise<Bed | null> {
  await (await db()).updateBed(id, patch);
  return getBed(id);
}

export async function deleteBed(id: string) {
  await (await db()).deleteBed(id);
}

// ---- Plan versions (immutable snapshots) ---------------------------------------

export async function listVersions(bedId: string): Promise<VersionSummary[]> {
  return (await db()).listVersions(bedId);
}

export async function getVersion(id: string): Promise<VersionRow | null> {
  return (await db()).getVersion(id);
}

export async function latestVersion(bedId: string): Promise<VersionRow | null> {
  return (await db()).latestVersion(bedId);
}

export async function createVersion(
  bedId: string,
  plan: Plan,
  author: PlanAuthor,
  rationale: string,
  parentId: string | null,
): Promise<VersionRow> {
  const b = await db();
  const v: VersionRow = {
    id: newId("v_"),
    bedId,
    parentId,
    drifts: plan.drifts,
    zoneNotes: plan.zoneNotes ?? {},
    author,
    rationale,
    createdAt: now(),
    seq: (await b.maxSeq(bedId)) + 1,
  };
  await b.insertVersion(v);
  return v;
}

// ---- Suggestions ---------------------------------------------------------------

export async function listSuggestions(planVersionId: string): Promise<Suggestion[]> {
  return (await db()).listSuggestions(planVersionId);
}

export async function replaceOpenSuggestions(planVersionId: string, items: NewSuggestion[]): Promise<Suggestion[]> {
  const b = await db();
  await b.deleteOpenSuggestions(planVersionId);
  const created = now();
  await b.insertSuggestions(items.map((s) => ({ ...s, id: newId("s_"), planVersionId, status: "open", createdAt: created })));
  return b.listSuggestions(planVersionId);
}

export async function getSuggestion(id: string): Promise<Suggestion | null> {
  return (await db()).getSuggestion(id);
}

export async function setSuggestionStatus(id: string, status: Suggestion["status"]) {
  await (await db()).setSuggestionStatus(id, status);
}

/** Suggestions for every version of a bed, newest version first. */
export async function suggestionsForVersions(versionIds: string[]): Promise<Suggestion[]> {
  return (await db()).suggestionsForVersions(versionIds);
}

// ---- Renders ---------------------------------------------------------------------

export async function listRenders(planVersionId: string): Promise<Render[]> {
  return (await db()).listRenders(planVersionId);
}

export async function findRender(planVersionId: string, month: number, viewpoint: Render["viewpoint"]): Promise<Render | null> {
  return (await db()).findRender(planVersionId, month, viewpoint);
}

export async function saveRender(r: Omit<Render, "id" | "createdAt">): Promise<Render> {
  const b = await db();
  const existing = await b.findRender(r.planVersionId, r.month, r.viewpoint);
  if (existing) await b.deleteRender(existing.id);
  const row: Render = { ...r, id: newId("r_"), createdAt: now() };
  await b.insertRender(row);
  return row;
}

// ---- Agent sessions ----------------------------------------------------------------

export async function getAgentSession(bedId: string): Promise<AgentSession | null> {
  return (await db()).getAgentSession(bedId);
}

export async function saveAgentSession(s: Omit<AgentSession, "updatedAt">): Promise<AgentSession> {
  const row = { ...s, updatedAt: now() };
  await (await db()).upsertAgentSession(row);
  return row;
}
