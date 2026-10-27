import { z } from "zod";

// Request-body validation for the API routes.

export const PtZ = z.object({ x: z.number().finite(), y: z.number().finite() });
export const ShapeZ = z.object({ points: z.array(PtZ), smooth: z.boolean().optional() });
const SunZ = z.enum(["full", "part", "shade"]);
const MoistureZ = z.enum(["dry", "medium", "wet"]);

export const ConditionsZ = z.object({
  orientation: z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
  sunHours: z.number().min(0).max(16).nullable(),
  soil: z.enum(["sand", "loam", "clay"]).nullable(),
  moisture: MoistureZ.nullable(),
  canopy: z.enum(["none", "partial", "heavy"]),
  notes: z.string(),
});

export const ZoneZ = z.object({
  id: z.string(),
  name: z.string(),
  shape: ShapeZ,
  sunHours: z.number().nullable().optional(),
  moisture: MoistureZ.nullable().optional(),
});

export const ExistingZ = z.object({
  id: z.string(),
  name: z.string(),
  position: PtZ,
  radiusFt: z.number().positive(),
  action: z.enum(["keep", "remove"]),
});

export const PhotoZ = z.object({ id: z.string(), url: z.string(), caption: z.string(), isStreetView: z.boolean() });

export const BedPatchZ = z
  .object({
    name: z.string().min(1),
    origin: PtZ,
    outline: ShapeZ,
    zones: z.array(ZoneZ),
    conditions: ConditionsZ,
    existing: z.array(ExistingZ),
    photos: z.array(PhotoZ),
    dismissedChecks: z.array(z.string()),
  })
  .partial();

export const FeatureZ = z.object({
  id: z.string(),
  kind: z.enum(["house", "walk", "driveway", "tree", "other"]),
  label: z.string(),
  shape: ShapeZ,
  radiusFt: z.number().positive().optional(),
});

export const ProjectPatchZ = z
  .object({
    name: z.string().min(1),
    calibration: z.object({ pxPerFt: z.number().positive(), originPx: PtZ }).nullable(),
    features: z.array(FeatureZ),
  })
  .partial();

export const DriftZ = z.object({
  id: z.string(),
  plantId: z.string(),
  shape: ShapeZ,
  size: z.enum(["plug", "1gal"]),
});

export const PlanZ = z.object({ drifts: z.array(DriftZ), zoneNotes: z.record(z.string(), z.string()).default({}) });

export const NewVersionZ = z.object({
  plan: PlanZ,
  author: z.enum(["agent", "template", "user"]).default("user"),
  rationale: z.string().default(""),
  parentId: z.string().nullable().default(null),
});

export { SunZ, MoistureZ };
