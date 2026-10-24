import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safePath } from "@/lib/safe-path";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/* Organiser-only routes. Empty while the demo is the only dashboard; add paths as auth lands. */
const PROTECTED: string[] = [];

/** Refreshes the auth session on every request and sends signed-out visitors to /login. */
export async function updateSession(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Keep this call directly after createServerClient: it refreshes the token.
  const { data } = await supabase.auth.getClaims();
  let signedIn = Boolean(data?.claims?.sub);
  if (!signedIn) {
    const { data: userData } = await supabase.auth.getUser();
    signedIn = Boolean(userData.user);
  }

  const path = request.nextUrl.pathname;
  if (!signedIn && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (signedIn && path === "/login") {
    const next = safePath(request.nextUrl.searchParams.get("next"), "/demo");
    return NextResponse.redirect(new URL(next, request.url));
  }
  return response;
}
