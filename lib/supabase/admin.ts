import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, assertSupabaseEnv } from "@/lib/supabase/env";

/* Bypasses RLS. Only for server work that isn't on behalf of one organiser, such as caching
   Places and Gemini responses. Never import this from a client component, and never pass
   user input straight into its queries. */

let admin: SupabaseClient | undefined;

export function adminClient(): SupabaseClient {
  if (admin) return admin;
  assertSupabaseEnv();
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Set SUPABASE_SECRET_KEY in .env.local");
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
