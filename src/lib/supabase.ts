import { createClient } from "@supabase/supabase-js";

const env = import.meta as unknown as {
  env?: {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  };
};

const supabaseUrl =
  typeof env.env?.VITE_SUPABASE_URL === "string"
    ? env.env.VITE_SUPABASE_URL
    : typeof env.env?.NEXT_PUBLIC_SUPABASE_URL === "string"
      ? env.env.NEXT_PUBLIC_SUPABASE_URL
      : "";
const supabaseAnonKey =
  typeof env.env?.VITE_SUPABASE_ANON_KEY === "string"
    ? env.env.VITE_SUPABASE_ANON_KEY
    : typeof env.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === "string"
      ? env.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      : "";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
      })
    : null;
