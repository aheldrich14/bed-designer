import type {
  AgentSession, Bed, PlanVersion, Project, Render, Suggestion,
} from "../types";

export type VersionRow = PlanVersion & { seq: number };
export type VersionSummary = Omit<PlanVersion, "drifts" | "zoneNotes"> & { seq: number; driftCount: number };
export type NewSuggestion = Omit<Suggestion, "id" | "planVersionId" | "status" | "createdAt">;

/**
 * Everything the app needs from storage. Implemented by SQLite (sqlite.ts) and
 * Supabase (supabase.ts); repo.ts picks one with DB_BACKEND.
 */
export interface Backend {
  listProjects(): Promise<(Project & { bedCount: number })[]>;
  getProject(id: string): Promise<Project | null>;
  insertProject(p: Project): Promise<void>;
  updateProject(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>): Promise<void>;
  deleteProject(id: string): Promise<void>;

  listBeds(projectId: string): Promise<Bed[]>;
  getBed(id: string): Promise<Bed | null>;
  insertBed(b: Bed): Promise<void>;
  updateBed(id: string, patch: Partial<Omit<Bed, "id" | "projectId" | "createdAt">>): Promise<void>;
  deleteBed(id: string): Promise<void>;

  listVersions(bedId: string): Promise<VersionSummary[]>;
  getVersion(id: string): Promise<VersionRow | null>;
  latestVersion(bedId: string): Promise<VersionRow | null>;
  maxSeq(bedId: string): Promise<number>;
  insertVersion(v: VersionRow): Promise<void>;

  listSuggestions(planVersionId: string): Promise<Suggestion[]>;
  deleteOpenSuggestions(planVersionId: string): Promise<void>;
  insertSuggestions(rows: Suggestion[]): Promise<void>;
  getSuggestion(id: string): Promise<Suggestion | null>;
  setSuggestionStatus(id: string, status: Suggestion["status"]): Promise<void>;
  suggestionsForVersions(versionIds: string[]): Promise<Suggestion[]>;

  listRenders(planVersionId: string): Promise<Render[]>;
  findRender(planVersionId: string, month: number, viewpoint: Render["viewpoint"]): Promise<Render | null>;
  deleteRender(id: string): Promise<void>;
  insertRender(r: Render): Promise<void>;

  getAgentSession(bedId: string): Promise<AgentSession | null>;
  upsertAgentSession(s: AgentSession): Promise<void>;
}

