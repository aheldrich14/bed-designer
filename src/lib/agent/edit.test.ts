import { describe, expect, it } from "vitest";
import { runChecks } from "../checks";
import { sampleBed } from "../fixtures";
import { shapeCentroid } from "../geometry";
import { applyOps } from "../plan";
import { plantLibrary } from "../plants";
import { applyTemplate, getTemplate } from "../templates";
import { changesToOps } from "./edit";

describe("conversational edits", () => {
  const bed = sampleBed(); // 30 x 8 ft, faces west: the back (house) is at x = 8
  const { plan, zones } = applyTemplate(getTemplate("pollinator-border")!, bed);
  const zoned = { ...bed, zones };
  const type = (id: string) => plantLibrary.get(id)?.type;

  it("adds a hedge along the back and makes room for it", () => {
    const r = changesToOps(zoned, plan, [{ type: "add", plantCode: "CEA-AME", u: [0, 1], v: [0, 0.3] }]);
    expect(r.errors).toEqual([]);
    const after = applyOps(plan, r.ops);
    expect(after).toEqual(r.plan);
    const hedge = after.drifts.find((d) => d.plantId === plantLibrary.byCode("CEA-AME")!.id)!;
    expect(hedge.size).toBe("1gal");
    expect(shapeCentroid(hedge.shape).x).toBeGreaterThan(5);
    expect(runChecks(zoned, after).some((i) => i.source === "overlap")).toBe(false);
  });

  it("switches pot size when a perennial becomes a shrub", () => {
    const d = plan.drifts.find((x) => type(x.plantId) === "perennial")!;
    const r = changesToOps(zoned, plan, [{ type: "replacePlant", driftId: d.id, plantCode: "HYP-PRO" }]);
    const after = r.plan.drifts.find((x) => x.id === d.id)!;
    expect(plantLibrary.get(after.plantId)!.code).toBe("HYP-PRO");
    expect(after.size).toBe("1gal");
  });

  it("reports unknown drifts and plants instead of guessing", () => {
    const r = changesToOps(zoned, plan, [
      { type: "remove", driftId: "nope" },
      { type: "add", plantCode: "XXX-YYY", u: [0, 0.5], v: [0, 0.5] },
    ]);
    expect(r.errors).toHaveLength(2);
  });

  it("warns when a plant doesn't suit the spot", () => {
    const shady = { ...zoned, conditions: { ...zoned.conditions, sunHours: 1 } };
    const r = changesToOps(shady, plan, [{ type: "add", plantCode: "AMO-CAN", u: [0, 0.3], v: [0, 0.5] }]);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/AMO-CAN prefers full sun/);
  });
});
