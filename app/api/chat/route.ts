import { sanitizeHistory } from "@/lib/chat-history";
import { clientIp, createRateLimiter, tooManyRequests } from "@/lib/rate-limit";
import { eventContext } from "@/lib/server/event-context";
import { foodChatStream, replySigner, type ChatState } from "@/lib/server/food-chat";

/* Each message can cost up to three Gemini calls, so: a few messages a minute per visitor, and a
   ceiling across everyone so a botnet can't run up the bill. In memory, per server instance. */
const perIp = createRateLimiter({ limit: 10, windowMs: 60_000 });
const everyone = createRateLimiter({ limit: 60, windowMs: 60_000 });

/** Request bodies above this are refused unread. A message, 8 turns of history and the budget fit easily. */
const MAX_BODY_BYTES = 24_000;

/** Reads at most `max` bytes of the body; null when it's bigger. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** POST { message, history?, state?, eventId? } → newline-delimited JSON events (see lib/server/food-chat.ts).
    Without `eventId` it plans the seeded OxHack demo (no sign-in); with one, that event for its members (else 404). */
export async function POST(request: Request) {
  const mine = perIp.hit(clientIp(request.headers));
  if (!mine.ok) return tooManyRequests(mine, "That's a lot of questions at once. Give it a minute and try again.");
  const all = everyone.hit("all");
  if (!all.ok) return tooManyRequests(all, "Comeda is busy right now. Try again in a minute.");

  const raw = await readCapped(request, MAX_BODY_BYTES).catch(() => "");
  if (raw === null) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: { message?: unknown; history?: unknown; state?: Record<string, unknown>; eventId?: unknown } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  if (message.length > 2000) return Response.json({ error: "message is too long (2,000 characters max)" }, { status: 400 });

  const ctx = await eventContext(typeof body?.eventId === "string" ? body.eventId : null);
  if (!ctx) return Response.json({ error: "Event not found" }, { status: 404 });

  // Only the server's own signed replies count as assistant turns.
  const history = sanitizeHistory(body?.history, replySigner.verify);

  const s = body?.state;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 10_000_000 ? v : undefined);
  const state: ChatState | undefined =
    s && [s.spent, s.planned, s.budget, s.left].every((v) => num(v) !== undefined)
      ? { spent: s.spent as number, planned: s.planned as number, budget: s.budget as number, left: s.left as number }
      : undefined;

  return new Response(foodChatStream(message, history, state, ctx), {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
