import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { fitsSite, plantLibrary, sunClass } from "../plants";
import { tierOf } from "../rules";
import { siteAt } from "../match";
import { describeBed, describePlan, plantLine } from "./describe";
import { missingRequired } from "./missing-info";
import { ProposalSchema, proposalToPlan, type ValidationResult } from "./proposal";
import {
  issueToSuggestion, type DraftInput, type DraftResult, type NewSuggestion, type Planner, type ReviewInput, type ReviewResult,
} from "./planner";
import type { MissingInfoItem, PlanOp } from "../types";

const MODEL = process.env.PLANNER_MODEL || "claude-opus-5-5";

// Server-side refusal fallback: the API re-runs a declined request on a
// suitable fallback model inside the same call.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

const SYSTEM = `You are a landscape designer who plans native planting beds in Southeast Michigan for a homeowner.
You work only with the plant library the tools expose, and every plan you propose is checked by the server.

How the bed is described: positions are fractions of the bed. u runs along the bed (0 = left end, 1 = right end, seen from the front); v runs from the back edge (0, against the house) to the front edge (1).
Drifts are rectangles [u0,u1] x [v0,v1]; the server clips them to the real outline, rounds them into organic masses and counts plants from area and spacing.

Good plans for this homeowner:
- Tall plants at the back (low v), short at the front; no drift taller than the drift in front of it by more than a few inches.
- Drifts of at least 3 plants, ideally 5 or more; repeat a few plants rather than using many singles.
- Something showy in bloom from April through October in each third of the bed.
- Drifts tile the bed without overlapping and leave existing plants marked "keep" clear.
- Every plant suits the bed's sun and moisture.
- In a bed 3 ft deep or more, shrubs (1 gal) cover about a third of the area, usually at the back and the corners, so the bed has structure in winter; perennials and grasses fill the other two thirds. Use fewer only if the homeowner asks for an all-perennial bed.`;

export class ClaudePlanner implements Planner {
  readonly name = `Claude (${MODEL})`;
  private client = new Anthropic();

  async draft({ bed, checklist }: DraftInput): Promise<DraftResult> {
    let accepted: ValidationResult | null = null;
    let acceptedRationale = "";
    let requested: MissingInfoItem[] = [];
    const site = { sun: sunClass(bed.conditions.sunHours), moisture: bed.conditions.moisture };

    const readState = betaZodTool({
      name: "read_project_state",
      description: "Read the bed: dimensions, conditions, zones, existing plants, design rules and the missing-info checklist.",
      inputSchema: z.object({}),
      run: async () => JSON.stringify({ bed: describeBed(bed), checklist }),
    });

    const searchPlants = betaZodTool({
      name: "search_plants",
      description: "List library plants that suit a sun and moisture class, optionally filtered by height tier and bloom month. Returns one line per plant with its code.",
      inputSchema: z.object({
        sun: z.enum(["full", "part", "shade"]).optional(),
        moisture: z.enum(["dry", "medium", "wet"]).optional(),
        tier: z.enum(["low", "mid", "tall"]).optional(),
        bloomMonth: z.number().int().min(1).max(12).optional(),
      }),
      run: async (q) => {
        const lines = plantLibrary
          .all()
          .filter((p) => fitsSite(p, q.sun ?? site.sun, q.moisture ?? site.moisture))
          .filter((p) => !q.tier || tierOf(p) === q.tier)
          .filter((p) => !q.bloomMonth || p.bloomMonths.includes(q.bloomMonth))
          .map(plantLine);
        return lines.length ? lines.join("\n") : "No library plants match those filters.";
      },
    });

    const requestInfo = betaZodTool({
      name: "request_missing_info",
      description: "Ask the homeowner for information you cannot plan without. Say why each item matters. After calling this, stop and wait.",
      inputSchema: z.object({
        items: z.array(z.object({ key: z.string(), question: z.string(), why: z.string() })).min(1),
      }),
      run: async ({ items }) => {
        requested = items.map((i) => ({ ...i, status: "missing" as const }));
        return "Recorded. The homeowner will answer these before the next draft. End your turn now.";
      },
    });

    const validate = betaZodTool({
      name: "validate_plan",
      description: "Check a proposed plan on the server without saving it: library-only plants, site fit, overlaps, height order and bloom gaps.",
      inputSchema: ProposalSchema,
      run: async (proposal) => formatValidation(proposalToPlan(bed, proposal)),
    });

    const submit = betaZodTool({
      name: "submit_plan",
      description: "Submit the final plan. It is validated again; if it has errors, fix them and submit again.",
      inputSchema: ProposalSchema,
      run: async (proposal) => {
        const result = proposalToPlan(bed, proposal);
        if (!result.ok) return `Rejected.\n${formatValidation(result)}`;
        accepted = result;
        acceptedRationale = proposal.rationale;
        return `Accepted: ${result.summary}. End your turn with a one-line summary for the homeowner.`;
      },
    });

    const missing = missingRequired(checklist);
    const prompt = missing.length
      ? `Draft a planting plan for the bed "${bed.name}". The checklist still has open items; read the project state, and if you cannot plan without them, request the missing info instead of guessing.`
      : `Draft a planting plan for the bed "${bed.name}". Read the project state, search the library, validate your plan, then submit it.`;

    const final = await this.client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "high" },
      ...FALLBACK,
      system: SYSTEM,
      tools: [readState, searchPlants, requestInfo, validate, submit],
      max_iterations: 14,
      messages: [{ role: "user", content: prompt }],
    });

    const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (final.stop_reason === "refusal") throw new Error("The planner declined this request.");
    const done = accepted as ValidationResult | null;
    if (done) {
      return { status: "drafted", plan: done.plan, zones: done.zones, rationale: acceptedRationale, message: text || done.summary };
    }
    if (requested.length) {
      const merged = [...checklist.filter((c) => !requested.some((r) => r.key === c.key)), ...requested];
      return { status: "needs_info", checklist: merged, message: text || "I need a little more information first." };
    }
    throw new Error(text || "The planner finished without submitting a plan.");
  }

  async review({ bed, plan, issues }: ReviewInput): Promise<ReviewResult> {
    const ReviewSchema = z.object({
      summary: z.string().describe("One or two sentences for the homeowner."),
      suggestions: z.array(
        z.object({
          checkKey: z.string().describe("The key of the check this covers, or empty for your own judgment call."),
          issue: z.string().describe("Short and specific, e.g. 'Nothing blooms in April at the south end: try prairie smoke here'."),
          detail: z.string(),
          severity: z.enum(["info", "warn", "error"]),
          driftIds: z.array(z.string()),
          ops: z.array(
            z.object({
              op: z.enum(["setPlant", "swapPlants", "scaleDrift", "removeDrift", "setSize", "mergeDrifts"]),
              driftId: z.string().optional(),
              otherDriftId: z.string().optional().describe("Second drift for swapPlants (driftB) and mergeDrifts (the one removed)."),
              plantCode: z.string().optional(),
              factor: z.number().optional().describe("Area factor for scaleDrift, e.g. 1.5"),
              size: z.enum(["plug", "1gal"]).optional(),
            }),
          ),
        }),
      ),
    });

    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ReviewSchema) },
      ...FALLBACK,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Review this plan and propose specific fixes the homeowner can apply in one tap.
Turn the deterministic check results into clear suggestions (keep their proposed ops unless you have a better one), then add up to four judgment calls of your own: combinations, color, winter interest, sight lines, maintenance.
Use only drift ids from the plan and plant codes from the library list.

Bed: ${JSON.stringify(describeBed(bed))}
Plan drifts: ${JSON.stringify(describePlan(bed, plan))}
Check results: ${JSON.stringify(issues.map((i) => ({ key: i.key, issue: i.issue, detail: i.detail, driftIds: i.driftIds, ops: i.ops })))}
Library plants that suit this bed:
${plantLibrary.all().filter((p) => fitsSite(p, sunClass(bed.conditions.sunHours), bed.conditions.moisture)).map(plantLine).join("\n")}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") throw new Error("The reviewer declined this request.");
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("The review came back in an unexpected format.");

    const driftIds = new Set(plan.drifts.map((d) => d.id));
    const covered = new Set<string>();
    const suggestions: NewSuggestion[] = [];
    for (const s of parsed.suggestions) {
      const check = issues.find((i) => i.key === s.checkKey);
      if (check) covered.add(check.key);
      const ops = s.ops.map((o) => toOp(o, driftIds, bed)).filter((o): o is PlanOp => o !== null);
      const ids = s.driftIds.filter((id) => driftIds.has(id));
      suggestions.push({
        issue: s.issue,
        detail: s.detail,
        source: check?.source ?? "judgment",
        severity: s.severity,
        driftIds: ids,
        anchor: check?.anchor ?? anchorFor(ids, plan),
        // A check's own ops are already validated; prefer them if the model's were dropped.
        ops: ops.length ? ops : check?.ops ?? [],
      });
    }
    // Never lose a deterministic finding the model skipped.
    for (const i of issues) if (!covered.has(i.key)) suggestions.push(issueToSuggestion(i));
    return { suggestions, message: parsed.summary };

    function anchorFor(ids: string[], p: typeof plan) {
      const d = p.drifts.find((x) => x.id === ids[0]);
      if (!d) return null;
      const pts = d.shape.points;
      return { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
    }
  }
}

/** Validates one model-proposed op against the plan and library. */
function toOp(
  o: { op: string; driftId?: string; otherDriftId?: string; plantCode?: string; factor?: number; size?: "plug" | "1gal" },
  driftIds: Set<string>,
  bed: DraftInput["bed"],
): PlanOp | null {
  const has = (id?: string): id is string => !!id && driftIds.has(id);
  switch (o.op) {
    case "setPlant": {
      const plant = o.plantCode ? plantLibrary.byCode(o.plantCode) : undefined;
      if (!has(o.driftId) || !plant) return null;
      const site = siteAt(bed, null);
      if (!fitsSite(plant, site.sun, site.moisture)) return null;
      return { op: "setPlant", driftId: o.driftId, plantId: plant.id };
    }
    case "swapPlants":
      return has(o.driftId) && has(o.otherDriftId) ? { op: "swapPlants", driftA: o.driftId, driftB: o.otherDriftId } : null;
    case "scaleDrift":
      return has(o.driftId) && o.factor && o.factor > 0.2 && o.factor < 5 ? { op: "scaleDrift", driftId: o.driftId, factor: o.factor } : null;
    case "removeDrift":
      return has(o.driftId) ? { op: "removeDrift", driftId: o.driftId } : null;
    case "setSize":
      return has(o.driftId) && o.size ? { op: "setSize", driftId: o.driftId, size: o.size } : null;
    case "mergeDrifts":
      return has(o.driftId) && has(o.otherDriftId) ? { op: "mergeDrifts", keepId: o.driftId, removeId: o.otherDriftId } : null;
    default:
      return null;
  }
}

function formatValidation(r: ValidationResult): string {
  const lines = [r.ok ? `Valid: ${r.summary}.` : `Errors:\n- ${r.errors.join("\n- ")}`];
  const warn = r.warnings.filter((w) => w.source !== "overlap" && w.source !== "height-order");
  if (warn.length) lines.push(`Warnings:\n- ${warn.map((w) => `${w.issue}. ${w.detail}`).join("\n- ")}`);
  return lines.join("\n");
}

