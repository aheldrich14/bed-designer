import { describe, expect, it } from "vitest";
import { applyOps, driftCount, plantPositions, schedule } from "./plan";
import { plantLibrary } from "./plants";
import type { Drift, Plan } from "./types";

const rect = (x: number, y: number, w: number, h: number) => ({
  points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
});

describe("plan math", () => {
  const milkweed = plantLibrary.get("asclepias-tuberosa")!; // 15" spacing

  it("derives count from area, spacing and the stagger factor", () => {
    const d: Drift = { id: "a", plantId: milkweed.id, size: "plug", shape: rect(0, 0, 5, 5) };
    // 25 sq ft / (1.25 ft)^2 = 16, x 1.15 = 18.4
    expect(driftCount(d, milkweed)).toBe(18);
  });

  it("never drops below one plant", () => {
    const d: Drift = { id: "a", plantId: milkweed.id, size: "plug", shape: rect(0, 0, 0.2, 0.2) };
    expect(driftCount(d, milkweed)).toBe(1);
  });

  it("places roughly as many plant positions as the count", () => {
    const d: Drift = { id: "a", plantId: milkweed.id, size: "plug", shape: rect(0, 0, 6, 4) };
    const n = driftCount(d, milkweed);
    expect(Math.abs(plantPositions(d).length - n)).toBeLessThanOrEqual(2);
  });

  it("applies swap, set and remove ops without mutating the input", () => {
    const plan: Plan = {
      zoneNotes: {},
      drifts: [
        { id: "a", plantId: "asclepias-tuberosa", size: "plug", shape: rect(0, 0, 4, 4) },
        { id: "b", plantId: "geum-triflorum", size: "plug", shape: rect(4, 0, 4, 4) },
      ],
    };
    const out = applyOps(plan, [
      { op: "swapPlants", driftA: "a", driftB: "b" },
      { op: "setPlant", driftId: "b", plantId: "nope" },
      { op: "removeDrift", driftId: "b" },
    ]);
    expect(out.drifts.map((d) => d.plantId)).toEqual(["geum-triflorum"]);
    expect(plan.drifts[0].plantId).toBe("asclepias-tuberosa");
  });

  it("groups the schedule by plant and size", () => {
    const plan: Plan = {
      zoneNotes: {},
      drifts: [
        { id: "a", plantId: milkweed.id, size: "plug", shape: rect(0, 0, 5, 5) },
        { id: "b", plantId: milkweed.id, size: "plug", shape: rect(10, 0, 5, 5) },
        { id: "c", plantId: milkweed.id, size: "1gal", shape: rect(20, 0, 5, 5) },
      ],
    };
    const rows = schedule(plan);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.size === "plug")!.quantity).toBe(36);
  });
});
