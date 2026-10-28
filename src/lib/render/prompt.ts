import { effectivePoints, formatFtIn, intersectionArea, regionNames, shapeCentroid } from "../geometry";
import { countFor } from "../plan";
import { plantLibrary } from "../plants";
import { MONTH_NAMES } from "../rules";
import { bedFrame } from "../agent/describe";
import { describeSite, siteGaps } from "./site";
import type { Bed, Drift, Plan, Plant, Project } from "../types";

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

const isDormant = (month: number) => month <= 3 || month >= 11;

/** How tall a plant stands in a given month, in inches. */
function heightNow(p: Plant, month: number): number {
  const factor = isDormant(month) ? 0.8 : month === 4 ? 0.25 : month === 5 ? 0.5 : 1;
  return Math.round(p.heightIn * factor);
}

/** Where a height falls on an adult standing beside the plant. */
function onAnAdult(inches: number): string {
  if (inches <= 8) return "ankle high";
  if (inches <= 14) return "mid-shin";
  if (inches <= 21) return "just below the knee";
  if (inches <= 27) return "knee high";
  if (inches <= 34) return "mid-thigh";
  if (inches <= 42) return "waist high";
  if (inches <= 54) return "chest high";
  if (inches <= 64) return "shoulder high";
  return "about head high";
}

/** Counts read as density; image models can't count plants, and big numbers make them overfill. */
function massWord(n: number): string {
  return n <= 3 ? "a small group" : n <= 8 ? "a cluster" : n <= 20 ? "a drift" : "a broad sweep";
}

function driftPhrase(d: Drift, month: number): string | null {
  const p = plantLibrary.get(d.plantId);
  if (!p) return null;
  const blooming = p.bloomMonths.includes(month);
  const dormant = isDormant(month);
  // Botanical name first: some common names ("ox-eye sunflower") pull in the wrong, much bigger plant.
  const name = `${p.botanical} (${p.common})`;
  let look: string;
  if (dormant) look = p.winterInterest ? `dormant, showing ${p.winterInterest}` : "dormant, dry tan stems";
  else if (blooming) look = `in bloom with ${p.bloomColorName}${p.flowerForm ? ` ${p.flowerForm}` : " flowers"}${p.showy ? "" : " (subtle)"}, ${p.foliage} foliage`;
  else look = `${p.foliage} foliage, not flowering`;
  const height = dormant ? "" : `, about ${formatFtIn(heightNow(p, month) / 12)} tall`;
  return `${massWord(countFor(d))} of ${name}${height}, ${look}`;
}

/** Groups drifts into back / middle / front bands, then left / middle / right. */
function describeLayout(bed: Bed, plan: Plan, month: number): string[] {
  const { uv } = bedFrame(bed);
  const ends = regionNames(bed.conditions.orientation, 3);
  const bands: { name: string; drifts: { u: number; text: string }[] }[] = [
    { name: "Back row, against the house", drifts: [] },
    { name: "Middle", drifts: [] },
    { name: "Front edge, closest to the camera", drifts: [] },
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
  /** Image 1 is the photo after the clearing pass: the bed is already bare mulch. */
  cleared?: boolean;
};

const DOOR_FT = 7;

const planPlants = (plan: Plan) => plan.drifts.map((d) => plantLibrary.get(d.plantId)).filter((p): p is Plant => !!p);

/**
 * Height cues tied to things at the same distance from the camera. Plants at
 * the front of a deep bed sit far closer to the lens than the house, so
 * comparing them to the door makes the model draw them too big. Shrubs are
 * called out on their own so a few tall ones don't set the scale for the
 * whole bed.
 */
function scaleLines(bed: Bed, plan: Plan, month: number, project: Project | null | undefined): string[] {
  const plants = planPlants(plan);
  if (!plants.length) return [];
  const perennials = plants.filter((p) => p.type !== "shrub");
  const shrubs = [...new Map(plants.filter((p) => p.type === "shrub").map((p) => [p.id, p])).values()];
  const base = perennials.length ? perennials : plants;
  const heights = base.map((p) => heightNow(p, month)).sort((a, b) => a - b);
  const spreads = base.map((p) => p.spreadIn).sort((a, b) => a - b);
  const [low, high] = [heights[0], heights[heights.length - 1]];
  const lines = [
    "Plant size: judge each plant against things at the same distance from the camera, not against the house behind the bed.",
    `- The shortest plants, along the front edge nearest the camera, are about ${formatFtIn(low / 12)} tall: ${onAnAdult(low)} on an adult standing on the walk.`,
    `- The tallest ${perennials.length && shrubs.length ? "perennials" : "plants"} are about ${formatFtIn(high / 12)} tall: ${onAnAdult(high)} on an adult.${perennials.length && shrubs.length ? "" : " Nothing in the bed is taller than that."}`,
  ];
  if (perennials.length && shrubs.length) {
    const shrubHigh = Math.max(...shrubs.map((p) => heightNow(p, month)));
    lines.push(`- The only plants taller than that are the ${shrubs.map((p) => p.common).join(" and ")} shrubs, about ${formatFtIn(shrubHigh / 12)} tall, each one a separate shrub, never a hedge.`);
  }
  const house = siteGaps(bed, project).find((g) => g.kind === "house");
  if (house && house.gapFt < 6 && high <= 54) {
    lines.push(
      `- Seen from the street, the back-row plants cover only the house foundation and the bottom of any porch railing. The front door, porch and ground-floor windows stay clearly visible above them${shrubs.length && perennials.length ? ", except right behind a shrub" : ""}.`,
    );
  }
  if (house && house.gapFt < 3) {
    const share = high / 12 / DOOR_FT;
    const words = share < 0.3 ? "well under half" : share < 0.6 ? "about half" : share < 0.85 ? "about two thirds" : "nearly all";
    lines.push(`- At the back, against the house, the tallest ${perennials.length && shrubs.length ? "perennials" : "plants"} reach ${words} the height of the ${DOOR_FT} ft front door.`);
  }
  const across = spreads[0] === spreads[spreads.length - 1] ? formatFtIn(spreads[0] / 12) : `${formatFtIn(spreads[0] / 12)} to ${formatFtIn(spreads[spreads.length - 1] / 12)}`;
  lines.push(`- Each ${perennials.length && shrubs.length ? "perennial" : "plant"} is only ${across} across. A drift is many of these small, separate plants massed together, not one large bush.`);
  return lines;
}

/** Tallest non-shrub height this month, in inches; the closing size rule. */
function tallestPerennial(plan: Plan, month: number): number {
  if (isDormant(month)) return 0;
  const plants = planPlants(plan);
  const perennials = plants.filter((p) => p.type !== "shrub");
  return Math.max(0, ...(perennials.length ? perennials : plants).map((p) => heightNow(p, month)));
}

function imagesLine(viewpoint: "street" | "overhead", sitePlan: boolean | undefined, drifts = true): string {
  if (viewpoint === "overhead") {
    return sitePlan
      ? "Image 1 is an aerial photo of the property. Image 2 is a to-scale site plan of the same area (north up, dimensions in feet) with the bed outlined in brown and its planting drifts colored. Match the bed's size, shape and position to image 2 exactly."
      : "Use the attached aerial image for context.";
  }
  return sitePlan
    ? `Image 2 is a to-scale overhead site plan of the same yard (north up, dimensions in feet): the bed outline is drawn in brown${drifts ? " with its planting drifts colored" : ""}, the house in dark gray, walks and drive in light gray. Use image 2 only to judge the bed's true size and where it sits relative to the house, walk and lawn. Do not copy anything from image 2 into the photo: no outlines, lines, dashes, numbers, labels or plan colors.`
    : "";
}

const KEEP_SCENE =
  "Return the same photograph with only the planting bed changed. The house, roof, windows, porch, walks, driveway, cars, lawn, trees, sky, lighting, shadows and camera framing stay exactly as they are in image 1.";

/**
 * Pass 1 of a street render: the photo with the bed emptied to bare mulch.
 * Editing in two small steps keeps old shrubs from surviving into the
 * planted render and keeps the model from redrawing the house.
 */
export function buildClearPrompt(bed: Bed, opts: RenderPromptOptions = {}): string {
  const { W, D } = bedFrame(bed);
  const keep = bed.existing.filter((e) => e.action === "keep").map((e) => e.name);
  const remove = bed.existing.filter((e) => e.action === "remove").map((e) => e.name);
  const site = describeSite(bed, opts.project);
  return [
    `Edit image 1, a street-level photo of a house. ${KEEP_SCENE}`,
    imagesLine("street", opts.sitePlan, false),
    `The change: clear the ${bed.name.toLowerCase()} (about ${Math.round(W)} ft long and ${Math.round(D)} ft deep, facing ${bed.conditions.orientation}). Remove every plant growing inside it: shrubs, including rounded evergreen shrubs like boxwood or yew, perennials, grasses, groundcovers and weeds${remove.length ? `, including the ${remove.join(", ")}` : ""}.`,
    keep.length ? `The only existing plants that stay are: ${keep.join(", ")}; leave them exactly as they are.` : "",
    "Any hedge or row of clipped shrubs along the house foundation or porch is inside the bed: remove it completely, roots and all, so the house foundation and the base of the porch show behind bare ground.",
    "Show the whole bed, from the house foundation out to its front edge, as freshly spread, dark brown shredded hardwood mulch with a clean edge where it meets the lawn. Keep the bed's edges where they are now.",
    site.length ? "Bed placement, measured on the site plan:" : "",
    ...site.map((l) => `- ${l}`),
    "Photorealistic, natural daylight, same lens and perspective as image 1. No text, labels or people.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRenderPrompt(bed: Bed, plan: Plan, month: number, viewpoint: "street" | "overhead", opts: RenderPromptOptions = {}): string {
  const { W, D } = bedFrame(bed);
  const layout = describeLayout(bed, plan, month);
  const keep = bed.existing.filter((e) => e.action === "keep").map((e) => e.name);
  const remove = bed.existing.filter((e) => e.action === "remove").map((e) => e.name);
  const site = describeSite(bed, opts.project);
  const scale = scaleLines(bed, plan, month, opts.project);
  const size = `about ${Math.round(W)} ft long and ${Math.round(D)} ft deep, facing ${bed.conditions.orientation}`;

  if (viewpoint === "overhead") {
    return [
      imagesLine("overhead", opts.sitePlan),
      `Render a top-down view of the ${bed.name.toLowerCase()} (about ${Math.round(W)} by ${Math.round(D)} ft) replanted as a native perennial garden.`,
      keep.length ? `Keep these existing plants as they are: ${keep.join(", ")}.` : "",
      remove.length ? `These existing plants have been removed: ${remove.join(", ")}.` : "",
      `Month: ${MONTH_NAMES[month - 1]}. ${SEASON[month]}`,
      "Plants grow in naturalistic, interlocking drifts with shredded hardwood mulch between them.",
      "Planting, left to right as seen from the street:",
      ...layout,
      "Photorealistic, natural daylight. No text, labels or people.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Order matters: what to preserve first, then the bed, then sizes and planting, with the size rule repeated last.
  const bedState = opts.cleared
    ? `In image 1 the ${bed.name.toLowerCase()} (${size}) has already been cleared to bare shredded hardwood mulch. Plant only inside that mulched area and keep its edges where they are. If any hedge or old shrub is still standing along the house or porch, remove it; the new plants grow from the mulch at ground level, never on top of or behind an old hedge. Do not bring back any plants that were removed.`
    : `The change: replant the ${bed.name.toLowerCase()} (${size}) and keep its edges where they are. First remove every shrub, perennial, groundcover and weed now growing inside the bed${remove.length ? `, including the ${remove.join(", ")}` : ""}. ${keep.length ? `The only existing plants that stay are: ${keep.join(", ")}; leave them exactly as they are.` : "No existing plants stay."}`;
  const tallest = tallestPerennial(plan, month);
  return [
    `Edit image 1, a street-level photo of a house, to show its front bed as a native perennial garden. ${KEEP_SCENE}`,
    imagesLine("street", opts.sitePlan),
    bedState,
    site.length ? (opts.sitePlan ? "Bed placement, measured on the site plan:" : "Bed placement, as measured:") : "",
    ...site.map((l) => `- ${l}`),
    ...scale,
    `Month: ${MONTH_NAMES[month - 1]}. ${SEASON[month]}`,
    "Plants grow in naturalistic, interlocking drifts with shredded hardwood mulch showing between them; tallest plants at the back, shortest along the front edge.",
    "Planting, left to right as seen from the street:",
    ...layout,
    `Photorealistic, natural daylight, same lens and perspective as image 1. No text, labels or people. Keep every plant at its true size${tallest ? `, no perennial taller than ${formatFtIn(tallest / 12)}` : ""}, and keep the house exactly as it is in image 1.`,
  ]
    .filter(Boolean)
    .join("\n");
}
