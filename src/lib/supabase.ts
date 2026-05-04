import { createClient } from "@supabase/supabase-js";

const env = import.meta as unknown as {
  env?: {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  };
};

const FALLBACK_SUPABASE_URL = "https://xyaurvwvkjnuvcvloksu.supabase.co";
const FALLBACK_SUPABASE_KEY = "sb_publishable_LSxvpMOzzvmqk3mshtXh2w_gwVJxBMx";

const supabaseUrl =
  typeof env.env?.VITE_SUPABASE_URL === "string"
    ? env.env.VITE_SUPABASE_URL.trim()
    : typeof env.env?.NEXT_PUBLIC_SUPABASE_URL === "string"
      ? env.env.NEXT_PUBLIC_SUPABASE_URL.trim()
      : "";
const supabaseAnonKey =
  typeof env.env?.VITE_SUPABASE_ANON_KEY === "string"
    ? env.env.VITE_SUPABASE_ANON_KEY.trim()
    : typeof env.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === "string"
      ? env.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim()
      : "";

const resolvedUrl = supabaseUrl || FALLBACK_SUPABASE_URL;
const resolvedKey = supabaseAnonKey || FALLBACK_SUPABASE_KEY;

export const supabase =
  resolvedUrl && resolvedKey
    ? createClient(resolvedUrl, resolvedKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
      })
    : null;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("[supabase] env ausente no build, usando fallback embutido.");
}
