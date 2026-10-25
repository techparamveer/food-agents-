"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { safePath } from "@/lib/safe-path";
import { AFTER_SIGN_IN } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";

/* Organiser sign-in: email magic link only (Supabase Auth OTP). The link lands on /auth/confirm,
   which starts the session, claims any staff invites for that email, then goes to `next`. */

export type SignInState = { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/* Supabase also limits auth emails per project; this stops one visitor burning that allowance. */
const perIp = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });

/** Where the app is served, for the link in the email. Must be in Auth's redirect allow-list (supabase/config.toml). */
async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** For `useActionState(signInWithMagicLink, { status: "idle" })` on a form with `email` and optional `next` fields. */
export async function signInWithMagicLink(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) return { status: "error", message: "Enter a valid email address." };
  if (!perIp.hit(clientIp(await headers())).ok) return { status: "error", message: "Too many sign-in emails. Try again in a few minutes." };

  const next = safePath(String(form.get("next") ?? ""), AFTER_SIGN_IN);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    console.error("[auth] magic link failed:", error.status, error.code);
    return {
      status: "error",
      message: error.status === 429 ? "Too many sign-in emails. Try again in a few minutes." : "We couldn't send the link. Try again.",
    };
  }
  return { status: "sent", email };
}

/** Signs out on this device and returns to the sign-in page. Use as a form action. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
