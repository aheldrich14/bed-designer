import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { fitsSite, plantLibrary, sunClass } from "../plants";
import { tierOf } from "../rules";
import { siteAt } from "../match";
import { effectivePoints } from "../geometry";
import { bedFrame, describeBed, describePlan, plantLine } from "./describe";
import { missingRequired } from "./missing-info";
import { ProposalSchema, proposalToPlan, type ValidationResult } from "./proposal";
import {
  issueToSuggestion, type DraftInput, type DraftResult, type EditFocus, type EditInput, type EditResult, type NewSuggestion, type Planner,
  type ReviewInput, type ReviewResult,
} from "./planner";
import { changesToOps, EditProposalSchema } from "./edit";
import type { AgentMessage, Bed, MissingInfoItem, Moisture, Plan, PlanOp, Sun } from "../types";

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

const EDIT_SYSTEM = `${SYSTEM}

You are now in a conversation with the homeowner about a plan that already exists. Each turn, do one of three things:
- Make the change they ask for with propose_changes, touching only what the request needs and keeping the rest of the plan as it is.
- Ask one short question when the request is ambiguous (where, how big, which plant) and a wrong guess would waste their time.
- Answer a question about the plan or the plants without changing anything.
Place new or moved drifts with u/v rectangles in bed fractions. Adding a drift trims the drifts underneath it. "Hedge-like" or "screen" means a continuous row of shrubs (1 gal) in a band, usually at the back. "Here", "this" or "this area" means what the homeowner has selected, when they have selected something.
Check propose_changes' warnings and fix any you introduced. Every call to propose_changes starts again from the original plan, so the last call is the change they get.
Reply in one to three plain sentences: what you changed and why, or your question. Never mention drift ids, u/v numbers or tool names.`;

/** Library plants that suit a sun and moisture class, one line each. */
function searchPlantsTool(site: { sun: Sun | null; moisture: Moisture | null }) {
  return betaZodTool({
    name: "search_plants",
    description: "List library plants that suit a sun and moisture class, optionally filtered by height tier, plant type and bloom month. Returns one line per plant with its code.",
    inputSchema: z.object({
      sun: z.enum(["full", "part", "shade"]).optional(),
      moisture: z.enum(["dry", "medium", "wet"]).optional(),
      tier: z.enum(["low", "mid", "tall"]).optional(),
      type: z.enum(["perennial", "grass", "sedge", "fern", "shrub", "groundcover"]).optional(),
      bloomMonth: z.number().int().min(1).max(12).optional(),
    }),
    run: async (q) => {
      const lines = plantLibrary
        .all()
        .filter((p) => fitsSite(p, q.sun ?? site.sun, q.moisture ?? site.moisture))
        .filter((p) => !q.tier || tierOf(p) === q.tier)
        .filter((p) => !q.type || p.type === q.type)
        .filter((p) => !q.bloomMonth || p.bloomMonths.includes(q.bloomMonth))
        .map(plantLine);
      return lines.length ? lines.join("\n") : "No library plants match those filters.";
    },
  });
}

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

    const searchPlants = searchPlantsTool(site);

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

  async edit({ bed, plan, message, history, focus }: EditInput): Promise<EditResult> {
    let proposal: { summary: string; ops: PlanOp[] } | null = null;
    const site = { sun: sunClass(bed.conditions.sunHours), moisture: bed.conditions.moisture };

    const propose = betaZodTool({
      name: "propose_changes",
      description: "Change the current plan. Changes apply in order; the server validates them and reports problems. Each call replaces the previous proposal.",
      inputSchema: EditProposalSchema,
      run: async ({ summary, changes }) => {
        const r = changesToOps(bed, plan, changes);
        if (r.errors.length) return `Not applied:\n- ${r.errors.join("\n- ")}`;
        proposal = { summary, ops: r.ops };
        const after = describePlan(bed, r.plan).map((d) => `${d.code} ×${d.count} (${d.size}) u ${d.u.join("–")} v ${d.v.join("–")}`);
        return [
          `Ready: ${summary}.`,
          r.warnings.length ? `Warnings:\n- ${r.warnings.join("\n- ")}` : "No new problems.",
          `Plan after the change:\n${after.join("\n")}`,
          "If this is right, end your turn with your reply to the homeowner; otherwise call propose_changes again.",
        ].join("\n");
      },
    });

    const context = [
      `Bed: ${JSON.stringify(describeBed(bed))}`,
      `Current plan drifts: ${JSON.stringify(describePlan(bed, plan))}`,
      focusLine(bed, plan, focus),
      `Homeowner: ${message}`,
    ].join("\n\n");

    const final = await this.client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      ...FALLBACK,
      system: EDIT_SYSTEM,
      tools: [searchPlantsTool(site), propose],
      max_iterations: 10,
      messages: [...historyTurns(history), { role: "user", content: context }],
    });
    if (final.stop_reason === "refusal") throw new Error("The planner declined this request.");
    const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    const done = proposal as { summary: string; ops: PlanOp[] } | null;
    return { reply: text || done?.summary || "Done.", ops: done?.ops ?? [], summary: done?.summary ?? null };
  }
}

/** Earlier chat as alternating user/assistant turns, starting with the user and ending with the assistant. */
function historyTurns(history: AgentMessage[]): { role: "user" | "assistant"; content: string }[] {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history.slice(-12)) {
    const role = m.role === "agent" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last?.role === role) last.content += `\n\n${m.text}`;
    else turns.push({ role, content: m.text });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  while (turns[turns.length - 1]?.role === "user") turns.pop();
  return turns;
}

/** Describes what the homeowner has selected in the editor. */
function focusLine(bed: Bed, plan: Plan, focus: EditFocus): string {
  if (focus?.kind === "drift") {
    const d = describePlan(bed, plan).find((x) => x.driftId === focus.id);
    if (d) return `Selected in the editor: drift ${d.driftId} (${d.common}, ${d.code}) at u ${d.u.join("–")}, v ${d.v.join("–")}.`;
  }
  if (focus?.kind === "zone") {
    const z = bed.zones.find((x) => x.id === focus.id);
    if (z) {
      const pts = effectivePoints(z.shape).map(bedFrame(bed).uv);
      const u = [Math.min(...pts.map((p) => p.u)), Math.max(...pts.map((p) => p.u))];
      const v = [Math.min(...pts.map((p) => p.v)), Math.max(...pts.map((p) => p.v))];
      return `Selected in the editor: zone "${z.name}" at u ${u.join("–")}, v ${v.join("–")}.`;
    }
  }
  return "Nothing is selected in the editor.";
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

