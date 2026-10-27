import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

// Serverless hosts have no system fonts, so labels use the Geist font that
// ships with Next.js (traced into the renders route in next.config.ts).
const FONT = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf");

/** Rasterizes an SVG string to PNG at the given pixel width. */
export function svgToPng(svg: string, width: number): Buffer {
  const hasFont = fs.existsSync(FONT);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(width) },
    font: hasFont
      ? { fontFiles: [FONT], loadSystemFonts: true, defaultFontFamily: "Geist", sansSerifFamily: "Geist" }
      : { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}
