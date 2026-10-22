import type { Issue } from "../checks";
import type { Bed, MissingInfoItem, Plan, Project, Suggestion, Zone } from "../types";

export type DraftInput = { project: Project; bed: Bed; checklist: MissingInfoItem[] };

export type DraftResult =
  | { status: "needs_info"; checklist: MissingInfoItem[]; message: string }
  | { status: "drafted"; plan: Plan; zones: Zone[]; rationale: string; message: string };

export type ReviewInput = { bed: Bed; plan: Plan; issues: Issue[] };

export type NewSuggestion = Omit<Suggestion, "id" | "planVersionId" | "status" | "createdAt">;

export type ReviewResult = { suggestions: NewSuggestion[]; message: string };

/**
 * Planner seam. Agent tools are typed functions behind this interface, so a
 * different model or a nursery-availability tool can slot in later.
 */
export interface Planner {
  readonly name: string;
  draft(input: DraftInput): Promise<DraftResult>;
  review(input: ReviewInput): Promise<ReviewResult>;
}

export function issueToSuggestion(i: Issue): NewSuggestion {
  return {
    issue: i.issue,
    detail: i.detail,
    source: i.source,
    severity: i.severity,
    driftIds: i.driftIds,
    anchor: i.anchor,
    ops: i.ops,
  };
}
