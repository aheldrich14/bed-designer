import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / filesystem-heavy packages stay out of the server bundle.
  serverExternalPackages: ["better-sqlite3", "pdfkit", "svg-to-pdfkit"],
};

export default nextConfig;
