import { describe, expect, it } from "vitest";
import { runChecks } from "./checks";
import { sampleBed } from "./fixtures";
import { applyOps } from "./plan";
import { applyTemplate, getTemplate, templatesFor } from "./templates";
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
