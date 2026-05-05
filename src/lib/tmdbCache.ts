import { supabase } from "@/lib/supabase";

type MemoryEntry<T> = { payload: T; expiresAtMs: number };

const TABLE = "tmdb_cache";
const memoryCache = new Map<string, MemoryEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function nowMs() {
  return Date.now();
}

function expiresAtIso(ttlSeconds: number) {
  return new Date(nowMs() + ttlSeconds * 1000).toISOString();
}

export async function getTmdbCache<T>(cacheKey: string): Promise<T | null> {
  const mem = memoryCache.get(cacheKey);
  if (mem && mem.expiresAtMs > nowMs()) {
    return mem.payload as T;
  }

  if (!supabase) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .select("payload, expires_at")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  const expiresAtMs = Number(new Date(data.expires_at));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs()) return null;

  memoryCache.set(cacheKey, { payload: data.payload, expiresAtMs });
  return data.payload as T;
}

export async function setTmdbCache<T>(
  cacheKey: string,
  payload: T,
  ttlSeconds: number,
): Promise<void> {
  const expiresAtMs = nowMs() + ttlSeconds * 1000;
  memoryCache.set(cacheKey, { payload, expiresAtMs });

  if (!supabase) return;
  await supabase.from(TABLE).upsert(
    {
      cache_key: cacheKey,
      payload,
      expires_at: expiresAtIso(ttlSeconds),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" },
  );
}

export async function withTmdbCache<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await getTmdbCache<T>(cacheKey);
  if (cached) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    const fresh = await fetcher();
    await setTmdbCache(cacheKey, fresh, ttlSeconds);
    return fresh;
  })().finally(() => {
    inFlight.delete(cacheKey);
  });

  inFlight.set(cacheKey, promise);
  return promise;
}
