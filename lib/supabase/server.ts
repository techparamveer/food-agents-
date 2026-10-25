import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from "@/lib/supabase/env";

/** Request-scoped client acting as the signed-in organiser, so RLS applies to every query. */
export async function createClient() {
  // cookies() must come first so prerendering bails out to dynamic before env is checked.
  const cookieStore = await cookies();
  assertSupabaseEnv();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, which can't set cookies. proxy.ts refreshes sessions.
        }
      },
    },
  });
}
