import type { NextConfig } from "next";

// The font the server-side site plan PNG uses for its labels (see src/lib/render/raster.ts).
const SITE_PLAN_FONT = "./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf";

const nextConfig: NextConfig = {
  // Native / filesystem-heavy packages stay out of the server bundle.
  serverExternalPackages: ["better-sqlite3", "pdfkit", "svg-to-pdfkit", "@resvg/resvg-js"],
  // Keys are globs, so the render routes are matched with * rather than [id].
  outputFileTracingIncludes: { "/api/beds/*/renders{,/site-plan}": [SITE_PLAN_FONT] },
};

export default nextConfig;
