import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { acceptInvites } from "@/lib/db/members";
import { safePath } from "@/lib/safe-path";
import { AFTER_SIGN_IN } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

/**
 * GET /auth/confirm: where magic links land. Two link shapes work:
 *   ?token_hash=…&type=email  (custom email template, any device; see supabase/templates/magic_link.html)
 *   ?code=…                   (Supabase's default template, PKCE: the browser that asked for the link)
 * On success the session cookie is set, pending staff invites for this email are claimed, and the
 * organiser goes to `next`. On failure: /login?error=link.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safePath(url.searchParams.get("next"), AFTER_SIGN_IN);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  if (!ok) {
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "link");
    if (next !== AFTER_SIGN_IN) login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  try {
    await acceptInvites(supabase);
  } catch (error) {
    // Signing in matters more than the invite; the next sign-in claims it.
    console.error("[auth] accept_invites failed:", error instanceof Error ? error.message : error);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
