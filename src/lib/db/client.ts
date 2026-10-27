import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

let resolvedDir: string | null = null;

/**
 * Where the SQLite db and uploads live: DATA_DIR, else ./var. On read-only
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

export type Db = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __bedDb?: Db };

/** One connection per server process (survives Next.js dev hot reloads). */
export function getDb(): Db {
  if (globalForDb.__bedDb) return globalForDb.__bedDb;
  const file = process.env.DATABASE_FILE ?? path.join(dataDir(), "bed-planner.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(schema.BOOTSTRAP_SQL);
  for (const c of schema.ADDED_COLUMNS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${c.table})`).all() as { name: string }[];
    if (!cols.some((x) => x.name === c.column)) sqlite.exec(c.sql);
  }
  globalForDb.__bedDb = drizzle(sqlite, { schema });
  return globalForDb.__bedDb;
}
