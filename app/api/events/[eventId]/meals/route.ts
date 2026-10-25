import { listMealLogs, serveMeal } from "@/lib/db";
import { checkServe, isUuid } from "@/lib/db/validate";
import { authed, body, ids, json, valid } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string }> };

/** GET /api/events/:eventId/meals?slot=<slotId>&undone=1 → { logs }. Any member. */
export const GET = authed<Ctx>(async (request, { db }, { params }) => {
  const { eventId } = await ids(params);
  const q = new URL(request.url).searchParams;
  const slot = q.get("slot");
  return json({ logs: await listMealLogs(db, eventId, { slotId: isUuid(slot) ? slot : undefined, includeUndone: q.get("undone") === "1" }) });
});

/**
 * POST /api/events/:eventId/meals { slotId, attendeeId, method? = "qr" } → serve one meal. Any member (staff too).
 * 201 { ok: true, log, eaten, maxNow, maxTotal, secondsAt } when served;
 * 200 { ok: false, code: "not-open" | "closed" | "used" | "seconds-later", … } when the allowance says no.
 * Atomic: two devices serving the same attendee can't both succeed.
 */
export const POST = authed<Ctx>(async (request, { db }, { params }) => {
  await ids(params);
  const { slotId, attendeeId, method } = valid(checkServe(await body(request)));
  const result = await serveMeal(db, slotId, attendeeId, method);
  return json(result, result.ok ? 201 : 200);
});
