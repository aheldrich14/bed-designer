import {
  carveExisting, circlePolygon, clipToLargest, differenceArea, dist, effectivePoints, frameBounds, fromFrame, intersectionArea,
  polygonArea, regionNames, shapeArea, shapeCentroid, toFrame, unionArea,
} from "./geometry";
import { driftCount, driftForCount, newId } from "./plan";
import { fitsSite, plantLibrary } from "./plants";
import { MONTH_NAMES, rules as defaultRules, tierOf, type DesignRules } from "./rules";
import { kindOf, rankPlants, siteAt } from "./match";
import type { Bed, Drift, Plan, PlanOp, Plant, Pt } from "./types";

/** A deterministic finding. The review turns these into suggestions. */
export type Issue = {
  key: string;
  source: "height-order" | "bloom-gap" | "lone-plants" | "overlap" | "outside-bed" | "site-fit" | "coverage" | "species-count" | "palette" | "existing-plant";
  severity: "info" | "warn" | "error";
  issue: string;
  detail: string;
  driftIds: string[];
  anchor: Pt | null;
  ops: PlanOp[];
};

type Ctx = { bed: Bed; plan: Plan; rules: DesignRules; plants: Map<string, Plant> };

export function runChecks(bed: Bed, plan: Plan, r: DesignRules = defaultRules): Issue[] {
  const plants = new Map<string, Plant>();
  for (const d of plan.drifts) {
    const p = plantLibrary.get(d.plantId);
    if (p) plants.set(d.id, p);
  }
  const ctx: Ctx = { bed, plan, rules: r, plants };
  if (bed.outline.points.length < 3) return [];
  return [
    ...heightOrder(ctx),
    ...bloomGaps(ctx),
    ...lonePlants(ctx),
    ...overlaps(ctx),
    ...outsideBed(ctx),
    ...siteFit(ctx),
    ...existingPlants(ctx),
    ...coverage(ctx),
    ...speciesCount(ctx),
    ...palette(ctx),
  ];
}

const label = (p: Plant) => `${p.common} (${p.code})`;

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ---- Height order: taller plants belong behind shorter ones -------------

function heightOrder({ bed, plan, rules, plants }: Ctx): Issue[] {
  const o = bed.conditions.orientation;
  const info = plan.drifts
    .filter((d) => plants.has(d.id))
    .map((d) => {
      const pts = effectivePoints(d.shape);
      const fb = frameBounds(pts, o);
      return { d, p: plants.get(d.id)!, c: shapeCentroid(d.shape), fb, depth: toFrame(shapeCentroid(d.shape), o).d };
    });
  const issues: Issue[] = [];
  const used = new Set<string>();
  const pairs: { front: (typeof info)[number]; back: (typeof info)[number]; diff: number }[] = [];
  for (const a of info) {
    for (const b of info) {
      if (a === b) continue;
      // a is in front of b, and they share a sight line (overlap end to end).
      const overlap = Math.min(a.fb.maxL, b.fb.maxL) - Math.max(a.fb.minL, b.fb.minL);
      const narrow = Math.min(a.fb.maxL - a.fb.minL, b.fb.maxL - b.fb.minL);
      if (overlap < Math.max(0.5, narrow * 0.3)) continue;
      if (a.depth - b.depth < 0.75) continue;
      const diff = a.p.heightIn - b.p.heightIn;
      if (diff > rules.heightOrderToleranceIn) pairs.push({ front: a, back: b, diff });
    }
  }
  pairs.sort((x, y) => y.diff - x.diff);
  for (const { front, back } of pairs) {
    if (used.has(front.d.id) || used.has(back.d.id)) continue;
    used.add(front.d.id);
    used.add(back.d.id);
    issues.push({
      key: `height:${front.d.id}:${back.d.id}`,
      source: "height-order",
      severity: "warn",
      issue: `Tall plant in front of a short one: swap these drifts`,
      detail: `${label(front.p)} at ${front.p.heightIn}" stands in front of ${label(back.p)} at ${back.p.heightIn}". Swapping puts the taller drift at the back.`,
      driftIds: [front.d.id, back.d.id],
      anchor: mid(front.c, back.c),
      ops: [{ op: "swapPlants", driftA: front.d.id, driftB: back.d.id }],
    });
  }
  return issues;
}

// ---- Bloom gaps per region of the bed -----------------------------------

type Region = { name: string; poly: Pt[]; center: Pt };

export function bedRegions(bed: Bed, count: number): Region[] {
  const o = bed.conditions.orientation;
  const outline = effectivePoints(bed.outline);
  const fb = frameBounds(outline, o);
  const names = regionNames(o, count);
  const width = (fb.maxL - fb.minL) / count;
  const regions: Region[] = [];
  for (let i = 0; i < count; i++) {
    const l0 = fb.minL + i * width;
    const l1 = l0 + width;
    const rect = [
      { l: l0, d: fb.minD - 1 }, { l: l1, d: fb.minD - 1 }, { l: l1, d: fb.maxD + 1 }, { l: l0, d: fb.maxD + 1 },
    ].map((p) => fromFrame(p, o));
    const poly = clipToLargest(rect, outline) ?? rect;
    regions.push({ name: names[i], poly, center: shapeCentroid({ points: poly }) });
  }
  return regions;
}

function monthsLabel(months: number[]): string {
  const names = months.map((m) => MONTH_NAMES[m - 1]);
  if (names.length <= 2) return names.join(" and ");
  // Consecutive runs read better as ranges.
  const consecutive = months.every((m, i) => i === 0 || m === months[i - 1] + 1);
  if (consecutive) return `${names[0]} through ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function bloomGaps(ctx: Ctx): Issue[] {
  const { bed, plan, rules, plants } = ctx;
  const regions = bedRegions(bed, rules.bloomRegions);
  const [m0, m1] = rules.bloomWindow;
  const window: number[] = [];
  for (let m = m0; m <= m1; m++) window.push(m);
  const issues: Issue[] = [];
  if (plan.drifts.length === 0) return issues;

  const driftsIn = (region: Region) =>
    plan.drifts.filter((d) => plants.has(d.id) && intersectionArea(effectivePoints(d.shape), region.poly) > 0.5);
  const gapMonths = (drifts: Drift[], override?: { id: string; plant: Plant }) =>
    window.filter(
      (m) =>
        !drifts.some((d) => {
          const p = override && override.id === d.id ? override.plant : plants.get(d.id)!;
          return p.showy && p.bloomMonths.includes(m);
        }),
    );

  for (const region of regions) {
    const inRegion = driftsIn(region);
    const gaps = gapMonths(inRegion);
    if (!gaps.length) continue;
    const site = siteAt(bed, null);
    let ops: PlanOp[] = [];
    let fix = "";
    // Try replacing one drift in the region with a plant that closes the most gap months.
    let best: { drift: Drift; plant: Plant; remaining: number } | null = null;
    for (const d of inRegion) {
      const cur = plants.get(d.id)!;
      const s = siteAt(bed, d);
      const candidates = rankPlants({ ...s, tier: tierOf(cur), months: gaps, excludeIds: [cur.id] }).slice(0, 8);
      for (const { plant } of candidates) {
        const remaining = gapMonths(inRegion, { id: d.id, plant }).length;
        if (remaining < gaps.length && (!best || remaining < best.remaining)) best = { drift: d, plant, remaining };
      }
    }
    if (best) {
      ops = [{ op: "setPlant", driftId: best.drift.id, plantId: best.plant.id }];
      fix = `Try ${label(best.plant)} in place of ${label(plants.get(best.drift.id)!)} here.`;
    } else {
      const pick = rankPlants({ ...site, tier: "low", months: gaps })[0];
      if (pick) {
        const drift: Drift = {
          id: newId("d_"),
          plantId: pick.plant.id,
          size: pick.plant.defaultSize,
          shape: driftForCount(pick.plant, region.center, rules.preferredDriftCount, rules, pick.plant.defaultSize),
        };
        ops = [{ op: "addDrift", drift }];
        fix = `Try a drift of ${rules.preferredDriftCount} ${label(pick.plant)} here.`;
      }
    }
    issues.push({
      key: `bloom:${region.name}:${gaps.join(",")}`,
      source: "bloom-gap",
      severity: gaps.length >= 3 ? "warn" : "info",
      issue: `Nothing blooms in ${monthsLabel(gaps)} ${region.name.endsWith("end") ? "at" : "in"} the ${region.name}`,
      detail: fix || "No library plant fits this spot for those months.",
      driftIds: best ? [best.drift.id] : [],
      anchor: region.center,
      ops,
    });
  }
  return issues;
}

// ---- Lone plants: group singles into drifts -------------------------------

function lonePlants({ plan, rules, plants }: Ctx): Issue[] {
  const issues: Issue[] = [];
  const merged = new Set<string>();
  for (const d of plan.drifts) {
    const p = plants.get(d.id);
    if (!p || merged.has(d.id)) continue;
    // Shrubs are often used as single specimens.
    if (p.type === "shrub") continue;
    const n = driftCount(d, p, rules);
    if (n >= rules.minDriftCount) continue;
    const c = shapeCentroid(d.shape);
    const twin = plan.drifts.find(
      (o) => o.id !== d.id && o.plantId === d.plantId && !merged.has(o.id) && dist(shapeCentroid(o.shape), c) < 8,
    );
    if (twin) {
      merged.add(d.id);
      merged.add(twin.id);
      issues.push({
        key: `lone:${d.id}`,
        source: "lone-plants",
        severity: "info",
        issue: `Single plants scattered: merge the two ${p.common} drifts`,
        detail: `${label(p)} appears in two small drifts close together. One larger drift reads better from the street.`,
        driftIds: [d.id, twin.id],
        anchor: mid(c, shapeCentroid(twin.shape)),
        ops: [{ op: "mergeDrifts", keepId: twin.id, removeId: d.id }],
      });
    } else {
      issues.push({
        key: `lone:${d.id}`,
        source: "lone-plants",
        severity: "info",
        issue: `Only ${n} ${p.common}: group into a drift of ${rules.preferredDriftCount}`,
        detail: `Drifts under ${rules.minDriftCount} plants look scattered. Enlarging this one to about ${rules.preferredDriftCount} makes it read as a mass.`,
        driftIds: [d.id],
        anchor: c,
        ops: [{ op: "scaleDrift", driftId: d.id, factor: rules.preferredDriftCount / n }],
      });
    }
  }
  return issues;
}

// ---- Spacing: drifts overlapping each other or spilling out of the bed ----

function overlaps({ plan, rules, plants }: Ctx): Issue[] {
  const issues: Issue[] = [];
  const ds = plan.drifts.filter((d) => plants.has(d.id));
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const a = effectivePoints(ds[i].shape);
      const b = effectivePoints(ds[j].shape);
      const inter = intersectionArea(a, b);
      if (inter <= 0) continue;
      const smaller = Math.min(polygonArea(a), polygonArea(b));
      if (inter / smaller < rules.maxOverlapFraction) continue;
      const small = polygonArea(a) <= polygonArea(b) ? ds[i] : ds[j];
      const pa = plants.get(ds[i].id)!;
      const pb = plants.get(ds[j].id)!;
      issues.push({
        key: `overlap:${ds[i].id}:${ds[j].id}`,
        source: "overlap",
        severity: "warn",
        issue: `${pa.code} and ${pb.code} drifts overlap`,
        detail: `${Math.round((inter / smaller) * 100)}% of the smaller drift overlaps its neighbor, so plants would be crowded. Shrinking it clears most of the overlap.`,
        driftIds: [ds[i].id, ds[j].id],
        anchor: mid(shapeCentroid(ds[i].shape), shapeCentroid(ds[j].shape)),
        ops: [{ op: "scaleDrift", driftId: small.id, factor: Math.max(0.3, 1 - inter / smaller) }],
      });
    }
  }
  return issues;
}

function outsideBed({ bed, plan, rules, plants }: Ctx): Issue[] {
  const outline = effectivePoints(bed.outline);
  const issues: Issue[] = [];
  for (const d of plan.drifts) {
    const p = plants.get(d.id);
    if (!p) continue;
    const pts = effectivePoints(d.shape);
    const out = differenceArea(pts, outline);
    const area = polygonArea(pts);
    if (area <= 0 || out / area < rules.maxOutsideFraction) continue;
    const clipped = clipToLargest(pts, outline);
    issues.push({
      key: `outside:${d.id}`,
      source: "outside-bed",
      severity: "warn",
      issue: `${p.code} drift runs past the bed edge`,
      detail: `${Math.round((out / area) * 100)}% of this drift is outside the bed outline. Trimming it to the edge keeps plants out of the lawn or walk.`,
      driftIds: [d.id],
      anchor: shapeCentroid(d.shape),
      ops: clipped && clipped.length >= 3 ? [{ op: "setShape", driftId: d.id, shape: { points: clipped, smooth: false } }] : [],
    });
  }
  return issues;
}

// ---- Site fit: sun and moisture ------------------------------------------

function siteFit({ bed, plan, plants }: Ctx): Issue[] {
  const issues: Issue[] = [];
  for (const d of plan.drifts) {
    const p = plants.get(d.id);
    if (!p) continue;
    const s = siteAt(bed, d);
    if (fitsSite(p, s.sun, s.moisture)) continue;
    const reasons: string[] = [];
    if (s.sun && !p.sun.includes(s.sun)) reasons.push(`wants ${p.sun.join("/")} sun but this spot is ${s.sun}`);
    if (s.moisture && !p.moisture.includes(s.moisture)) reasons.push(`wants ${p.moisture.join("/")} soil but this spot is ${s.moisture}`);
    const alt = rankPlants({ ...s, tier: tierOf(p), months: p.bloomMonths, kind: kindOf(p), excludeIds: [p.id] })[0];
    issues.push({
      key: `site:${d.id}`,
      source: "site-fit",
      severity: "warn",
      issue: `${p.common} doesn't suit this spot`,
      detail: `${label(p)} ${reasons.join(" and ")}.${alt ? ` ${label(alt.plant)} fills the same role.` : ""}`,
      driftIds: [d.id],
      anchor: shapeCentroid(d.shape),
      ops: alt ? [{ op: "setPlant", driftId: d.id, plantId: alt.plant.id }] : [],
    });
  }
  return issues;
}

function existingPlants({ bed, plan, plants }: Ctx): Issue[] {
  const issues: Issue[] = [];
  for (const e of bed.existing.filter((x) => x.action === "keep")) {
    for (const d of plan.drifts) {
      const p = plants.get(d.id);
      if (!p) continue;
      const circle = circlePolygon(e.position, e.radiusFt);
      const pts = effectivePoints(d.shape);
      const inter = intersectionArea(pts, circle);
      if (inter < 0.5) continue;
      const carved = carveExisting(pts, { existing: [e] });
      issues.push({
        key: `existing:${e.id}:${d.id}`,
        source: "existing-plant",
        severity: "warn",
        issue: `${p.code} drift covers the ${e.name} you're keeping`,
        detail: `About ${Math.round(inter)} sq ft of this drift sits on top of an existing plant marked keep. Trimming the drift leaves room around it.`,
        driftIds: [d.id],
        anchor: e.position,
        ops: carved && carved.length >= 3 ? [{ op: "setShape", driftId: d.id, shape: { points: carved, smooth: false } }] : [{ op: "removeDrift", driftId: d.id }],
      });
    }
  }
  return issues;
}

// ---- Whole-bed checks ------------------------------------------------------

function coverage({ bed, plan, rules }: Ctx): Issue[] {
  const outline = effectivePoints(bed.outline);
  const bedArea = polygonArea(outline);
  if (bedArea <= 0 || plan.drifts.length === 0) return [];
  const covered = unionArea(plan.drifts.map((d) => clipToLargest(effectivePoints(d.shape), outline) ?? []));
  const open = 1 - covered / bedArea;
  if (open <= rules.maxUnplantedFraction) return [];
  return [{
    key: "coverage",
    source: "coverage",
    severity: "info",
    issue: `${Math.round(open * 100)}% of the bed is unplanted`,
    detail: `Bare mulch invites weeds. Enlarge drifts or add a groundcover to fill about ${Math.round(bedArea - covered)} sq ft.`,
    driftIds: [],
    anchor: null,
    ops: [],
  }];
}

function speciesCount({ bed, plan, rules }: Ctx): Issue[] {
  const area = shapeArea(bed.outline);
  const species = new Set(plan.drifts.map((d) => d.plantId)).size;
  const max = Math.max(4, Math.round((area / 100) * rules.maxSpeciesPer100SqFt));
  if (species <= max) return [];
  return [{
    key: "species",
    source: "species-count",
    severity: "info",
    issue: `${species} species in ${Math.round(area)} sq ft reads busy`,
    detail: `About ${max} species suits a bed this size. Repeating fewer plants in bigger drifts looks intentional.`,
    driftIds: [],
    anchor: null,
    ops: [],
  }];
}

function palette({ plan, rules, plants }: Ctx): Issue[] {
  const issues: Issue[] = [];
  for (let m = 1; m <= 12; m++) {
    const colors = new Set<string>();
    for (const d of plan.drifts) {
      const p = plants.get(d.id);
      if (p?.showy && p.bloomMonths.includes(m)) colors.add(p.bloomColorName);
    }
    if (colors.size > rules.maxBloomColorsPerMonth) {
      issues.push({
        key: `palette:${m}`,
        source: "palette",
        severity: "info",
        issue: `${colors.size} flower colors at once in ${MONTH_NAMES[m - 1]}`,
        detail: `${[...colors].join(", ")} all bloom together. Two or three main colors plus white usually reads calmer.`,
        driftIds: [],
        anchor: null,
        ops: [],
      });
    }
  }
  return issues;
}

/** Which plan drifts are in bloom in a month (for the month slider). */
export function inBloom(plan: Plan, month: number): Set<string> {
  const out = new Set<string>();
  for (const d of plan.drifts) {
    const p = plantLibrary.get(d.plantId);
    if (p?.bloomMonths.includes(month)) out.add(d.id);
  }
  return out;
}
