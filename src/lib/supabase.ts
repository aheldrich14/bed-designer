import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Shared Supabase client for the Supabase db backend and file store. Server-only:
// it uses the secret (service role) key, which bypasses row level security.

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

/** Table names get this prefix so the app can share an existing Supabase project. */
export const TABLE_PREFIX = process.env.SUPABASE_TABLE_PREFIX ?? "bed_planner_";

/** Storage bucket for aerials, photos and renders. */
export const STORAGE_BUCKET = process.env.SUPABASE_BUCKET ?? "bed-planner";

const globalForSb = globalThis as unknown as { __bedSupabase?: SupabaseClient };

export function getSupabase(): SupabaseClient {
  if (globalForSb.__bedSupabase) return globalForSb.__bedSupabase;
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase backend selected but SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are not set.");
  globalForSb.__bedSupabase = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  return globalForSb.__bedSupabase;
}
