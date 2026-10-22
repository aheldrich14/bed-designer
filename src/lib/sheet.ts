import { type BBox, bbox, edgeLengths, effectivePoints, formatFtIn, shapeArea, shapeCentroid } from "./geometry";
import { countFor, plantPositions, totalPlants } from "./plan";
import { plantLibrary } from "./plants";
import type { Bed, Plan, Project, Pt, Suggestion } from "./types";

// A plan sheet is built once as a list of drawing primitives, then rendered
// by React on screen and as an SVG string for the PDF, so every output reads
// from the same plan JSON.

export type Prim =
  | { k: "path"; d: string; fill?: string; stroke?: string; sw?: number; dash?: string; opacity?: number; driftId?: string; role?: string }
  | { k: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; dash?: string; opacity?: number }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: string }
  | { k: "text"; x: number; y: number; text: string; size: number; anchor?: "start" | "middle" | "end"; weight?: number; fill?: string; rotate?: number; halo?: boolean; italic?: boolean }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; rx?: number }
  | { k: "image"; href: string; x: number; y: number; w: number; h: number; opacity: number };

export type Sheet = {
  width: number;
  height: number;
  prims: Prim[];
  /** Feet (bed coordinates) to sheet units. */
  s: number;
  ox: number;
  oy: number;
};

export type SheetOptions = {
  project?: Project | null;
  /** Bloom month to color by; null colors each drift by its plant. */
  month?: number | null;
  showCircles?: boolean;
  showDimensions?: boolean;
  showSite?: boolean;
  /** Full sheet with title block, north arrow and scale bar. */
  titleBlock?: boolean;
  versionLabel?: string;
  highlight?: string[];
  suggestions?: Suggestion[];
  width?: number;
  /** Fit the drawing inside this height (sheet units) as well as the width. */
  fitHeight?: number;
  /** Fixed drawing extent in bed feet (keeps the scale steady while editing). */
  frame?: BBox | null;
  /** Aerial underlay, drawn under everything else. */
  underlay?: { href: string; x: number; y: number; w: number; h: number; opacity: number } | null;
};

export const COLORS = {
  ink: "#24302a",
  muted: "#6b7568",
  bedFill: "#f3ecdf",
  bedStroke: "#5b4a33",
  zone: "#9b8a6a",
  foliage: "#a9c39a",
  dormant: "#d6c8a8",
  house: "#d9d6d0",
  hardscape: "#e7e4de",
  keep: "#2f7d4f",
  remove: "#b3372f",
  highlight: "#e0662b",
  paper: "#ffffff",
};

export function pathD(points: Pt[], s: number, ox: number, oy: number): string {
  if (!points.length) return "";
  return (
    points.map((p, i) => `${i ? "L" : "M"}${(ox + p.x * s).toFixed(2)} ${(oy + p.y * s).toFixed(2)}`).join(" ") + " Z"
  );
}

/** Mixes a hex color toward white by `t` (0 = unchanged, 1 = white). */
export function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * t));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * (1 - t)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Fill for a drift: its bloom color, or how it looks in the given month. */
export function driftFill(plantId: string, month: number | null | undefined): { fill: string; stroke: string } {
  const p = plantLibrary.get(plantId);
  if (!p) return { fill: "#ddd", stroke: "#999" };
  const base = p.bloomColor;
  if (month == null) return { fill: tint(base, 0.55), stroke: shade(base, 0.35) };
  if (p.bloomMonths.includes(month)) return { fill: tint(base, 0.15), stroke: shade(base, 0.4) };
  if (month <= 3 || month >= 11) return { fill: COLORS.dormant, stroke: "#9c8d6b" };
  return { fill: COLORS.foliage, stroke: "#6c8a5c" };
}

function niceBar(ftAvailable: number): number {
  for (const n of [50, 40, 30, 20, 10, 5, 4, 2, 1]) if (n <= ftAvailable) return n;
  return 1;
}

export function buildSheet(bed: Bed, plan: Plan, opts: SheetOptions = {}): Sheet {
  const outline = effectivePoints(bed.outline);
  const extent: Pt[] = [...outline];
  for (const e of bed.existing) {
    extent.push({ x: e.position.x - e.radiusFt, y: e.position.y - e.radiusFt }, { x: e.position.x + e.radiusFt, y: e.position.y + e.radiusFt });
  }
  for (const d of plan.drifts) extent.push(...d.shape.points);
  if (!extent.length) extent.push({ x: 0, y: 0 }, { x: 20, y: 10 });
  const b = opts.frame ?? bbox(extent);
  const margin = opts.frame ? 0 : 4; // ft around the bed for dimensions and labels
  let wFt = Math.max(b.maxX - b.minX, 4) + margin * 2;
  const hFt = Math.max(b.maxY - b.minY, 4) + margin * 2;
  // On screen, widen tall beds to a landscape frame so labels stay readable.
  if (!opts.fitHeight && !opts.frame && wFt < hFt * 1.3) wFt = hFt * 1.3;
  const width = opts.width ?? 1000;
  const titleH = opts.titleBlock ? 120 : 0;
  const s = opts.fitHeight ? Math.min(width / wFt, opts.fitHeight / hFt) : width / wFt;
  const drawH = opts.fitHeight ?? hFt * s;
  // Center the drawing when the fit (or the widened frame) leaves spare room.
  const ox = (width - (b.maxX - b.minX + margin * 2) * s) / 2 + (margin - b.minX) * s;
  const oy = (drawH - hFt * s) / 2 + (margin - b.minY) * s;
  const height = drawH + titleH;
  const P: Prim[] = [];
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + y * s;
  const fontBase = Math.max(10, Math.min(16, s * 0.42));

  P.push({ k: "rect", x: 0, y: 0, w: width, h: height, fill: COLORS.paper });
  if (opts.underlay) {
    const u = opts.underlay;
    P.push({ k: "image", href: u.href, x: X(u.x), y: Y(u.y), w: u.w * s, h: u.h * s, opacity: u.opacity });
  }

  // Site context from the project (house, walks, trees) in bed coordinates.
  if (opts.showSite !== false && opts.project) {
    for (const f of opts.project.features) {
      const pts = f.shape.points.map((p) => ({ x: p.x - bed.origin.x, y: p.y - bed.origin.y }));
      if (f.kind === "tree" && pts[0]) {
        P.push({ k: "circle", cx: X(pts[0].x), cy: Y(pts[0].y), r: (f.radiusFt ?? 10) * s, fill: "#dfe8d6", stroke: "#8aa27c", sw: 1, dash: "6 4", opacity: 0.7 });
        P.push({ k: "text", x: X(pts[0].x), y: Y(pts[0].y), text: f.label || "Tree", size: fontBase * 0.85, anchor: "middle", fill: COLORS.muted, italic: true });
      } else if (pts.length >= 3) {
        const fill = f.kind === "house" ? COLORS.house : COLORS.hardscape;
        P.push({ k: "path", d: pathD(pts, s, ox, oy), fill, stroke: "#a9a39a", sw: 1, role: "site" });
        const c = shapeCentroid({ points: pts });
        P.push({ k: "text", x: X(c.x), y: Y(c.y), text: (f.label || f.kind).toUpperCase(), size: fontBase * 0.85, anchor: "middle", fill: "#8d877d", weight: 600 });
      }
    }
  }

  // Bed outline and zones.
  if (outline.length >= 3) {
    P.push({ k: "path", d: pathD(outline, s, ox, oy), fill: COLORS.bedFill, stroke: COLORS.bedStroke, sw: 2.2, role: "bed" });
  }
  for (const z of bed.zones) {
    const zp = effectivePoints(z.shape);
    if (zp.length < 3) continue;
    P.push({ k: "path", d: pathD(zp, s, ox, oy), stroke: COLORS.zone, sw: 1, dash: "3 4", role: "zone" });
  }

  // Drifts.
  const hl = new Set(opts.highlight ?? []);
  for (const d of plan.drifts) {
    const pts = effectivePoints(d.shape);
    if (pts.length < 3) continue;
    const { fill, stroke } = driftFill(d.plantId, opts.month);
    P.push({ k: "path", d: pathD(pts, s, ox, oy), fill, stroke: hl.has(d.id) ? COLORS.highlight : stroke, sw: hl.has(d.id) ? 3 : 1.4, driftId: d.id, role: "drift" });
    if (opts.showCircles) {
      const p = plantLibrary.get(d.plantId);
      const r = ((p?.spreadIn ?? 12) / 24) * s;
      for (const q of plantPositions(d)) {
        P.push({ k: "circle", cx: X(q.x), cy: Y(q.y), r, stroke, sw: 0.7, opacity: 0.9 });
        P.push({ k: "circle", cx: X(q.x), cy: Y(q.y), r: 1.4, fill: stroke });
      }
    }
  }
  for (const d of plan.drifts) {
    const p = plantLibrary.get(d.plantId);
    if (!p || d.shape.points.length < 3) continue;
    const c = shapeCentroid(d.shape);
    P.push({ k: "text", x: X(c.x), y: Y(c.y) + fontBase * 0.35, text: `${p.code} ${countFor(d)}`, size: fontBase, anchor: "middle", weight: 700, fill: COLORS.ink, halo: true });
  }

  // Existing plants: keep and remove callouts.
  for (const e of bed.existing) {
    const cx = X(e.position.x);
    const cy = Y(e.position.y);
    const r = e.radiusFt * s;
    if (e.action === "keep") {
      P.push({ k: "circle", cx, cy, r, fill: "#ffffff", stroke: COLORS.keep, sw: 1.6, dash: "5 3", opacity: 0.85 });
    } else {
      P.push({ k: "circle", cx, cy, r, stroke: COLORS.remove, sw: 1.6, dash: "2 3" });
      P.push({ k: "line", x1: cx - r * 0.6, y1: cy - r * 0.6, x2: cx + r * 0.6, y2: cy + r * 0.6, stroke: COLORS.remove, sw: 1.6 });
      P.push({ k: "line", x1: cx - r * 0.6, y1: cy + r * 0.6, x2: cx + r * 0.6, y2: cy - r * 0.6, stroke: COLORS.remove, sw: 1.6 });
    }
    P.push({
      k: "text", x: cx, y: cy + r + fontBase, text: `EX. ${e.name.toUpperCase()} – ${e.action === "keep" ? "TO REMAIN" : "REMOVE"}`,
      size: fontBase * 0.75, anchor: "middle", weight: 600, fill: e.action === "keep" ? COLORS.keep : COLORS.remove, halo: true,
    });
  }

  // Edge dimensions.
  if (opts.showDimensions !== false && bed.outline.points.length >= 3) {
    const bb = bbox(outline);
    const dimY = Y(bb.maxY) + 1.6 * s;
    const dimX = X(bb.maxX) + 1.6 * s;
    const tick = 0.25 * s;
    P.push({ k: "line", x1: X(bb.minX), y1: dimY, x2: X(bb.maxX), y2: dimY, stroke: COLORS.muted, sw: 0.8 });
    P.push({ k: "line", x1: X(bb.minX), y1: dimY - tick, x2: X(bb.minX), y2: dimY + tick, stroke: COLORS.muted, sw: 0.8 });
    P.push({ k: "line", x1: X(bb.maxX), y1: dimY - tick, x2: X(bb.maxX), y2: dimY + tick, stroke: COLORS.muted, sw: 0.8 });
    P.push({ k: "text", x: (X(bb.minX) + X(bb.maxX)) / 2, y: dimY - 4, text: formatFtIn(bb.maxX - bb.minX), size: fontBase * 0.85, anchor: "middle", fill: COLORS.muted, halo: true });
    P.push({ k: "line", x1: dimX, y1: Y(bb.minY), x2: dimX, y2: Y(bb.maxY), stroke: COLORS.muted, sw: 0.8 });
    P.push({ k: "line", x1: dimX - tick, y1: Y(bb.minY), x2: dimX + tick, y2: Y(bb.minY), stroke: COLORS.muted, sw: 0.8 });
    P.push({ k: "line", x1: dimX - tick, y1: Y(bb.maxY), x2: dimX + tick, y2: Y(bb.maxY), stroke: COLORS.muted, sw: 0.8 });
    P.push({ k: "text", x: dimX + 4, y: (Y(bb.minY) + Y(bb.maxY)) / 2, text: formatFtIn(bb.maxY - bb.minY), size: fontBase * 0.85, anchor: "middle", fill: COLORS.muted, rotate: 90, halo: true });

    if (!bed.outline.smooth) {
      const pts = bed.outline.points;
      const c = shapeCentroid(bed.outline);
      edgeLengths(pts).forEach((len, i) => {
        if (len < 1.5) return;
        const a = pts[i];
        const q = pts[(i + 1) % pts.length];
        // Straight edges along the bounding box repeat the overall dimensions.
        const on = (u: number, v: number, lim: number) => Math.abs(u - v) < 0.01 && Math.abs(u - lim) < 0.01;
        if (on(a.x, q.x, bb.minX) || on(a.x, q.x, bb.maxX) || on(a.y, q.y, bb.minY) || on(a.y, q.y, bb.maxY)) return;
        const m = { x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 };
        // Push the label outward, away from the bed's center.
        let nx = -(q.y - a.y) / len;
        let ny = (q.x - a.x) / len;
        if ((m.x - c.x) * nx + (m.y - c.y) * ny < 0) [nx, ny] = [-nx, -ny];
        let angle = (Math.atan2(q.y - a.y, q.x - a.x) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        P.push({ k: "text", x: X(m.x + nx * 0.7), y: Y(m.y + ny * 0.7) + fontBase * 0.3, text: formatFtIn(len), size: fontBase * 0.75, anchor: "middle", fill: COLORS.bedStroke, rotate: angle, halo: true });
      });
    }
  }

  // Suggestion markers.
  (opts.suggestions ?? []).forEach((sug, i) => {
    if (!sug.anchor || sug.status !== "open") return;
    const cx = X(sug.anchor.x);
    const cy = Y(sug.anchor.y);
    P.push({ k: "circle", cx, cy, r: fontBase * 0.95, fill: COLORS.highlight, stroke: "#fff", sw: 2 });
    P.push({ k: "text", x: cx, y: cy + fontBase * 0.35, text: String(i + 1), size: fontBase, anchor: "middle", weight: 700, fill: "#fff" });
  });

  // North arrow and scale bar (always north up).
  const na = { x: width - 36, y: 40 };
  P.push({ k: "path", d: `M${na.x} ${na.y - 22} L${na.x + 9} ${na.y + 8} L${na.x} ${na.y + 2} L${na.x - 9} ${na.y + 8} Z`, fill: COLORS.ink });
  P.push({ k: "text", x: na.x, y: na.y + 24, text: "N", size: 14, anchor: "middle", weight: 700, fill: COLORS.ink });

  const barFt = niceBar(wFt / 4);
  const bx = 20;
  const by = drawH - 22;
  const half = (barFt / 2) * s;
  P.push({ k: "rect", x: bx, y: by, w: half, h: 6, fill: COLORS.ink });
  P.push({ k: "rect", x: bx + half, y: by, w: half, h: 6, fill: "#fff", stroke: COLORS.ink, sw: 1 });
  P.push({ k: "text", x: bx, y: by - 4, text: "0", size: 10, anchor: "middle", fill: COLORS.ink });
  P.push({ k: "text", x: bx + half * 2, y: by - 4, text: `${barFt} ft`, size: 10, anchor: "middle", fill: COLORS.ink });

  if (opts.titleBlock) {
    const ty = drawH + 8;
    const area = shapeArea(bed.outline);
    P.push({ k: "line", x1: 16, y1: ty, x2: width - 16, y2: ty, stroke: COLORS.ink, sw: 1.5 });
    P.push({ k: "text", x: 20, y: ty + 30, text: `${bed.name} — Planting Plan`, size: 22, weight: 700, fill: COLORS.ink });
    P.push({ k: "text", x: 20, y: ty + 54, text: opts.project?.name ?? "", size: 13, fill: COLORS.muted });
    P.push({
      k: "text", x: 20, y: ty + 76,
      text: `Faces ${bed.conditions.orientation} · ${bed.conditions.sunHours ?? "?"} h sun · ${bed.conditions.soil ?? "soil ?"} · ${bed.conditions.moisture ?? "moisture ?"}`,
      size: 12, fill: COLORS.muted,
    });
    P.push({ k: "text", x: width - 20, y: ty + 30, text: `${Math.round(area)} sq ft · ${totalPlants(plan)} plants · ${new Set(plan.drifts.map((d) => d.plantId)).size} species`, size: 14, anchor: "end", weight: 600, fill: COLORS.ink });
    P.push({ k: "text", x: width - 20, y: ty + 54, text: opts.versionLabel ?? "", size: 12, anchor: "end", fill: COLORS.muted });
    P.push({ k: "text", x: width - 20, y: ty + 76, text: "Codes show plant and quantity. Drifts drawn at planting extent; circles at mature spread.", size: 10, anchor: "end", fill: COLORS.muted, italic: true });
  }

  return { width, height, prims: P, s, ox, oy };
}
