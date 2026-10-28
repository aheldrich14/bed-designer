import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { sampleBed } from "../fixtures";
import { polygonGap } from "../geometry";
import { applyTemplate, getTemplate } from "../templates";
import { sheetToSvg } from "../export/svg";
import { buildClearPrompt, buildRenderPrompt } from "./prompt";
import { imageSize, nearestAspectRatio } from "./image";
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
    expect(prompt).toContain("judge each plant against things at the same distance from the camera");
    expect(prompt).toMatch(/on an adult standing on the walk/);
    expect(prompt).toContain("not one large bush");
    // The bed backs onto the house, so the door is a fair comparison for the back row.
    expect(prompt).toMatch(/the height of the 7 ft front door/);
    expect(prompt).toContain("No existing plants stay.");
    // Image models can't count plants; drifts read as density instead.
    expect(prompt).not.toMatch(/a drift of \d+/);
    expect(prompt.split("\n").at(-1)).toMatch(/no perennial taller than/);
    expect(prompt).toContain("Do not copy anything from image 2");
  });

  it("clears the bed in its own pass, then plants the cleared photo", () => {
    const clear = buildClearPrompt(zoned, { project, sitePlan: true });
    expect(clear).toContain("Remove every plant growing inside it");
    expect(clear).toContain("shredded hardwood mulch");
    expect(clear).toContain("about 12' from the bed edge");
    expect(clear).toMatch(/hedge or row of clipped shrubs along the house foundation/);
    expect(clear).not.toContain("planting drifts colored");
    const plant = buildRenderPrompt(zoned, plan, 7, "street", { project, sitePlan: true, cleared: true });
    expect(plant).toContain("has already been cleared to bare shredded hardwood mulch");
    expect(plant).not.toContain("No existing plants stay.");
    expect(plant.indexOf("Keep") < plant.indexOf("Planting, left to right")).toBe(true);
  });

  it("keeps a few tall shrubs from setting the scale for the whole bed", () => {
    const dogwood = { ...plan.drifts[0], id: "dogwood", plantId: "cornus-sericea" };
    const withShrub = { ...plan, drifts: [...plan.drifts, dogwood] };
    const prompt = buildRenderPrompt(zoned, withShrub, 7, "street", { project, cleared: true });
    expect(prompt).toMatch(/The tallest perennials are about 5' tall/);
    expect(prompt).toMatch(/only plants taller than that are the Red osier dogwood shrubs, about 6' tall/);
    expect(prompt).not.toMatch(/to 6' across/);
    expect(prompt.split("\n").at(-1)).toMatch(/no perennial taller than 5'/);
    // With every perennial at 4' or under, the door and windows give a check the model can see.
    const short = { ...withShrub, drifts: withShrub.drifts.filter((d) => d.plantId !== "eutrochium-maculatum") };
    expect(buildRenderPrompt(zoned, short, 7, "street", { project, cleared: true })).toContain("front door, porch and ground-floor windows stay clearly visible above them, except right behind a shrub");
  });

  it("drops the gap callouts from the plan sent to the image model", () => {
    const svg = sheetToSvg(sitePlanSheet(zoned, plan, project, { month: 7, gapLines: false }));
    expect(svg).not.toContain("12' gap");
  });

  it("matches the photo's aspect ratio", () => {
    const png = (w: number, h: number) => {
      const b = Buffer.alloc(32);
      b.writeUInt32BE(0x89504e47, 0);
      b.writeUInt32BE(w, 16);
      b.writeUInt32BE(h, 20);
      return b;
    };
    expect(imageSize(png(1600, 1200))).toEqual({ width: 1600, height: 1200 });
    expect(nearestAspectRatio(png(1600, 1200))).toBe("4:3");
    expect(nearestAspectRatio(png(1920, 1080))).toBe("16:9");
    expect(nearestAspectRatio(png(1000, 1500))).toBe("2:3");
    expect(nearestAspectRatio(Buffer.from("not an image at all, just text"))).toBeUndefined();
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
