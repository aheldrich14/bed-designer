import {
  blob, effectivePoints, pointInPolygon, scaleShapeArea, shapeArea, shapeCentroid, bbox,
} from "./geometry";
import { plantLibrary } from "./plants";
import { defaultSizeFor, rules as defaultRules, spacingFor, type DesignRules } from "./rules";
import type { Drift, Plan, PlanOp, Plant, Pt, PotSize, Shape } from "./types";

let idCounter = 0;
/** Short unique id; good enough for local records and drift ids. */
export function newId(prefix = ""): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

/**
 * Plants needed to fill a drift: area / spacing², times a small factor for
 * staggered (triangular) rows. Always at least one.
 */
export function driftCount(drift: Drift, plant: Plant | undefined, r: DesignRules = defaultRules): number {
  if (!plant) return 0;
  const s = spacingFor(plant, drift.size, r) / 12;
  const n = (shapeArea(drift.shape) / (s * s)) * r.staggerFactor;
  return Math.max(1, Math.round(n));
}

export function countFor(drift: Drift, r: DesignRules = defaultRules): number {
  return driftCount(drift, plantLibrary.get(drift.plantId), r);
}

/**
 * Staggered planting positions inside a drift, used to draw spread circles.
 * The grid spacing is nudged until the number of points matches the count.
 */
export function plantPositions(drift: Drift, r: DesignRules = defaultRules): Pt[] {
  const plant = plantLibrary.get(drift.plantId);
  if (!plant) return [];
  const target = driftCount(drift, plant, r);
  const poly = effectivePoints(drift.shape);
  if (poly.length < 3) return [];
  const base = spacingFor(plant, drift.size, r) / 12;
  const grid = (s: number) => hexGrid(poly, s);
  let lo = base * 0.4;
  let hi = base * 2.5;
  let best = grid(base);
  for (let i = 0; i < 18 && best.length !== target; i++) {
    const mid = (lo + hi) / 2;
    const pts = grid(mid);
    if (Math.abs(pts.length - target) < Math.abs(best.length - target)) best = pts;
    if (pts.length > target) lo = mid;
    else hi = mid;
  }
  if (best.length === 0) return [shapeCentroid(drift.shape)];
  return best;
}

function hexGrid(poly: Pt[], s: number): Pt[] {
  const b = bbox(poly);
  const rowH = s * Math.sqrt(3) / 2;
  const pts: Pt[] = [];
  let row = 0;
  for (let y = b.minY + rowH / 2; y <= b.maxY; y += rowH, row++) {
    const offset = row % 2 ? s / 2 : 0;
    for (let x = b.minX + s / 4 + offset; x <= b.maxX; x += s) {
      const p = { x, y };
      if (pointInPolygon(p, poly)) pts.push(p);
    }
  }
  return pts;
}

export type ScheduleRow = {
  plant: Plant;
  size: PotSize;
  quantity: number;
  driftIds: string[];
};

/** Plant schedule: one row per plant and pot size, sorted by code. */
export function schedule(plan: Plan, r: DesignRules = defaultRules): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  for (const d of plan.drifts) {
    const plant = plantLibrary.get(d.plantId);
    if (!plant) continue;
    const key = `${plant.id}|${d.size}`;
    const row = rows.get(key) ?? { plant, size: d.size, quantity: 0, driftIds: [] };
    row.quantity += driftCount(d, plant, r);
    row.driftIds.push(d.id);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.plant.code.localeCompare(b.plant.code));
}

export function totalPlants(plan: Plan, r: DesignRules = defaultRules): number {
  return plan.drifts.reduce((s, d) => s + countFor(d, r), 0);
}

// ---- Plan ops (diffs) ---------------------------------------------------

/** Applies a list of ops and returns a new plan. Unknown drift ids are ignored. */
export function applyOps(plan: Plan, ops: PlanOp[]): Plan {
  let drifts = plan.drifts.map((d) => ({ ...d }));
  const find = (id: string) => drifts.find((d) => d.id === id);
  for (const op of ops) {
    switch (op.op) {
      case "setPlant": {
        const d = find(op.driftId);
        if (d && plantLibrary.get(op.plantId)) d.plantId = op.plantId;
        break;
      }
      case "swapPlants": {
        const a = find(op.driftA);
        const b = find(op.driftB);
        if (a && b) [a.plantId, b.plantId, a.size, b.size] = [b.plantId, a.plantId, b.size, a.size];
        break;
      }
      case "scaleDrift": {
        const d = find(op.driftId);
        if (d) d.shape = scaleShapeArea(d.shape, op.factor);
        break;
      }
      case "removeDrift":
        drifts = drifts.filter((d) => d.id !== op.driftId);
        break;
      case "addDrift":
        if (plantLibrary.get(op.drift.plantId) && !find(op.drift.id)) drifts.push(structuredClone(op.drift));
        break;
      case "setSize": {
        const d = find(op.driftId);
        if (d) d.size = op.size;
        break;
      }
      case "setShape": {
        const d = find(op.driftId);
        if (d && op.shape.points.length >= 3) d.shape = structuredClone(op.shape);
        break;
      }
      case "mergeDrifts": {
        const keep = find(op.keepId);
        const gone = find(op.removeId);
        if (keep && gone) {
          const area = shapeArea(keep.shape) + shapeArea(gone.shape);
          const c1 = shapeCentroid(keep.shape);
          const c2 = shapeCentroid(gone.shape);
          const center = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
          keep.shape = blob(center, area, 7);
          drifts = drifts.filter((d) => d.id !== op.removeId);
        }
        break;
      }
    }
  }
  return { ...plan, drifts };
}

export function emptyPlan(): Plan {
  return { drifts: [], zoneNotes: {} };
}

/** A drift big enough for `count` plants of `plant`, centered at `center`. */
export function driftForCount(plant: Plant, center: Pt, count: number, r: DesignRules = defaultRules, size: PotSize = defaultSizeFor(plant, r)): Shape {
  const s = spacingFor(plant, size, r) / 12;
  return blob(center, (count * s * s) / r.staggerFactor);
}
