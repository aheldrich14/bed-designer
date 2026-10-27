import { effectivePoints, formatFtIn, intersectionArea, regionNames, shapeCentroid } from "../geometry";
import { countFor } from "../plan";
import { plantLibrary } from "../plants";
import { MONTH_NAMES } from "../rules";
import { bedFrame } from "../agent/describe";
import { describeSite } from "./site";
import type { Bed, Drift, Plan, Project } from "../types";

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

export type RenderPromptOptions = {
  project?: Project | null;
  /** A to-scale overhead site plan is attached as the second image. */
  sitePlan?: boolean;
};

const DOOR_FT = 7;

/** Height cues tied to things in the photo, so plants come out at true size. */
function scaleLines(plan: Plan, month: number): string[] {
  const heights = plan.drifts.map((d) => plantLibrary.get(d.plantId)?.heightIn).filter((h): h is number => h != null).sort((a, b) => a - b);
  if (!heights.length) return [];
  const factor = month <= 3 || month >= 11 ? 0.8 : month === 4 ? 0.25 : month === 5 ? 0.5 : 1;
  const tallest = (heights[heights.length - 1] * factor) / 12;
  const typical = (heights[Math.floor(heights.length / 2)] * factor) / 12;
  const share = (ft: number) => (ft / DOOR_FT < 0.3 ? "well under half" : ft / DOOR_FT < 0.6 ? "about half" : ft / DOOR_FT < 0.85 ? "about two thirds" : "nearly all");
  return [
    `Plant size: the tallest plants are about ${formatFtIn(tallest)} tall right now, ${share(tallest)} the height of a ${DOOR_FT} ft front door; most are about ${formatFtIn(typical)} (knee to waist high on an adult). Each plant is only 1 to 2 ft across. Keep every plant at this true scale relative to the house, door and windows; do not enlarge them.`,
  ];
}

export function buildRenderPrompt(bed: Bed, plan: Plan, month: number, viewpoint: "street" | "overhead", opts: RenderPromptOptions = {}): string {
  const { W, D } = bedFrame(bed);
  const layout = describeLayout(bed, plan, month);
  const keep = bed.existing.filter((e) => e.action === "keep").map((e) => e.name);
  const remove = bed.existing.filter((e) => e.action === "remove").map((e) => e.name);
  const site = describeSite(bed, opts.project);
  const images =
    viewpoint === "street"
      ? opts.sitePlan
        ? "Image 1 is a photo of the house to edit. Image 2 is a to-scale overhead site plan of the same yard (north up, dimensions in feet): the bed outline is drawn in brown with its planting drifts colored, the house in dark gray, walks and drive in light gray, and orange dashed lines mark measured gaps. Use image 2 only to judge the bed's true size and where it sits relative to the house, walk and lawn; do not draw the plan, its labels or its colors into the photo."
        : "Edit the attached photo of the house."
      : opts.sitePlan
        ? "Image 1 is an aerial photo of the property. Image 2 is a to-scale site plan of the same area (north up, dimensions in feet) with the bed outlined in brown and its planting drifts colored. Match the bed's size, shape and position to image 2 exactly."
        : "Use the attached aerial image for context.";
  const intro =
    viewpoint === "street"
      ? `${images}\nShow the ${bed.name.toLowerCase()} (about ${Math.round(W)} ft long and ${Math.round(D)} ft deep, facing ${bed.conditions.orientation}) replanted as a native perennial garden. Keep the house, walks, driveway, lawn, trees, sky and camera angle exactly as they are; change only the planting bed, and keep the bed's edges where they are now.`
      : `${images}\nRender a top-down view of the ${bed.name.toLowerCase()} (about ${Math.round(W)} by ${Math.round(D)} ft) replanted as a native perennial garden.`;
  const existing =
    viewpoint === "street"
      ? [
          `Clear the bed first: remove every shrub, perennial, groundcover and weed now growing inside the bed${remove.length ? `, including the ${remove.join(", ")}` : ""}. ${keep.length ? `The only existing plants that stay are: ${keep.join(", ")}; leave them exactly as they are.` : "No existing plants stay."} Nothing else from the old planting may remain in the new picture.`,
        ]
      : [
          keep.length ? `Keep these existing plants as they are: ${keep.join(", ")}.` : "",
          remove.length ? `These existing plants have been removed: ${remove.join(", ")}.` : "",
        ];
  return [
    intro,
    site.length ? "Scale and placement, measured on the site plan:" : "",
    ...site.map((l) => `- ${l}`),
    ...scaleLines(plan, month),
    `Month: ${MONTH_NAMES[month - 1]}. ${SEASON[month]}`,
    ...existing,
    "Plants grow in naturalistic, interlocking drifts with shredded hardwood mulch between them; tallest plants at the back, shortest along the front edge.",
    "Planting, left to right as seen from the street:",
    ...layout,
    "Photorealistic, natural daylight, same lens and perspective as the reference. No text, labels or people.",
  ]
    .filter(Boolean)
    .join("\n");
}
