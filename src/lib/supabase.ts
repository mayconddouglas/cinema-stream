import { createClient } from "@supabase/supabase-js";

const env = import.meta as unknown as {
  env?: {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
  };
};

const supabaseUrl = typeof env.env?.VITE_SUPABASE_URL === "string" ? env.env.VITE_SUPABASE_URL : "";
const supabaseAnonKey =
  typeof env.env?.VITE_SUPABASE_ANON_KEY === "string" ? env.env.VITE_SUPABASE_ANON_KEY : "";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
      })
    : null;

