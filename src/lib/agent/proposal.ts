import { z } from "zod";
import { runChecks, type Issue } from "../checks";
import { carveExisting, clipToLargest, effectivePoints, frameBounds, fromFrame, polygonArea } from "../geometry";
import { countFor, newId } from "../plan";
import { fitsSite, plantLibrary } from "../plants";
import { defaultSizeFor } from "../rules";
import { siteAt } from "../match";
import type { Bed, Drift, Plan, Zone } from "../types";

/**
 * The agent proposes drifts as rectangles in bed fractions (u end to end, v
 * back to front), the same frame templates use. The server converts them to
 * feet, clips them to the outline, and validates the result.
 */
export const ProposalSchema = z.object({
  rationale: z.string().describe("Two or three sentences on the overall idea."),
  zones: z
    .array(
      z.object({
        name: z.string(),
        v: z.array(z.number()).describe("[v0, v1] band of the bed depth, 0 = back, 1 = front"),
        rationale: z.string().describe("One line on why this zone is planted this way."),
      }),
    )
    .describe("Bands from back to front."),
  drifts: z.array(
    z.object({
      plantCode: z.string().describe("Library code, e.g. ASC-TUB"),
      u: z.array(z.number()).describe("[u0, u1] along the bed, 0 = left end, 1 = right end, as seen from the front"),
      v: z.array(z.number()).describe("[v0, v1] depth, 0 = back edge, 1 = front edge"),
      size: z.enum(["plug", "1gal"]).optional(),
    }),
  ),
});

export type Proposal = z.infer<typeof ProposalSchema>;

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: Issue[];
  plan: Plan;
  zones: Zone[];
  summary: string;
};

const pair = (a: number[]): [number, number] | null => {
  if (a.length !== 2 || a.some((x) => !Number.isFinite(x))) return null;
  const lo = Math.max(0, Math.min(a[0], a[1]));
  const hi = Math.min(1, Math.max(a[0], a[1]));
  return hi - lo > 0.01 ? [lo, hi] : null;
};

export function proposalToPlan(bed: Bed, p: Proposal): ValidationResult {
  const errors: string[] = [];
  const outline = effectivePoints(bed.outline);
  if (outline.length < 3) {
    return { ok: false, errors: ["The bed has no outline yet."], warnings: [], plan: { drifts: [], zoneNotes: {} }, zones: [], summary: "" };
  }
  const o = bed.conditions.orientation;
  const fb = frameBounds(outline, o);
  const W = fb.maxL - fb.minL;
  const D = fb.maxD - fb.minD;
  const rect = (u: [number, number], v: [number, number]) =>
    [
      { l: fb.minL + u[0] * W, d: fb.minD + v[0] * D },
      { l: fb.minL + u[1] * W, d: fb.minD + v[0] * D },
      { l: fb.minL + u[1] * W, d: fb.minD + v[1] * D },
      { l: fb.minL + u[0] * W, d: fb.minD + v[1] * D },
    ].map((q) => fromFrame(q, o));

  const drifts: Drift[] = [];
  p.drifts.forEach((d, i) => {
    const plant = plantLibrary.byCode(d.plantCode);
    if (!plant) return errors.push(`Drift ${i + 1}: ${d.plantCode} is not in the plant library.`);
    const u = pair(d.u);
    const v = pair(d.v);
    if (!u || !v) return errors.push(`Drift ${i + 1} (${d.plantCode}): u and v must each be two numbers between 0 and 1.`);
    const clipped = carveExisting(clipToLargest(rect(u, v), outline), bed);
    if (!clipped || polygonArea(clipped) < 1) return errors.push(`Drift ${i + 1} (${d.plantCode}) falls outside the bed outline.`);
    const drift: Drift = { id: newId("d_"), plantId: plant.id, size: d.size ?? defaultSizeFor(plant), shape: { points: clipped, smooth: true } };
    const site = siteAt(bed, drift);
    if (!fitsSite(plant, site.sun, site.moisture)) {
      errors.push(`Drift ${i + 1}: ${plant.code} needs ${plant.sun.join("/")} sun and ${plant.moisture.join("/")} soil; this spot is ${site.sun ?? "?"} sun, ${site.moisture ?? "?"} soil.`);
    }
    drifts.push(drift);
  });
  if (!drifts.length && !errors.length) errors.push("The plan has no drifts.");

  const zones: Zone[] = [];
  const zoneNotes: Record<string, string> = {};
  for (const z of p.zones) {
    const v = pair(z.v);
    if (!v) continue;
    const poly = clipToLargest(rect([0, 1], v), outline);
    if (!poly) continue;
    const id = newId("z_");
    zones.push({ id, name: z.name, shape: { points: poly } });
    zoneNotes[id] = z.rationale;
  }

  const plan: Plan = { drifts, zoneNotes };
  const warnings = runChecks(bed, plan).filter((i) => i.severity !== "info" || i.source === "bloom-gap");
  for (const w of warnings) {
    if (w.source === "overlap" || w.source === "height-order") errors.push(`${w.issue}. ${w.detail}`);
  }
  const total = drifts.reduce((s, d) => s + countFor(d), 0);
  const summary = `${drifts.length} drifts, ${total} plants, ${new Set(drifts.map((d) => d.plantId)).size} species`;
  return { ok: errors.length === 0, errors, warnings, plan, zones, summary };
}
