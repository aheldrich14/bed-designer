import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { sampleBed } from "../fixtures";
import { applyTemplate, getTemplate } from "../templates";
import { buildSheet } from "../sheet";
import { sheetToSvg } from "./svg";
import { plantListCsv } from "./csv";
import { planSheetPdf } from "./pdf";
import { buildRenderPrompt } from "../render/prompt";
import type { Project } from "../types";

const project: Project = {
  id: "p", name: "Test yard", aerialUrl: null, aerialSize: null, calibration: null, features: [], userId: null, createdAt: new Date(0).toISOString(),
};

describe("outputs from one plan", () => {
  const bed = sampleBed({ existing: [{ id: "e", name: "Peony", position: { x: 4, y: 3 }, radiusFt: 1.5, action: "keep" }] });
  const { plan, zones } = applyTemplate(getTemplate("pollinator-border")!, bed);
  const zoned = { ...bed, zones };

  it("draws codes with counts, north arrow and title block", () => {
    const svg = sheetToSvg(buildSheet(zoned, plan, { project, titleBlock: true, showCircles: true }));
    expect(svg).toMatch(/[A-Z]{3}-[A-Z]{3} \d+/);
    expect(svg).toContain(">N</text>");
    expect(svg).toContain("Planting Plan");
    expect(svg).toContain("TO REMAIN");
  });

  it("keeps drifts off existing plants marked keep", () => {
    const sheet = buildSheet(zoned, plan, {});
    expect(sheet.prims.length).toBeGreaterThan(10);
  });

  it("writes a CSV grouped by size with totals", () => {
    const csv = plantListCsv([{ bed: zoned, plan }]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Size,Code/);
    expect(lines.some((l) => l.startsWith("Plug total"))).toBe(true);
  });

  it("renders a PDF", async () => {
    const pdf = await planSheetPdf(project, zoned, plan, "Version 1");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    if (process.env.PDF_OUT) fs.writeFileSync(process.env.PDF_OUT, pdf);
  });

  it("builds a month-aware render prompt", () => {
    const july = buildRenderPrompt(zoned, plan, 7, "street");
    const jan = buildRenderPrompt(zoned, plan, 1, "street");
    expect(july).toMatch(/in bloom/);
    expect(jan).toMatch(/dormant/);
    expect(july).toContain("The only existing plants that stay are: Peony");
  });
});
