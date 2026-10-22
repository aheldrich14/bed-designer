import { fitsSite, plantLibrary, sunClass } from "./plants";
import { TIER_RANK, tierOf } from "./rules";
import { effectivePoints, pointInPolygon, shapeCentroid } from "./geometry";
import type { Bed, Drift, Moisture, Plant, Soil, Sun, TierId } from "./types";

export type SiteFilter = { sun: Sun | null; moisture: Moisture | null; soil?: Soil | null };

/** Conditions at a point: the zone that contains it overrides the bed. */
export function siteAt(bed: Bed, drift: Drift | null): SiteFilter & { zoneId: string | null } {
  const c = drift ? shapeCentroid(drift.shape) : null;
  const zone = c ? bed.zones.find((z) => z.shape.points.length >= 3 && pointInPolygon(c, effectivePoints(z.shape))) : undefined;
  const hours = zone?.sunHours ?? bed.conditions.sunHours;
  return {
    sun: sunClass(hours),
    moisture: zone?.moisture ?? bed.conditions.moisture,
    soil: bed.conditions.soil,
    zoneId: zone?.id ?? null,
  };
}

export type AltQuery = SiteFilter & {
  tier?: TierId | null;
  months?: number[];
  kind?: "bloom" | "grass" | "groundcover" | "fern" | "shrub" | "any";
  excludeIds?: string[];
};

export function kindOf(p: Plant): "bloom" | "grass" | "groundcover" | "fern" | "shrub" {
  if (p.type === "grass" || p.type === "sedge") return "grass";
  if (p.type === "fern") return "fern";
  if (p.type === "shrub") return "shrub";
  if (p.type === "groundcover") return "groundcover";
  return "bloom";
}

/**
 * Library plants ranked for a slot: site fit is required, then tier match,
 * bloom overlap with the wanted months and plant kind add to the score.
 */
export function rankPlants(q: AltQuery, pool: Plant[] = plantLibrary.all()): { plant: Plant; score: number }[] {
  const out: { plant: Plant; score: number }[] = [];
  for (const p of pool) {
    if (q.excludeIds?.includes(p.id)) continue;
    if (!fitsSite(p, q.sun, q.moisture)) continue;
    let score = 0;
    // Soil is a soft preference: a mismatch ranks the plant lower but keeps it available.
    if (q.soil && !p.soil.includes(q.soil)) score -= 2;
    if (q.tier) {
      const gap = Math.abs(TIER_RANK[tierOf(p)] - TIER_RANK[q.tier]);
      score += gap === 0 ? 3 : gap === 1 ? 0.5 : -3;
    }
    if (q.months?.length) {
      const hits = q.months.filter((m) => p.bloomMonths.includes(m)).length;
      score += (hits / q.months.length) * 4 * (p.showy ? 1 : 0.4);
    }
    if (q.kind && q.kind !== "any") {
      const k = kindOf(p);
      if (k === q.kind) score += 2;
      else if (q.kind === "groundcover" && tierOf(p) === "low") score += 0.5;
    }
    out.push({ plant: p, score });
  }
  return out.sort((a, b) => b.score - a.score || a.plant.code.localeCompare(b.plant.code));
}

export const SEASON_MONTHS: Record<"spring" | "summer" | "fall", number[]> = {
  spring: [4, 5, 6],
  summer: [6, 7, 8],
  fall: [8, 9, 10],
};
