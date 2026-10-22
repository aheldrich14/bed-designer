import libraryJson from "../../../data/plants.json";
import type { Moisture, Plant, Sun } from "../types";

/**
 * Every plant lookup goes through this interface so the JSON file can later be
 * swapped for an external database or a different regional list.
 */
export interface PlantLibrary {
  readonly version: string;
  readonly region: string;
  readonly note: string;
  all(): Plant[];
  get(id: string): Plant | undefined;
  byCode(code: string): Plant | undefined;
}

class JsonPlantLibrary implements PlantLibrary {
  readonly version: string;
  readonly region: string;
  readonly note: string;
  private plants: Plant[];
  private byId = new Map<string, Plant>();
  private byCodeMap = new Map<string, Plant>();

  constructor(data: { version: string; region: string; note: string; plants: Plant[] }) {
    this.version = data.version;
    this.region = data.region;
    this.note = data.note;
    this.plants = data.plants;
    for (const p of data.plants) {
      this.byId.set(p.id, p);
      this.byCodeMap.set(p.code.toUpperCase(), p);
    }
  }

  all() {
    return this.plants;
  }
  get(id: string) {
    return this.byId.get(id);
  }
  byCode(code: string) {
    return this.byCodeMap.get(code.toUpperCase());
  }
}

export const plantLibrary: PlantLibrary = new JsonPlantLibrary(
  libraryJson as { version: string; region: string; note: string; plants: Plant[] },
);

/** Hours of direct sun to a sun class (6+ full, 3–6 part, under 3 shade). */
export function sunClass(hours: number | null | undefined): Sun | null {
  if (hours == null) return null;
  if (hours >= 6) return "full";
  if (hours >= 3) return "part";
  return "shade";
}

export function fitsSite(plant: Plant, sun: Sun | null, moisture: Moisture | null): boolean {
  return (!sun || plant.sun.includes(sun)) && (!moisture || plant.moisture.includes(moisture));
}

export function bloomsIn(plant: Plant, month: number): boolean {
  return plant.bloomMonths.includes(month);
}
