import { supabase } from "@/lib/supabase";

const CACHE_TABLE = "user_cache";

async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getUserCache<T>(cacheKey: string): Promise<T | null> {
  if (!supabase) return null;
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("payload")
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error || !data) return null;
  return data.payload as T;
}

export async function setUserCache<T>(cacheKey: string, payload: T): Promise<void> {
  if (!supabase) return;
  const userId = await getCurrentUserId();
  if (!userId) return;

  await supabase.from(CACHE_TABLE).upsert(
    {
      user_id: userId,
      cache_key: cacheKey,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,cache_key" },
  );
}
