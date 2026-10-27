import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { schedule } from "../plan";
import { MONTHS, spacingFor } from "../rules";
import { buildSheet } from "../sheet";
import { sheetToSvg } from "./svg";
import { SIZE_LABEL } from "./csv";
import type { Bed, Plan, Project } from "../types";

/** Plan sheet PDF: landscape tabloid with the plan view on page 1 and the schedule after it. */
export async function planSheetPdf(project: Project, bed: Bed, plan: Plan, versionLabel: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "TABLOID", layout: "landscape", margin: 36, info: { Title: `${bed.name} planting plan` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width - 72;
  const pageH = doc.page.height - 72;
  // Page 1: plan view on the left, a compact legend and schedule on the right.
  const drawW = pageW * 0.64;
  const sheet = buildSheet(bed, plan, {
    project, titleBlock: true, showCircles: true, showDimensions: true, versionLabel, width: drawW, fitHeight: pageH - 120,
  });
  const scale = Math.min(drawW / sheet.width, pageH / sheet.height);
  SVGtoPDF(doc, sheetToSvg(sheet), 36, 36, { width: sheet.width * scale, height: sheet.height * scale, preserveAspectRatio: "xMinYMin meet" });

  const lx = 36 + drawW + 18;
  const lw = pageW - drawW - 18;
  let ly = 40;
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#24302a").text("Plant schedule", lx, ly);
  ly += 20;
  for (const r of schedule(plan)) {
    const p = r.plant;
    doc.rect(lx, ly + 1, 9, 9).fillColor(p.bloomColor).fill();
    doc.fillColor("#24302a").font("Helvetica-Bold").fontSize(9).text(`${p.code}  ${r.quantity}`, lx + 14, ly, { width: 90, lineBreak: false });
    doc.font("Helvetica").fontSize(9).text(`${SIZE_LABEL[r.size]} · ${spacingFor(p, r.size)}" o.c.`, lx + lw - 90, ly, { width: 90, align: "right", lineBreak: false });
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#4b554f").text(`${p.botanical} — ${p.common}`, lx + 14, ly + 11, { width: lw - 14, lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(8).fillColor("#6b7568").text(
      `${p.heightIn}" tall · ${p.bloomMonths.length ? `blooms ${MONTHS[p.bloomMonths[0] - 1]}–${MONTHS[p.bloomMonths[p.bloomMonths.length - 1] - 1]}, ${p.bloomColorName}` : "foliage"}`,
      lx + 14, ly + 22, { width: lw - 14, lineBreak: false, ellipsis: true },
    );
    ly += 36;
    if (ly > doc.page.height - 120) break;
  }
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#24302a").text(`Total ${schedule(plan).reduce((s, r) => s + r.quantity, 0)} plants`, lx, ly + 4);

  // Schedule table.
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#24302a").text(`${bed.name} — Plant Schedule`, 36, 36);
  doc.font("Helvetica").fontSize(10).fillColor("#6b7568").text(`${project.name} · ${versionLabel}`, 36, 60);

  const cols = [
    { h: "Code", w: 70 }, { h: "Botanical name", w: 190 }, { h: "Common name", w: 160 }, { h: "Size", w: 50 },
    { h: "Qty", w: 40 }, { h: "Spacing", w: 60 }, { h: "Height", w: 55 }, { h: "Bloom", w: 150 }, { h: "Sun / moisture", w: 140 },
  ];
  let y = 90;
  const drawRow = (cells: string[], bold = false) => {
    let x = 36;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#24302a");
    cells.forEach((c, i) => {
      doc.text(c, x + 3, y + 4, { width: cols[i].w - 6, lineBreak: false, ellipsis: true });
      x += cols[i].w;
    });
    y += 20;
    doc.moveTo(36, y).lineTo(36 + cols.reduce((s, c) => s + c.w, 0), y).strokeColor("#c9c4b8").lineWidth(0.5).stroke();
  };
  drawRow(cols.map((c) => c.h), true);
  const rows = schedule(plan);
  for (const r of rows) {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 36;
      drawRow(cols.map((c) => c.h), true);
    }
    const p = r.plant;
    drawRow([
      p.code, p.botanical, p.common, SIZE_LABEL[r.size], String(r.quantity), `${spacingFor(p, r.size)}" o.c.`, `${p.heightIn}"`,
      p.bloomMonths.length ? `${MONTHS[p.bloomMonths[0] - 1]}–${MONTHS[p.bloomMonths[p.bloomMonths.length - 1] - 1]} (${p.bloomColorName})` : "—",
      `${p.sun.join("/")} · ${p.moisture.join("/")}`,
    ]);
  }
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  y += 6;
  doc.font("Helvetica-Bold").fontSize(10).text(`Total: ${total} plants`, 36, y);
  const existing = bed.existing;
  if (existing.length) {
    y += 24;
    doc.font("Helvetica-Bold").text("Existing plants", 36, y);
    for (const e of existing) {
      y += 16;
      doc.font("Helvetica").text(`${e.name}: ${e.action === "keep" ? "to remain, protect during install" : "remove before planting"}`, 36, y);
    }
  }
  y += 28;
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#6b7568").text(
    "Quantities are computed from drift area and on-center spacing with a staggered-row factor; adjust ±10% on site. Plan is accurate to about 6 in.",
    36, y, { width: 700 },
  );
  doc.end();
  return done;
}
