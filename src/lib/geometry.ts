import polygonClipping, { type Polygon as PcPolygon } from "polygon-clipping";
import type { Orientation, Pt, Shape } from "./types";

export const EPS = 1e-9;

/** Shoelace area, always positive. */
export function polygonArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Area centroid; falls back to the vertex mean for degenerate polygons. */
export function centroid(points: Pt[]): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < EPS) {
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Chaikin corner cutting: turns a control polygon into a smooth closed curve. */
export function chaikin(points: Pt[], iterations = 3): Pt[] {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    const next: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    pts = next;
  }
  return pts;
}

/** The polygon a shape actually covers (smoothed when `smooth` is set). */
export function effectivePoints(shape: Shape): Pt[] {
  if (shape.points.length < 3) return shape.points;
  return shape.smooth ? chaikin(shape.points) : shape.points;
}

export function shapeArea(shape: Shape): number {
  return polygonArea(effectivePoints(shape));
}

export function shapeCentroid(shape: Shape): Pt {
  return centroid(effectivePoints(shape));
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export function bbox(points: Pt[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Closest point to p on segment ab. */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Shortest gap between two polygons' edges (0 when one has a vertex inside the other), with the closest points. */
export function polygonGap(a: Pt[], b: Pt[]): { d: number; pa: Pt; pb: Pt } {
  let best = { d: Infinity, pa: a[0], pb: b[0] };
  for (const [from, to, swap] of [[a, b, false], [b, a, true]] as const) {
    for (const p of from) {
      if (to.length >= 3 && pointInPolygon(p, to)) return { d: 0, pa: p, pb: p };
      for (let i = 0; i < to.length; i++) {
        const q = closestOnSegment(p, to[i], to[(i + 1) % to.length]);
        const d = dist(p, q);
        if (d < best.d) best = swap ? { d, pa: q, pb: p } : { d, pa: p, pb: q };
      }
    }
  }
  return best;
}

export function edgeLengths(points: Pt[]): number[] {
  return points.map((p, i) => dist(p, points[(i + 1) % points.length]));
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/** Scales a shape's area by `areaFactor` about its centroid. */
export function scaleShapeArea(shape: Shape, areaFactor: number): Shape {
  const c = shapeCentroid(shape);
  const k = Math.sqrt(Math.max(areaFactor, 0.01));
  return {
    ...shape,
    points: shape.points.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k })),
  };
}

/** A rough circle-ish blob of the given area, used for new drifts. */
export function blob(center: Pt, areaSqFt: number, sides = 6): Shape {
  // Chaikin smoothing shrinks a polygon; compensate so the smoothed area matches.
  const raw: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2;
    raw.push({ x: center.x + Math.cos(t), y: center.y + Math.sin(t) });
  }
  const unitArea = polygonArea(chaikin(raw));
  const r = Math.sqrt(areaSqFt / unitArea);
  return {
    smooth: true,
    points: raw.map((p) => ({ x: center.x + (p.x - center.x) * r, y: center.y + (p.y - center.y) * r })),
  };
}

// ---- Polygon booleans -----------------------------------------------------

function toPc(points: Pt[]): PcPolygon {
  const ring = points.map((p) => [p.x, p.y] as [number, number]);
  if (ring.length) ring.push(ring[0]);
  return [ring];
}

function multiArea(mp: [number, number][][][]): number {
  let total = 0;
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      const a = polygonArea(ring.map(([x, y]) => ({ x, y })));
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

export function intersectionArea(a: Pt[], b: Pt[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  try {
    return multiArea(polygonClipping.intersection(toPc(a), toPc(b)));
  } catch {
    return 0;
  }
}

/** Area of `a` that falls outside `b`. */
export function differenceArea(a: Pt[], b: Pt[]): number {
  if (a.length < 3) return 0;
  if (b.length < 3) return polygonArea(a);
  try {
    return multiArea(polygonClipping.difference(toPc(a), toPc(b)));
  } catch {
    return 0;
  }
}

/** Clips `a` to `b` and returns the largest resulting piece (or null). */
export function clipToLargest(a: Pt[], b: Pt[]): Pt[] | null {
  try {
    const res = polygonClipping.intersection(toPc(a), toPc(b));
    let best: Pt[] | null = null;
    let bestArea = 0;
    for (const poly of res) {
      const ring = poly[0].slice(0, -1).map(([x, y]) => ({ x, y }));
      const ar = polygonArea(ring);
      if (ar > bestArea) {
        bestArea = ar;
        best = ring;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** Removes `b` from `a` and returns the largest remaining piece (or null). */
export function subtractLargest(a: Pt[], b: Pt[]): Pt[] | null {
  try {
    const res = polygonClipping.difference(toPc(a), toPc(b));
    let best: Pt[] | null = null;
    let bestArea = 0;
    for (const poly of res) {
      const ring = poly[0].slice(0, -1).map(([x, y]) => ({ x, y }));
      const ar = polygonArea(ring);
      if (ar > bestArea) {
        bestArea = ar;
        best = ring;
      }
    }
    return best;
  } catch {
    return null;
  }
}

export function circlePolygon(c: Pt, r: number, sides = 20): Pt[] {
  return Array.from({ length: sides }, (_, i) => ({
    x: c.x + Math.cos((i / sides) * Math.PI * 2) * r,
    y: c.y + Math.sin((i / sides) * Math.PI * 2) * r,
  }));
}

/** Total area of the union of several polygons. */
export function unionArea(polys: Pt[][]): number {
  const valid = polys.filter((p) => p.length >= 3);
  if (!valid.length) return 0;
  try {
    const [first, ...rest] = valid.map(toPc);
    return multiArea(polygonClipping.union(first, ...rest));
  } catch {
    return valid.reduce((s, p) => s + polygonArea(p), 0);
  }
}

// ---- Bed frame: lateral (end to end) and depth (back to front) -----------

const BEARINGS: Record<Orientation, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

/** Unit vector pointing from the back of the bed toward its front (viewer). */
export function frontVector(orientation: Orientation): Pt {
  const t = (BEARINGS[orientation] * Math.PI) / 180;
  // Bearing 0 = north = -y in plan coordinates.
  return { x: Math.sin(t), y: -Math.cos(t) };
}

/** Unit vector along the bed, left to right as seen from the front. */
export function lateralVector(orientation: Orientation): Pt {
  const f = frontVector(orientation);
  // Facing the bed means looking along -f; your right hand is -f rotated 90° clockwise.
  return { x: f.y, y: -f.x };
}

export type FramePt = { l: number; d: number };

export function toFrame(p: Pt, orientation: Orientation): FramePt {
  const f = frontVector(orientation);
  const l = lateralVector(orientation);
  return { l: p.x * l.x + p.y * l.y, d: p.x * f.x + p.y * f.y };
}

export function fromFrame(fp: FramePt, orientation: Orientation): Pt {
  const f = frontVector(orientation);
  const l = lateralVector(orientation);
  return { x: fp.l * l.x + fp.d * f.x, y: fp.l * l.y + fp.d * f.y };
}

export function frameBounds(points: Pt[], orientation: Orientation) {
  const fps = points.map((p) => toFrame(p, orientation));
  return {
    minL: Math.min(...fps.map((p) => p.l)),
    maxL: Math.max(...fps.map((p) => p.l)),
    minD: Math.min(...fps.map((p) => p.d)),
    maxD: Math.max(...fps.map((p) => p.d)),
  };
}

const COMPASS: Orientation[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const COMPASS_WORDS: Record<Orientation, string> = {
  N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest",
};

export function compassOf(v: Pt): Orientation {
  const bearing = ((Math.atan2(v.x, -v.y) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(bearing / 45) % 8];
}

/** Names for the bed's lateral regions, e.g. ["north end", "middle", "south end"]. */
export function regionNames(orientation: Orientation, count: number): string[] {
  const l = lateralVector(orientation);
  const left = COMPASS_WORDS[compassOf({ x: -l.x, y: -l.y })];
  const right = COMPASS_WORDS[compassOf(l)];
  if (count === 1) return ["whole bed"];
  if (count === 2) return [`${left} half`, `${right} half`];
  const names = [`${left} end`];
  for (let i = 1; i < count - 1; i++) names.push(count === 3 ? "middle" : `middle ${i}`);
  names.push(`${right} end`);
  return names;
}

// ---- Formatting -------------------------------------------------------------

export function formatFtIn(ft: number): string {
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  if (f === 0) return `${i}"`;
  return i === 0 ? `${f}'` : `${f}' ${i}"`;
}

export function round(n: number, places = 1): number {
  const k = 10 ** places;
  return Math.round(n * k) / k;
}

/** Cuts existing plants marked keep out of a drift polygon. */
export function carveExisting(poly: Pt[] | null, bed: { existing: { position: Pt; radiusFt: number; action: string }[] }): Pt[] | null {
  let out = poly;
  for (const e of bed.existing) {
    if (!out || e.action !== "keep") continue;
    const circle = circlePolygon(e.position, e.radiusFt + 0.25);
    if (intersectionArea(out, circle) > 0.05) out = subtractLargest(out, circle);
  }
  return out;
}
