import { describe, expect, it } from "vitest";
import { sampleBed } from "../fixtures";
import { buildChecklist, missingRequired } from "./missing-info";
import { proposalToPlan } from "./proposal";
import { HeuristicPlanner } from "./heuristic";
import type { Project } from "../types";

const project: Project = { id: "p", name: "Yard", aerialUrl: null, aerialSize: null, calibration: null, features: [], userId: null, createdAt: "" };

describe("missing-info checklist", () => {
  it("asks for sun and moisture, with reasons", () => {
    const bed = sampleBed({ conditions: { ...sampleBed().conditions, sunHours: null, moisture: null } });
    const missing = missingRequired(buildChecklist(bed));
    expect(missing.map((m) => m.key).sort()).toEqual(["moisture", "sunHours"]);
    expect(missing.every((m) => m.why.length > 10)).toBe(true);
  });

  it("names the bed end when reporting depth", () => {
    const depth = buildChecklist(sampleBed()).find((i) => i.key === "depth");
    expect(depth?.question).toBe("Bed depth at the north end");
    expect(depth?.status).toBe("answered");
  });
});

describe("agent proposals are validated on the server", () => {
  const bed = sampleBed();

  it("rejects plants outside the library and bad coordinates", () => {
    const r = proposalToPlan(bed, {
      rationale: "",
      zones: [],
      drifts: [
        { plantCode: "ECH-PUR", u: [0, 0.5], v: [0, 0.5] },
        { plantCode: "ASC-TUB", u: [0.5], v: [0, 1] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/not in the plant library/);
    expect(r.errors.join(" ")).toMatch(/two numbers/);
  });

  it("rejects a tall drift in front of a short one", () => {
    const r = proposalToPlan(bed, {
      rationale: "",
      zones: [],
      drifts: [
        { plantCode: "GEU-TRI", u: [0, 1], v: [0, 0.5] },
        { plantCode: "HEL-HEL", u: [0, 1], v: [0.5, 1] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Tall plant in front/);
  });

  it("accepts a sensible plan and maps fractions into the outline", () => {
    const r = proposalToPlan(bed, {
      rationale: "Grasses behind, prairie smoke in front.",
      zones: [{ name: "Back", v: [0, 0.5], rationale: "Height against the wall." }],
      drifts: [
        { plantCode: "SPO-HET", u: [0, 1], v: [0, 0.5] },
        { plantCode: "GEU-TRI", u: [0, 1], v: [0.5, 1] },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.plan.drifts).toHaveLength(2);
    // West-facing: the back (v = 0) is the house side, x near 8.
    const back = r.plan.drifts[0].shape.points;
    expect(Math.max(...back.map((p) => p.x))).toBeCloseTo(8, 5);
    expect(r.zones[0].name).toBe("Back");
  });
});

describe("heuristic planner", () => {
  it("asks for missing info before drafting", async () => {
    const bed = sampleBed({ conditions: { ...sampleBed().conditions, sunHours: null } });
    const r = await new HeuristicPlanner().draft({ project, bed, checklist: buildChecklist(bed) });
    expect(r.status).toBe("needs_info");
  });

  it("drafts a plan that passes the hard checks", async () => {
    const bed = sampleBed();
    const r = await new HeuristicPlanner().draft({ project, bed, checklist: buildChecklist(bed) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.plan.drifts.length).toBeGreaterThan(5);
      expect(r.rationale).toMatch(/plants across/);
    }
  });
});
