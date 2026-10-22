import { effectivePoints, frameBounds, regionNames, round, shapeArea, toFrame } from "../geometry";
import { countFor } from "../plan";
import { plantLibrary, sunClass } from "../plants";
import { MONTHS, rules, tierOf } from "../rules";
import type { Bed, Plan, Plant, Pt } from "../types";

// Compact text views of the bed, plan and plants for model prompts.

export function bedFrame(bed: Bed) {
  const o = bed.conditions.orientation;
  const fb = frameBounds(effectivePoints(bed.outline), o);
  const W = fb.maxL - fb.minL;
  const D = fb.maxD - fb.minD;
  const uv = (p: Pt) => {
    const f = toFrame(p, o);
    return { u: round((f.l - fb.minL) / (W || 1), 2), v: round((f.d - fb.minD) / (D || 1), 2) };
  };
  return { W, D, uv };
}

export function plantLine(p: Plant): string {
  const bloom = p.bloomMonths.length ? p.bloomMonths.map((m) => MONTHS[m - 1]).join(" ") : "no flowers";
  return `${p.code} | ${p.common} (${p.botanical}) | ${p.type}, ${tierOf(p)} tier, ${p.heightIn}" tall, ${p.spacingIn}" spacing | blooms ${bloom}, ${p.bloomColorName}${p.showy ? "" : " (not showy)"} | sun ${p.sun.join("/")} | moisture ${p.moisture.join("/")}${p.winterInterest ? ` | winter: ${p.winterInterest}` : ""}`;
}

export function describeBed(bed: Bed) {
  const c = bed.conditions;
  const { W, D, uv } = bedFrame(bed);
  const ends = regionNames(c.orientation, 2);
  return {
    name: bed.name,
    lengthFt: round(W),
    depthFt: round(D),
    areaSqFt: round(shapeArea(bed.outline)),
    faces: c.orientation,
    uAxis: `u = 0 is the ${ends[0].replace(" half", " end")}, u = 1 the ${ends[1].replace(" half", " end")} (left to right seen from the front)`,
    vAxis: "v = 0 is the back edge (house side), v = 1 the front edge",
    sunHours: c.sunHours,
    sun: sunClass(c.sunHours),
    soil: c.soil,
    moisture: c.moisture,
    canopy: c.canopy,
    notes: c.notes || undefined,
    zones: bed.zones.map((z) => ({ name: z.name, sunHours: z.sunHours ?? undefined, moisture: z.moisture ?? undefined })),
    existingPlants: bed.existing.map((e) => ({ name: e.name, action: e.action, at: uv(e.position), radiusFt: e.radiusFt })),
    designRules: {
      tiers: rules.tiers.map((t) => `${t.id} up to ${t.maxHeightIn}"`).join(", "),
      minPlantsPerDrift: rules.minDriftCount,
      preferredPlantsPerDrift: rules.preferredDriftCount,
      bloomWindow: `${MONTHS[rules.bloomWindow[0] - 1]}–${MONTHS[rules.bloomWindow[1] - 1]} in each third of the bed`,
      maxSpecies: Math.max(4, Math.round((shapeArea(bed.outline) / 100) * rules.maxSpeciesPer100SqFt)),
    },
  };
}

export function describePlan(bed: Bed, plan: Plan) {
  const { uv } = bedFrame(bed);
  return plan.drifts.map((d) => {
    const p = plantLibrary.get(d.plantId);
    const pts = effectivePoints(d.shape).map(uv);
    return {
      driftId: d.id,
      code: p?.code ?? d.plantId,
      common: p?.common,
      heightIn: p?.heightIn,
      blooms: p?.bloomMonths.map((m) => MONTHS[m - 1]).join(" "),
      count: countFor(d),
      size: d.size,
      u: [Math.min(...pts.map((q) => q.u)), Math.max(...pts.map((q) => q.u))],
      v: [Math.min(...pts.map((q) => q.v)), Math.max(...pts.map((q) => q.v))],
    };
  });
}
