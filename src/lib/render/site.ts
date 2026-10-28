import { type BBox, bbox, centroid, effectivePoints, formatFtIn, frameBounds, polygonGap, regionNames, toFrame } from "../geometry";
import { buildSheet, COLORS, type Sheet } from "../sheet";
import type { Bed, Plan, Project, Pt, SiteFeatureKind } from "../types";

// Site measurements around a bed, in bed feet, for the render prompt and the
// to-scale overhead plan sent to the image model alongside the photo.

export type SiteGap = {
  label: string;
  kind: SiteFeatureKind;
  /** Shortest distance from the bed outline to the feature, in feet. */
  gapFt: number;
  /** Where the feature sits relative to the bed, e.g. "in front of the bed". */
  side: string;
  /** Closest points on the bed and on the feature (bed feet). */
  onBed: Pt;
  onFeature: Pt;
};

/** Hardscape and buildings farther than this from the bed don't help with scale. */
const NEAR_FT = 60;

const KIND_NAME: Record<SiteFeatureKind, string> = { house: "house", walk: "walk", driveway: "driveway", tree: "tree", other: "feature" };

export function siteGaps(bed: Bed, project: Project | null | undefined): SiteGap[] {
  const outline = effectivePoints(bed.outline);
  if (!project || outline.length < 3) return [];
  const o = bed.conditions.orientation;
  const ends = regionNames(o, 3);
  const gaps: SiteGap[] = [];
  for (const f of project.features) {
    if (f.kind === "tree" || f.shape.points.length < 3) continue;
    const pts = f.shape.points.map((p) => ({ x: p.x - bed.origin.x, y: p.y - bed.origin.y }));
    let g = polygonGap(outline, pts);
    if (g.d > NEAR_FT) continue;
    // Many point pairs tie for the shortest gap along parallel edges; prefer the one level with the bed's middle.
    const toFeature = polygonGap([centroid(outline)], pts).pb;
    const mid = polygonGap([toFeature], outline);
    if (g.d > 0 && Math.abs(mid.d - g.d) < 0.25) g = { d: g.d, pa: mid.pb, pb: toFeature };
    const v = toFrame({ x: g.pb.x - g.pa.x, y: g.pb.y - g.pa.y }, o);
    const side =
      g.d < 0.5 ? "touching the bed"
      : Math.abs(v.d) >= Math.abs(v.l) ? (v.d > 0 ? "in front of the bed" : "behind the bed")
      : `off the ${v.l < 0 ? ends[0] : ends[2]}`;
    gaps.push({ label: f.label || KIND_NAME[f.kind], kind: f.kind, gapFt: g.d, side, onBed: g.pa, onFeature: g.pb });
  }
  return gaps.sort((a, b) => a.gapFt - b.gapFt);
}

/** Width of the house front and how much of it the bed runs along, measured side to side as seen from the front. */
export function houseSpan(bed: Bed, project: Project | null | undefined): { houseFt: number; bedFt: number } | null {
  const house = project?.features.find((f) => f.kind === "house" && f.shape.points.length >= 3);
  const outline = effectivePoints(bed.outline);
  if (!house || outline.length < 3) return null;
  const o = bed.conditions.orientation;
  const hb = frameBounds(house.shape.points.map((p) => ({ x: p.x - bed.origin.x, y: p.y - bed.origin.y })), o);
  const bb = frameBounds(outline, o);
  return { houseFt: hb.maxL - hb.minL, bedFt: bb.maxL - bb.minL };
}

/** Plain-language scale and placement lines for the render prompt. */
export function describeSite(bed: Bed, project: Project | null | undefined): string[] {
  const lines: string[] = [];
  for (const g of siteGaps(bed, project)) {
    if (g.kind === "house") {
      lines.push(g.gapFt < 1.5 ? "The back of the bed runs right along the house foundation." : `The bed sits about ${formatFtIn(g.gapFt)} out from the house.`);
    } else if (g.gapFt < 0.5) {
      lines.push(`The bed edge meets the ${g.label.toLowerCase()} (${g.side}).`);
    } else {
      lines.push(
        `The ${g.label.toLowerCase()} is ${g.side}, about ${formatFtIn(g.gapFt)} from the bed edge. Keep that full ${formatFtIn(g.gapFt)} of lawn or open ground between them exactly as it is; the bed must not grow toward the ${g.label.toLowerCase()}.`,
      );
    }
  }
  const span = houseSpan(bed, project);
  if (span && span.houseFt > 1) {
    const share = span.bedFt / span.houseFt;
    const words = share > 0.95 ? "the full width of" : share > 0.6 ? "most of" : share > 0.4 ? "about half of" : share > 0.2 ? "about a third of" : "a small part of";
    lines.push(`The house front is about ${Math.round(span.houseFt)} ft wide and the bed runs along ${words} it (${Math.round(span.bedFt)} ft).`);
  }
  return lines;
}

/** Drawing extent for the overhead plan: the bed plus the nearby house and walks, so the gaps between them show. */
function siteFrame(bed: Bed, plan: Plan, gaps: SiteGap[]): BBox {
  const pts: Pt[] = [...effectivePoints(bed.outline), ...plan.drifts.flatMap((d) => d.shape.points)];
  for (const g of gaps) pts.push(g.onFeature);
  const b = bbox(pts);
  const pad = Math.max(6, 0.15 * Math.max(b.maxX - b.minX, b.maxY - b.minY));
  const f = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  // Keep the image from getting too thin to read.
  const w = f.maxX - f.minX;
  const h = f.maxY - f.minY;
  if (w > h * 2) {
    f.minY -= (w / 2 - h) / 2;
    f.maxY += (w / 2 - h) / 2;
  } else if (h > w * 2) {
    f.minX -= (h / 2 - w) / 2;
    f.maxX += (h / 2 - w) / 2;
  }
  return f;
}

/**
 * A to-scale, north-up overhead plan of the bed with the house, walks and
 * aerial under it, the bed's dimensions, and the measured gaps to nearby
 * hardscape called out.
 */
export function sitePlanSheet(
  bed: Bed,
  plan: Plan,
  project: Project | null,
  opts: { month?: number | null; aerialHref?: string | null; width?: number; gapLines?: boolean } = {},
): Sheet {
  const gaps = siteGaps(bed, project);
  const cal = project?.calibration;
  const underlay =
    opts.aerialHref && cal && project?.aerialSize
      ? {
          href: opts.aerialHref,
          x: -cal.originPx.x / cal.pxPerFt - bed.origin.x,
          y: -cal.originPx.y / cal.pxPerFt - bed.origin.y,
          w: project.aerialSize.w / cal.pxPerFt,
          h: project.aerialSize.h / cal.pxPerFt,
          opacity: 0.55,
        }
      : null;
  const sheet = buildSheet(bed, plan, {
    project, month: opts.month ?? null, frame: siteFrame(bed, plan, gaps), underlay, showDimensions: true, width: opts.width ?? 1200,
  });
  const { s, ox, oy } = sheet;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + y * s;
  // Image models copy dashed callouts into the photo, so renders ask for the plan without them.
  if (opts.gapLines === false) return sheet;
  for (const g of gaps) {
    if (g.gapFt < 1 || g.kind === "house") continue;
    const a = { x: X(g.onBed.x), y: Y(g.onBed.y) };
    const b = { x: X(g.onFeature.x), y: Y(g.onFeature.y) };
    sheet.prims.push({ k: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: COLORS.highlight, sw: 2.5, dash: "8 5" });
    const flat = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
    sheet.prims.push({
      k: "text", x: (a.x + b.x) / 2 + (flat ? 0 : 10), y: (a.y + b.y) / 2 + (flat ? -10 : 6), text: `${formatFtIn(g.gapFt)} gap`, size: 18, weight: 700,
      anchor: flat ? "middle" : "start", fill: COLORS.highlight, halo: true,
    });
  }
  return sheet;
}
