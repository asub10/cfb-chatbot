import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Builds a deterministic cache key from a CFBD path and its query params.
 * Params are sorted alphabetically so key is order-independent.
 */
export function makeCacheKey(
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  if (!params) return path;

  const sorted = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return sorted ? `${path}?${sorted}` : path;
}

/**
 * Cache-first wrapper. Returns a cached response if one exists and is within
 * `ttlHours`. Otherwise calls `fetcher`, stores the result, and returns it.
 */
export async function withCache<T>(
  db: SupabaseClient,
  key: string,
  ttlHours: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cutoff = new Date(
    Date.now() - ttlHours * 60 * 60 * 1000
  ).toISOString();

  const { data } = await db
    .from("cfbd_cache")
    .select("response_json")
    .eq("key", key)
    .gte("created_at", cutoff)
    .maybeSingle();

  if (data) {
    return data.response_json as T;
  }

  const result = await fetcher();

  // Upsert so a stale row is replaced rather than causing a unique-key error.
  // A write failure is non-fatal — log and continue; the caller still gets fresh data.
  const { error } = await db
    .from("cfbd_cache")
    .upsert(
      { key, response_json: result, created_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  if (error) {
    console.error(`[cfbd-cache] write failed for key "${key}":`, error.message);
  }

  return result;
}
