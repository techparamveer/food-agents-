import "server-only";

import { DbError, type Db } from "@/lib/db/types";
import { isUuid } from "@/lib/db/validate";
import { createClient } from "@/lib/supabase/server";

/* Shared plumbing for the signed-in API routes under /api/events. Every handler gets a Supabase
   client acting as the caller (so RLS decides what they can touch) and their user id; signed-out
   requests get 401. Errors become JSON with a sensible status; database details stay in the logs. */

export type Authed = { db: Db; userId: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The signed-in caller, or null. The JWT is verified (getClaims checks the signature). */
export async function currentUser(): Promise<Authed | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return null;
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId || data?.claims?.is_anonymous) return null;
  return { db, userId };
}

/** Wraps a route handler: auth, error mapping, no caching. */
export function authed<Ctx>(handler: (request: Request, auth: Authed, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      const auth = await currentUser();
      if (!auth) return json({ error: "Sign in first" }, 401);
      return await handler(request, auth, ctx);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, error.status);
      if (error instanceof DbError) {
        if (error.status >= 500) console.error("[api] database error:", error.code, error.message);
        const message = error.status === 404 ? "Not found" : error.status === 403 ? "You can't do that on this event" : error.status === 409 ? "That already exists" : error.status === 400 ? error.message : "Something went wrong";
        return json({ error: message }, error.status);
      }
      console.error("[api] unexpected error:", error instanceof Error ? error.message : error);
      return json({ error: "Something went wrong" }, 500);
    }
  };
}

/** Route params, with ids checked to be uuids (anything else can't exist, so 404). */
export async function ids<K extends string>(params: Promise<Record<K, string>>): Promise<Record<K, string>> {
  const p = await params;
  for (const v of Object.values(p) as string[]) if (!isUuid(v)) throw new ApiError(404, "Not found");
  return p;
}

/** Reads a JSON body of at most `max` bytes. */
export async function body(request: Request, max = 256_000): Promise<unknown> {
  const text = await textBody(request, max);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Send a JSON body");
  }
}

/** Reads a text body of at most `max` bytes. */
export async function textBody(request: Request, max: number): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new ApiError(413, "Request too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > max) throw new ApiError(413, "Request too large");
  return text;
}

/** Throws a 400 with the validator's problems. */
export function valid<T>(checked: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!checked.ok) throw new ApiError(400, checked.errors[0], checked.errors);
  return checked.value;
}
