import { updateOrder } from "@/lib/db";
import { checkOrderPatch } from "@/lib/db/validate";
import { authed, body, ids, json, valid } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string; orderId: string }> };

/** PATCH /api/events/:eventId/orders/:orderId { status?, lines?, platform? } → { order }. Organisers only. */
export const PATCH = authed<Ctx>(async (request, { db }, { params }) => {
  const { eventId, orderId } = await ids(params);
  const patch = valid(checkOrderPatch(await body(request)));
  return json({ order: await updateOrder(db, eventId, orderId, patch) });
});
