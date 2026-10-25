import { foodChatStream, type ChatState, type ChatTurn } from "@/lib/server/food-chat";

/** POST { message, history? } → newline-delimited JSON events (see lib/server/food-chat.ts).
    The demo has no sign-in, so this only ever plans the seeded OxHack event. */
export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  if (raw.length > 32_000) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: { message?: unknown; history?: unknown; state?: Record<string, unknown> } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  if (message.length > 2000) return Response.json({ error: "message is too long (2,000 characters max)" }, { status: 400 });

  const history: ChatTurn[] = Array.isArray(body?.history)
    ? body.history
        .filter((t): t is ChatTurn => (t?.role === "user" || t?.role === "assistant") && typeof t?.text === "string")
        .slice(-8)
    : [];

  const s = body?.state;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const state: ChatState | undefined =
    s && [s.spent, s.planned, s.budget, s.left].every((v) => num(v) !== undefined)
      ? { spent: s.spent as number, planned: s.planned as number, budget: s.budget as number, left: s.left as number }
      : undefined;

  return new Response(foodChatStream(message, history, state), {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
