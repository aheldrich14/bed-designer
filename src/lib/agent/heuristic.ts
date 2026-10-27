import { runChecks } from "../checks";
import { applyOps, countFor } from "../plan";
import { plantLibrary } from "../plants";
import { applyTemplate, templatesFor } from "../templates";
import { missingRequired } from "./missing-info";
import { issueToSuggestion, type DraftInput, type DraftResult, type Planner, type ReviewInput, type ReviewResult } from "./planner";

/**
 * Offline planner: picks the best-fitting starter template, then applies the
 * deterministic fixes for bloom gaps and lone plants a few times. Used when no
 * model key is configured and as the fallback when a model call fails.
 */
export class HeuristicPlanner implements Planner {
  readonly name = "built-in heuristic";

  async draft({ bed, checklist }: DraftInput): Promise<DraftResult> {
    const missing = missingRequired(checklist);
    if (missing.length) {
      return {
        status: "needs_info",
        checklist,
        message: `I need ${missing.length} more thing${missing.length > 1 ? "s" : ""} before drafting: ${missing.map((m) => m.question.toLowerCase().replace(/[?.]$/, "")).join("; ")}.`,
      };
    }
    const [{ template }] = templatesFor(bed);
    let { plan, zones } = applyTemplate(template, bed);
    for (let pass = 0; pass < 6; pass++) {
      const fixes = runChecks(bed, plan).filter((i) => (i.source === "bloom-gap" || i.source === "lone-plants" || i.source === "height-order") && i.ops.length);
      if (!fixes.length) break;
      plan = applyOps(plan, fixes[0].ops);
    }
    const species = new Set(plan.drifts.map((d) => d.plantId));
    const total = plan.drifts.reduce((s, d) => s + countFor(d), 0);
    const names = [...species].map((id) => plantLibrary.get(id)?.common).filter(Boolean);
    return {
      status: "drafted",
      plan,
      zones,
      rationale: `Started from the “${template.name}” layout, filled for ${bed.conditions.sunHours ?? "?"} h sun and ${bed.conditions.moisture ?? "average"} soil, then closed bloom gaps. ${total} plants across ${species.size} species: ${names.join(", ")}.`,
      message: `Drafted ${plan.drifts.length} drifts from the ${template.name} pattern. Run a design review for more ideas.`,
    };
  }

  async review({ bed, plan, issues }: ReviewInput): Promise<ReviewResult> {
    const suggestions = issues.map(issueToSuggestion);
    return {
      suggestions,
      message: suggestions.length
        ? `${suggestions.length} suggestion${suggestions.length > 1 ? "s" : ""} from the design checks.`
        : "The plan passes every design check.",
    };
  }
}
