import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let resolvedDir: string | null = null;

/**
 * Where the SQLite db and local uploads live: DATA_DIR, else ./var. On read-only
 * hosts (e.g. Vercel, where only /tmp is writable) it falls back to the OS
 * temp folder, which is temporary: fine for a demo, not for real data.
 */
export function dataDir(): string {
  if (resolvedDir) return resolvedDir;
  if (process.env.DATA_DIR) return (resolvedDir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR));
  const local = path.resolve(/*turbopackIgnore: true*/ "./var");
  try {
    fs.mkdirSync(local, { recursive: true });
    fs.accessSync(local, fs.constants.W_OK);
    resolvedDir = local;
  } catch {
    resolvedDir = path.join(/*turbopackIgnore: true*/ os.tmpdir(), "bed-planner");
    fs.mkdirSync(resolvedDir, { recursive: true });
  }
  return resolvedDir;
}
