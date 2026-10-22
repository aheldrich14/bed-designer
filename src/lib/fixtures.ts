import type { Bed } from "./types";

/** West-facing front bed, 30 ft along the house and 8 ft deep. House is on the east (x = 8). */
export function sampleBed(overrides: Partial<Bed> = {}): Bed {
  return {
    id: "bed_test",
    projectId: "proj_test",
    name: "Front bed",
    origin: { x: 0, y: 0 },
    outline: { points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 30 }, { x: 0, y: 30 }] },
    zones: [],
    conditions: { orientation: "W", sunHours: 7, soil: "loam", moisture: "medium", canopy: "none", notes: "" },
    existing: [],
    photos: [],
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}
