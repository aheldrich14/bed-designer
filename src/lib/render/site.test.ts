import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { sampleBed } from "../fixtures";
import { polygonGap } from "../geometry";
import { applyTemplate, getTemplate } from "../templates";
import { sheetToSvg } from "../export/svg";
import { buildRenderPrompt } from "./prompt";
import { svgToPng } from "./raster";
import { describeSite, siteGaps, sitePlanSheet } from "./site";
import type { Project } from "../types";

const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

// The sample bed faces west, 8 ft deep, with its back on the house at x = 8. The sidewalk runs 12 ft in front of it.
const project: Project = {
  id: "p", name: "Test yard", aerialUrl: null, aerialSize: null, calibration: null, userId: null, createdAt: new Date(0).toISOString(),
  features: [
    { id: "h", kind: "house", label: "House", shape: { points: rect(8, -6, 40, 44) } },
    { id: "w", kind: "walk", label: "Sidewalk", shape: { points: rect(-16, -20, -12, 60) } },
  ],
};

describe("site scale for renders", () => {
  const bed = sampleBed();
  const { plan, zones } = applyTemplate(getTemplate("pollinator-border")!, bed);
  const zoned = { ...bed, zones };

  it("measures the gap between polygons", () => {
    expect(polygonGap(rect(0, 0, 2, 2), rect(5, 0, 7, 2)).d).toBeCloseTo(3);
    expect(polygonGap(rect(0, 0, 4, 4), rect(2, 2, 6, 6)).d).toBe(0);
  });

  it("finds the sidewalk in front of the bed and the house behind it", () => {
    const gaps = siteGaps(zoned, project);
    const walk = gaps.find((g) => g.kind === "walk")!;
    expect(walk.gapFt).toBeCloseTo(12);
    expect(walk.side).toBe("in front of the bed");
    expect(gaps.find((g) => g.kind === "house")!.gapFt).toBeCloseTo(0);
  });

  it("puts measured distances and true plant sizes in the prompt", () => {
    const lines = describeSite(zoned, project).join("\n");
    expect(lines).toContain("about 12' from the bed edge");
    expect(lines).toMatch(/house front is about 50 ft wide/);
    const prompt = buildRenderPrompt(zoned, plan, 7, "street", { project, sitePlan: true });
    expect(prompt).toContain("Image 2 is a to-scale overhead site plan");
    expect(prompt).toContain("do not enlarge them");
    expect(prompt).toContain("No existing plants stay.");
  });

  it("rasterizes the overhead site plan", () => {
    const sheet = sitePlanSheet(zoned, plan, project, { month: 7 });
    const svg = sheetToSvg(sheet);
    expect(svg).toContain("SIDEWALK");
    expect(svg).toContain("12' gap");
    const png = svgToPng(svg, sheet.width);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    if (process.env.SITE_PLAN_OUT) fs.writeFileSync(process.env.SITE_PLAN_OUT, png);
  });
});
