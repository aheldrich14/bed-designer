import rulesJson from "../../data/design-rules.json";
import type { Plant, PotSize, TierId } from "./types";

/** Design rules live in data/design-rules.json so they can be tuned without code changes. */
export type DesignRules = {
  version: number;
  staggerFactor: number;
  tiers: { id: TierId; label: string; maxHeightIn: number }[];
  minDriftCount: number;
  preferredDriftCount: number;
  heightOrderToleranceIn: number;
  bloomWindow: [number, number];
  bloomRegions: number;
  maxSpeciesPer100SqFt: number;
  maxUnplantedFraction: number;
  maxOverlapFraction: number;
  maxOutsideFraction: number;
  maxBloomColorsPerMonth: number;
  defaultSize: PotSize;
  /** 1-gallon plants go in at their mature spread, and never closer than this. */
  gallonMinSpacingIn: number;
  sizeForTypes: Partial<Record<Plant["type"], PotSize>>;
};

export const rules = rulesJson as DesignRules;

export function tierOf(plant: Plant, r: DesignRules = rules): TierId {
  for (const t of r.tiers) if (plant.heightIn <= t.maxHeightIn) return t.id;
  return "tall";
}

export const TIER_RANK: Record<TierId, number> = { low: 0, mid: 1, tall: 2 };

/**
 * On-center spacing in inches. Plugs use the plant's listed spacing; 1-gallon
 * plants are bigger at planting, so they go in at their mature spread.
 */
export function spacingFor(plant: Plant, size: PotSize, r: DesignRules = rules): number {
  return size === "1gal" ? Math.max(plant.spacingIn, plant.spreadIn, r.gallonMinSpacingIn) : plant.spacingIn;
}

export function defaultSizeFor(plant: Plant, r: DesignRules = rules): PotSize {
  return r.sizeForTypes[plant.type] ?? plant.defaultSize ?? r.defaultSize;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
