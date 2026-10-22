import templatesJson from "../../data/templates.json";
import { carveExisting, clipToLargest, effectivePoints, frameBounds, fromFrame, polygonArea } from "./geometry";
import { SEASON_MONTHS, rankPlants } from "./match";
import { emptyPlan, newId } from "./plan";
import { plantLibrary, sunClass } from "./plants";
import { defaultSizeFor } from "./rules";
import type { Bed, Drift, Plan, Plant, Template, TemplateSlot, Zone } from "./types";

export const templates = (templatesJson as unknown as { templates: Template[] }).templates;

export function getTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}

/** How well a template suits the bed: 2 = sun and moisture fit, 0 = neither. */
export function templateFit(t: Template, bed: Bed): number {
  const sun = sunClass(bed.conditions.sunHours);
  const moisture = bed.conditions.moisture;
  return (!sun || t.fits.sun.includes(sun) ? 1 : 0) + (!moisture || t.fits.moisture.includes(moisture) ? 1 : 0);
}

export function templatesFor(bed: Bed): { template: Template; fit: number }[] {
  return templates
    .map((template) => ({ template, fit: templateFit(template, bed) }))
    .sort((a, b) => b.fit - a.fit);
}

/** Best plant for a template slot given the bed's conditions. */
export function fillSlot(slot: TemplateSlot, bed: Bed, avoid: Set<string>): Plant | undefined {
  const sun = sunClass(bed.conditions.sunHours);
  const moisture = bed.conditions.moisture;
  const soil = bed.conditions.soil;
  const months = slot.season ? SEASON_MONTHS[slot.season] : [];
  const ranked = rankPlants({ sun, moisture, soil, tier: slot.tier, months, kind: slot.kind });
  const fits = new Set(ranked.map((r) => r.plant.id));
  // Preferred codes win when they fit the site; avoid repeating a plant in one plan.
  for (const code of slot.prefer) {
    const p = plantLibrary.byCode(code);
    if (p && fits.has(p.id) && !avoid.has(p.id) && (!soil || p.soil.includes(soil))) return p;
  }
  return ranked.find((r) => !avoid.has(r.plant.id))?.plant ?? ranked[0]?.plant;
}

/**
 * Scales a template to the bed outline: rows run back to front, columns end
 * to end, each cell skewed a little so neighbouring drifts interlock. Cells
 * are clipped to the outline.
 */
export function applyTemplate(t: Template, bed: Bed): { plan: Plan; zones: Zone[] } {
  const o = bed.conditions.orientation;
  const outline = effectivePoints(bed.outline);
  if (outline.length < 3) return { plan: emptyPlan(), zones: [] };
  const fb = frameBounds(outline, o);
  const W = fb.maxL - fb.minL;
  const D = fb.maxD - fb.minD;
  const at = (u: number, v: number) => fromFrame({ l: fb.minL + u * W, d: fb.minD + v * D }, o);

  const drifts: Drift[] = [];
  const zones: Zone[] = [];
  const zoneNotes: Record<string, string> = {};
  const used = new Set<string>();

  for (const row of t.rows) {
    const [v0, v1] = row.v;
    const zoneRect = [at(0, v0), at(1, v0), at(1, v1), at(0, v1)];
    const zonePoly = clipToLargest(zoneRect, outline);
    const zoneId = newId("z_");
    if (zonePoly) zones.push({ id: zoneId, name: row.zone, shape: { points: zonePoly } });

    const edges = [0, ...row.breaks, 1];
    const names: string[] = [];
    for (let i = 0; i < row.slots.length; i++) {
      // Skew interior column edges: shifted one way at the back of the row, the other at the front.
      const shift = (u: number) => (u <= 0 || u >= 1 ? [u, u] : [u - row.skew / 2, u + row.skew / 2]);
      const [a0, a1] = shift(edges[i]);
      const [b0, b1] = shift(edges[i + 1]);
      const cell = [at(a0, v0), at(b0, v0), at(b1, v1), at(a1, v1)];
      const clipped = carveExisting(clipToLargest(cell, outline), bed);
      if (!clipped || polygonArea(clipped) < 1) continue;
      const plant = fillSlot(row.slots[i], bed, used);
      if (!plant) continue;
      used.add(plant.id);
      names.push(plant.common);
      drifts.push({
        id: newId("d_"),
        plantId: plant.id,
        size: defaultSizeFor(plant),
        shape: { points: clipped, smooth: true },
      });
    }
    if (names.length) zoneNotes[zoneId] = `${names.join(", ")}.`;
  }
  return { plan: { drifts, zoneNotes }, zones };
}
