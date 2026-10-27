import { z } from "zod";
import { runChecks } from "../checks";
import { carveExisting, clipToLargest, effectivePoints, polygonArea } from "../geometry";
import { addDriftOps, applyOps, makeRoomOps, newId } from "../plan";
import { fitsSite, plantLibrary } from "../plants";
import { defaultSizeFor } from "../rules";
import { siteAt } from "../match";
import { bedRect, pair } from "./proposal";
import type { Bed, Drift, Plan, PlanOp } from "../types";

// Conversational edits: the agent describes changes to the current plan in
// the same bed-fraction frame it drafts in, and the server turns them into
// validated plan ops the editor applies as one undoable step.

export const ChangeSchema = z.object({
  type: z
    .enum(["add", "replacePlant", "remove", "resize", "reshape", "setSize", "swap"])
    .describe(
      "add: new drift of plantCode in the u/v rectangle (drifts underneath are trimmed to make room). replacePlant: change driftId to plantCode. remove: delete driftId. resize: scale driftId's area by factor. reshape: move/reshape driftId to the u/v rectangle. setSize: pot size of driftId. swap: exchange the plants of driftId and otherDriftId.",
    ),
  driftId: z.string().optional(),
  otherDriftId: z.string().optional(),
  plantCode: z.string().optional().describe("Library code, e.g. CEA-AME"),
  u: z.array(z.number()).optional().describe("[u0, u1] along the bed, 0 = left end, 1 = right end, seen from the front"),
  v: z.array(z.number()).optional().describe("[v0, v1] depth, 0 = back edge (house), 1 = front edge"),
  factor: z.number().optional().describe("Area factor for resize, e.g. 1.5 or 0.7"),
  size: z.enum(["plug", "1gal"]).optional().describe("Omit to use the default for the plant: plugs for perennials and grasses, 1 gal for shrubs."),
});

export const EditProposalSchema = z.object({
  summary: z.string().describe("One line for the homeowner describing the change, e.g. 'Added a low hedge of New Jersey tea along the back of the north end'."),
  changes: z.array(ChangeSchema).min(1),
});

export type Change = z.infer<typeof ChangeSchema>;

export type EditCheck = { ops: PlanOp[]; plan: Plan; errors: string[]; warnings: string[] };

/** Turns proposed changes into plan ops, applying them in order to a working copy of the plan. */
export function changesToOps(bed: Bed, plan: Plan, changes: Change[]): EditCheck {
  const outline = effectivePoints(bed.outline);
  const errors: string[] = [];
  const notes: string[] = [];
  const ops: PlanOp[] = [];
  const touched = new Set<string>();
  let working = plan;
  const push = (next: PlanOp[]) => {
    ops.push(...next);
    working = applyOps(working, next);
  };
  const drift = (id?: string) => (id ? working.drifts.find((d) => d.id === id) : undefined);
  const area = (c: Change, label: string) => {
    const u = pair(c.u ?? []);
    const v = pair(c.v ?? []);
    if (!u || !v) {
      errors.push(`${label}: u and v must each be two numbers between 0 and 1.`);
      return null;
    }
    const pts = carveExisting(clipToLargest(bedRect(bed, u, v), outline), bed);
    if (!pts || polygonArea(pts) < 1) {
      errors.push(`${label}: that rectangle falls outside the bed.`);
      return null;
    }
    return pts;
  };
  const checkSite = (plantId: string, d: Drift) => {
    const p = plantLibrary.get(plantId)!;
    const site = siteAt(bed, d);
    if (!fitsSite(p, site.sun, site.moisture)) {
      notes.push(`${p.code} prefers ${p.sun.join("/")} sun and ${p.moisture.join("/")} soil; this spot is ${site.sun ?? "?"} sun, ${site.moisture ?? "?"} soil.`);
    }
  };

  changes.forEach((c, i) => {
    const label = `Change ${i + 1} (${c.type})`;
    const plant = c.plantCode ? plantLibrary.byCode(c.plantCode) : undefined;
    if (c.plantCode && !plant) return errors.push(`${label}: ${c.plantCode} is not in the plant library.`);
    const target = drift(c.driftId);
    if (c.type !== "add" && !target) return errors.push(`${label}: no drift ${c.driftId ?? "(missing driftId)"} in the plan.`);
    switch (c.type) {
      case "add": {
        if (!plant) return errors.push(`${label}: plantCode is required.`);
        const pts = area(c, label);
        if (!pts) return;
        const d: Drift = { id: newId("d_"), plantId: plant.id, size: c.size ?? defaultSizeFor(plant), shape: { points: pts, smooth: true } };
        checkSite(plant.id, d);
        touched.add(d.id);
        return push(addDriftOps(working, d));
      }
      case "replacePlant": {
        if (!plant) return errors.push(`${label}: plantCode is required.`);
        checkSite(plant.id, target!);
        touched.add(target!.id);
        const size = c.size ?? defaultSizeFor(plant);
        return push([{ op: "setPlant", driftId: target!.id, plantId: plant.id }, ...(size !== target!.size ? [{ op: "setSize" as const, driftId: target!.id, size }] : [])]);
      }
      case "remove":
        return push([{ op: "removeDrift", driftId: target!.id }]);
      case "resize":
        if (!c.factor || c.factor <= 0.2 || c.factor >= 5) return errors.push(`${label}: factor must be between 0.2 and 5.`);
        touched.add(target!.id);
        return push([{ op: "scaleDrift", driftId: target!.id, factor: c.factor }]);
      case "reshape": {
        const pts = area(c, label);
        if (!pts) return;
        touched.add(target!.id);
        return push([{ op: "setShape", driftId: target!.id, shape: { points: pts, smooth: true } }, ...makeRoomOps(working, pts, target!.id)]);
      }
      case "setSize":
        if (!c.size) return errors.push(`${label}: size is required.`);
        return push([{ op: "setSize", driftId: target!.id, size: c.size }]);
      case "swap": {
        const other = drift(c.otherDriftId);
        if (!other) return errors.push(`${label}: no drift ${c.otherDriftId ?? "(missing otherDriftId)"} in the plan.`);
        touched.add(target!.id).add(other.id);
        return push([{ op: "swapPlants", driftA: target!.id, driftB: other.id }]);
      }
    }
  });

  // Problems the change itself introduces, so the agent can fix them before replying.
  const warnings = [
    ...notes,
    ...runChecks(bed, working)
      .filter((i) => (i.source === "overlap" || i.source === "height-order" || i.source === "outside-bed") && i.driftIds.some((id) => touched.has(id)))
      .map((i) => `${i.issue}. ${i.detail}`),
  ];
  return { ops, plan: working, errors, warnings };
}
