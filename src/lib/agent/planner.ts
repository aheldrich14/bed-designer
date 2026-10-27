import type { Issue } from "../checks";
import type { AgentMessage, Bed, MissingInfoItem, Plan, PlanOp, Project, Suggestion, Zone } from "../types";

export type DraftInput = { project: Project; bed: Bed; checklist: MissingInfoItem[] };

export type DraftResult =
  | { status: "needs_info"; checklist: MissingInfoItem[]; message: string }
  | { status: "drafted"; plan: Plan; zones: Zone[]; rationale: string; message: string };

export type ReviewInput = { bed: Bed; plan: Plan; issues: Issue[] };

export type NewSuggestion = Omit<Suggestion, "id" | "planVersionId" | "status" | "createdAt">;

export type ReviewResult = { suggestions: NewSuggestion[]; message: string };

/** What the homeowner has selected in the editor, so "here" and "this" have a referent. */
export type EditFocus = { kind: "drift" | "zone"; id: string } | null;

export type EditInput = { bed: Bed; plan: Plan; message: string; history: AgentMessage[]; focus: EditFocus };

/** A reply, plus the plan ops for the change it describes (empty when the agent asks a question or just answers). */
export type EditResult = { reply: string; ops: PlanOp[]; summary: string | null };

/**
 * Planner seam. Agent tools are typed functions behind this interface, so a
 * different model or a nursery-availability tool can slot in later.
 */
export interface Planner {
  readonly name: string;
  draft(input: DraftInput): Promise<DraftResult>;
  review(input: ReviewInput): Promise<ReviewResult>;
  /** One conversational turn: answer, ask, or propose changes to the plan. */
  edit(input: EditInput): Promise<EditResult>;
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
