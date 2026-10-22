import { effectivePoints, intersectionArea, regionNames, shapeCentroid } from "../geometry";
import { countFor } from "../plan";
import { plantLibrary } from "../plants";
import { MONTH_NAMES } from "../rules";
import { bedFrame } from "../agent/describe";
import type { Bed, Drift, Plan } from "../types";

export const RENDER_MONTHS = [5, 7, 9, 1];

const SEASON: Record<number, string> = {
  1: "Midwinter in Michigan: plants are dormant, stems and seed heads left standing, light snow on the ground is likely, low winter sun.",
  2: "Late winter: dormant stems, patchy snow.",
  3: "Early spring: beds mostly bare with fresh shoots just emerging.",
  4: "April: low new growth, the earliest wildflowers opening.",
  5: "May: fresh green growth at about half of mature height, spring flowers open.",
  6: "June: lush growth close to full height.",
  7: "July: full height, peak summer color.",
  8: "August: full height, late-summer color, grasses starting to flower.",
  9: "September: full height, asters and goldenrods in bloom, grasses turning warm colors.",
  10: "October: fall color, seed heads, grasses copper and tan.",
  11: "November: dormant, tan and brown stems and seed heads standing.",
  12: "December: dormant stems and seed heads, possible snow.",
};

function driftPhrase(d: Drift, month: number): string | null {
  const p = plantLibrary.get(d.plantId);
  if (!p) return null;
  const n = countFor(d);
  const blooming = p.bloomMonths.includes(month);
  const dormant = month <= 3 || month >= 11;
  const growth = month === 5 ? Math.round(p.heightIn * 0.5) : month === 4 ? Math.round(p.heightIn * 0.25) : p.heightIn;
  let look: string;
  if (dormant) look = p.winterInterest ? `dormant, showing ${p.winterInterest}` : "dormant, dry tan stems";
  else if (blooming) look = `in bloom with ${p.bloomColorName} flowers${p.showy ? "" : " (subtle)"}, ${p.foliage} foliage`;
  else look = `${p.foliage} foliage, not flowering`;
  const height = dormant ? "" : `, about ${growth} in tall`;
  return `a drift of ${n} ${p.common} (${p.botanical})${height}, ${look}`;
}

/** Groups drifts into back / middle / front bands, then left / middle / right. */
function describeLayout(bed: Bed, plan: Plan, month: number): string[] {
  const { uv } = bedFrame(bed);
  const ends = regionNames(bed.conditions.orientation, 3);
  const bands: { name: string; drifts: { u: number; text: string }[] }[] = [
    { name: "Back row, against the house", drifts: [] },
    { name: "Middle", drifts: [] },
    { name: "Front edge", drifts: [] },
  ];
  // Prefer the bed's own zones when they exist; each drift goes to the zone it mostly sits in.
  if (bed.zones.length) {
    const byZone = new Map<string, { u: number; text: string }[]>();
    for (const d of plan.drifts) {
      const text = driftPhrase(d, month);
      if (!text) continue;
      const pts = effectivePoints(d.shape);
      let best: string | null = null;
      let bestArea = 0;
      for (const z of bed.zones) {
        const a = intersectionArea(pts, effectivePoints(z.shape));
        if (a > bestArea) [best, bestArea] = [z.id, a];
      }
      if (!best) continue;
      const c = uv(shapeCentroid(d.shape));
      const where = c.u < 0.33 ? ends[0] : c.u > 0.67 ? ends[2] : "middle";
      byZone.set(best, [...(byZone.get(best) ?? []), { u: c.u, text: `${text} (${where})` }]);
    }
    return bed.zones.map((z) => {
      const items = (byZone.get(z.id) ?? []).sort((a, b) => a.u - b.u).map((x) => x.text);
      return `${z.name}: ${items.length ? items.join("; ") : "mulch"}.`;
    });
  }
  for (const d of plan.drifts) {
    const c = uv(shapeCentroid(d.shape));
    const text = driftPhrase(d, month);
    if (!text) continue;
    const band = c.v < 0.38 ? 0 : c.v < 0.7 ? 1 : 2;
    const where = c.u < 0.33 ? ends[0] : c.u > 0.67 ? ends[2] : "middle";
    bands[band].drifts.push({ u: c.u, text: `${text} (${where})` });
  }
  return bands
    .filter((b) => b.drifts.length)
    .map((b) => `${b.name}: ${b.drifts.sort((x, y) => x.u - y.u).map((d) => d.text).join("; ")}.`);
}

export function buildRenderPrompt(bed: Bed, plan: Plan, month: number, viewpoint: "street" | "overhead"): string {
  const { W, D } = bedFrame(bed);
  const layout = describeLayout(bed, plan, month);
  const keep = bed.existing.filter((e) => e.action === "keep").map((e) => e.name);
  const remove = bed.existing.filter((e) => e.action === "remove").map((e) => e.name);
  const intro =
    viewpoint === "street"
      ? `Edit this photo of the house to show the ${bed.name.toLowerCase()} (about ${Math.round(W)} ft long and ${Math.round(D)} ft deep, facing ${bed.conditions.orientation}) replanted as a native perennial garden. Keep the house, walks, driveway, lawn, trees, sky and camera angle exactly as they are; change only the planting bed.`
      : `Using this aerial image for context, render a top-down view of the ${bed.name.toLowerCase()} (about ${Math.round(W)} by ${Math.round(D)} ft) replanted as a native perennial garden.`;
  return [
    intro,
    `Month: ${MONTH_NAMES[month - 1]}. ${SEASON[month]}`,
    "Plants grow in naturalistic, interlocking drifts with shredded hardwood mulch between them; tallest plants at the back, shortest along the front edge.",
    "Planting, left to right as seen from the street:",
    ...layout,
    keep.length ? `Keep these existing plants as they are: ${keep.join(", ")}.` : "",
    remove.length ? `These existing plants have been removed: ${remove.join(", ")}.` : "",
    "Photorealistic, natural daylight, same lens and perspective as the reference. No text, labels or people.",
  ]
    .filter(Boolean)
    .join("\n");
}
