// Shared domain types. Geometry is in feet; x runs east, y runs south (SVG
// convention, north up). Bed geometry is relative to the bed's origin, so a
// plan does not depend on the image it was traced on.

export type Pt = { x: number; y: number };

/** A polygon given by control points; `smooth` rounds it into curves. */
export type Shape = { points: Pt[]; smooth?: boolean };

export type Sun = "full" | "part" | "shade";
export type Moisture = "dry" | "medium" | "wet";
export type Soil = "sand" | "loam" | "clay";
export type Orientation = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type PlantType = "perennial" | "grass" | "sedge" | "fern" | "shrub" | "groundcover";
export type PotSize = "plug" | "1gal";
export type TierId = "low" | "mid" | "tall";

export type Plant = {
  id: string;
  code: string;
  botanical: string;
  common: string;
  type: PlantType;
  heightIn: number;
  spreadIn: number;
  spacingIn: number;
  bloomMonths: number[];
  bloomColor: string;
  bloomColorName: string;
  /** Size and shape of the flowers, for renders, e.g. "2-3 in daisies". */
  flowerForm?: string;
  /** Whether the bloom reads as color in the garden (grasses and sedges do not). */
  showy: boolean;
  foliage: string;
  winterInterest: string | null;
  sun: Sun[];
  moisture: Moisture[];
  soil: Soil[];
  notes: string;
  defaultSize: PotSize;
};

export type Conditions = {
  /** The direction the bed faces, i.e. where you stand to look at it. */
  orientation: Orientation;
  sunHours: number | null;
  soil: Soil | null;
  moisture: Moisture | null;
  canopy: "none" | "partial" | "heavy";
  notes: string;
};

export type Zone = {
  id: string;
  name: string;
  shape: Shape;
  /** Optional overrides of the bed conditions for this zone. */
  sunHours?: number | null;
  moisture?: Moisture | null;
};

export type ExistingPlant = {
  id: string;
  name: string;
  position: Pt;
  radiusFt: number;
  action: "keep" | "remove";
};

export type Photo = {
  id: string;
  url: string;
  caption: string;
  isStreetView: boolean;
};

export type SiteFeatureKind = "house" | "walk" | "driveway" | "tree" | "other";

export type SiteFeature = {
  id: string;
  kind: SiteFeatureKind;
  label: string;
  /** Polygon in project feet. Trees use a single point plus radiusFt. */
  shape: Shape;
  radiusFt?: number;
};

export type Calibration = {
  pxPerFt: number;
  /** Project origin in aerial image pixels. */
  originPx: Pt;
};

export type Project = {
  id: string;
  name: string;
  aerialUrl: string | null;
  aerialSize: { w: number; h: number } | null;
  calibration: Calibration | null;
  features: SiteFeature[];
  userId: string | null;
  createdAt: string;
};

export type Bed = {
  id: string;
  projectId: string;
  name: string;
  /** Bed origin in project feet. */
  origin: Pt;
  outline: Shape;
  zones: Zone[];
  conditions: Conditions;
  existing: ExistingPlant[];
  photos: Photo[];
  /** Keys of live checks the user chose to hide. */
  dismissedChecks: string[];
  createdAt: string;
};

export type Drift = {
  id: string;
  plantId: string;
  shape: Shape;
  size: PotSize;
};

export type Plan = {
  drifts: Drift[];
  /** One-line rationale per zone id (or zone name for unsaved zones). */
  zoneNotes: Record<string, string>;
};

export type PlanAuthor = "agent" | "template" | "user";

export type PlanVersion = Plan & {
  id: string;
  bedId: string;
  parentId: string | null;
  author: PlanAuthor;
  rationale: string;
  createdAt: string;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  fits: { sun: Sun[]; moisture: Moisture[] };
  rows: TemplateRow[];
};

export type TemplateRow = {
  zone: string;
  v: [number, number];
  skew: number;
  breaks: number[];
  slots: TemplateSlot[];
};

export type TemplateSlot = {
  tier: TierId;
  kind: "bloom" | "grass" | "groundcover" | "fern" | "shrub" | "any";
  season?: "spring" | "summer" | "fall";
  prefer: string[];
};

/** A plan diff. Every suggestion and agent edit is expressed with these ops. */
export type PlanOp =
  | { op: "setPlant"; driftId: string; plantId: string }
  | { op: "swapPlants"; driftA: string; driftB: string }
  | { op: "scaleDrift"; driftId: string; factor: number }
  | { op: "removeDrift"; driftId: string }
  | { op: "addDrift"; drift: Drift }
  | { op: "setSize"; driftId: string; size: PotSize }
  | { op: "mergeDrifts"; keepId: string; removeId: string }
  | { op: "setShape"; driftId: string; shape: Shape };

export type SuggestionStatus = "open" | "applied" | "dismissed";

export type Suggestion = {
  id: string;
  planVersionId: string;
  issue: string;
  detail: string;
  /** Which check produced it, or "judgment" for agent-only calls. */
  source: string;
  severity: "info" | "warn" | "error";
  driftIds: string[];
  /** Where to draw the marker on the plan, in bed feet. */
  anchor: Pt | null;
  ops: PlanOp[];
  status: SuggestionStatus;
  createdAt: string;
};

export type Render = {
  id: string;
  planVersionId: string;
  month: number;
  viewpoint: "street" | "overhead";
  prompt: string;
  imageUrl: string | null;
  error: string | null;
  createdAt: string;
};

export type MissingInfoItem = {
  key: string;
  question: string;
  why: string;
  status: "missing" | "answered" | "skipped";
  answer?: string;
};

export type AgentMessage = { role: "agent" | "user"; text: string; at: string };

export type AgentSession = {
  bedId: string;
  messages: AgentMessage[];
  checklist: MissingInfoItem[];
  updatedAt: string;
};
