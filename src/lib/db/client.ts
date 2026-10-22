import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export function dataDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? "./var");
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
  globalForDb.__bedDb = drizzle(sqlite, { schema });
  return globalForDb.__bedDb;
}
