import { describe, expect, it } from "vitest";
import { runChecks } from "./checks";
import { sampleBed } from "./fixtures";
import { applyOps } from "./plan";
import { applyTemplate, getTemplate, templatesFor } from "./templates";
import { shapeArea, shapeCentroid } from "./geometry";
import { plantLibrary } from "./plants";
import { rules } from "./rules";
import type { Plan } from "./types";

const rect = (x: number, y: number, w: number, h: number) => ({
  points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
});

describe("design checks", () => {
  const bed = sampleBed();

  it("flags a tall drift in front of a short one and swapping fixes it", () => {
    // West-facing: x = 0 is the front edge, x = 8 the house.
    const plan: Plan = {
      zoneNotes: {},
      drifts: [
        { id: "tall", plantId: "heliopsis-helianthoides", size: "plug", shape: rect(0, 0, 4, 10) },
        { id: "short", plantId: "geum-triflorum", size: "plug", shape: rect(4, 0, 4, 10) },
      ],
    };
    const issue = runChecks(bed, plan).find((i) => i.source === "height-order");
    expect(issue).toBeDefined();
    const fixed = applyOps(plan, issue!.ops);
    expect(runChecks(bed, fixed).some((i) => i.source === "height-order")).toBe(false);
  });

  it("reports April gaps by named region", () => {
    const plan: Plan = {
      zoneNotes: {},
      drifts: [{ id: "a", plantId: "solidago-speciosa", size: "plug", shape: rect(0, 0, 8, 30) }],
    };
    const gaps = runChecks(bed, plan).filter((i) => i.source === "bloom-gap");
    expect(gaps.map((g) => g.issue).join("\n")).toMatch(/April.*south end/);
  });

  it("suggests growing lone plants into a drift", () => {
    const plan: Plan = {
      zoneNotes: {},
      drifts: [{ id: "a", plantId: "asclepias-tuberosa", size: "plug", shape: rect(2, 2, 1, 1) }],
    };
    const lone = runChecks(bed, plan).find((i) => i.source === "lone-plants");
    expect(lone?.ops[0]).toMatchObject({ op: "scaleDrift", driftId: "a" });
  });

  it("flags plants that do not suit the site", () => {
    const shady = sampleBed({ conditions: { ...bed.conditions, sunHours: 2 } });
    const plan: Plan = {
      zoneNotes: {},
      drifts: [{ id: "a", plantId: "asclepias-tuberosa", size: "plug", shape: rect(0, 0, 8, 30) }],
    };
    expect(runChecks(shady, plan).some((i) => i.source === "site-fit")).toBe(true);
  });
});

describe("templates", () => {
  const bed = sampleBed();

  it("ranks templates by site fit", () => {
    expect(templatesFor(bed)[0].fit).toBe(2);
  });

  it("scales a template into the outline with site-fit plants and correct height order", () => {
    const { plan, zones } = applyTemplate(getTemplate("hot-dry-foundation")!, bed);
    expect(plan.drifts.length).toBeGreaterThanOrEqual(8);
    expect(zones.map((z) => z.name)).toEqual(["Back", "Middle", "Front edge"]);
    const issues = runChecks(bed, plan);
    expect(issues.filter((i) => ["site-fit", "outside-bed", "overlap", "height-order"].includes(i.source))).toEqual([]);
  });
});

describe("shrub structure", () => {
  const bed = sampleBed(); // 30 x 8 ft, full sun, medium moisture, loam
  const shrubShare = (plan: Plan) => {
    const area = plan.drifts.filter((d) => plantLibrary.get(d.plantId)?.type === "shrub").reduce((s, d) => s + shapeArea(d.shape), 0);
    return area / shapeArea(bed.outline);
  };

  it("flags an all-perennial bed and adds a shrub at the back", () => {
    const { plan } = applyTemplate(getTemplate("pollinator-border")!, bed);
    const issue = runChecks(bed, plan).find((i) => i.key === "structure:light")!;
    expect(issue.issue).toBe("No shrubs for winter structure");
    expect(issue.ops[0].op).toBe("addDrift");
    const added = applyOps(plan, issue.ops);
    const shrub = added.drifts.find((d) => plantLibrary.get(d.plantId)?.type === "shrub")!;
    expect(shrub.size).toBe("1gal");
    expect(shrubShare(added)).toBeGreaterThan(rules.shrubShare.min);
    // West-facing bed: the back (house side) is the high-x half.
    expect(shapeCentroid(shrub.shape).x).toBeGreaterThan(4);
    // The perennials underneath are trimmed, so the fix doesn't create overlaps.
    expect(runChecks(bed, added).some((i) => i.source === "overlap" || i.source === "structure")).toBe(false);
  });

  it("skips beds too narrow for shrubs", () => {
    const narrow = sampleBed({ outline: rect(0, 0, 2, 30) });
    const { plan } = applyTemplate(getTemplate("pollinator-border")!, narrow);
    expect(runChecks(narrow, plan).some((i) => i.source === "structure")).toBe(false);
  });

  it("the shrub-framed template lands near a third shrubs and passes", () => {
    const { plan } = applyTemplate(getTemplate("shrub-framed-foundation")!, bed);
    const share = shrubShare(plan);
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.42);
    expect(plan.drifts.filter((d) => plantLibrary.get(d.plantId)?.type === "shrub").length).toBe(3);
    expect(runChecks(bed, plan).some((i) => i.source === "structure")).toBe(false);
  });
});
