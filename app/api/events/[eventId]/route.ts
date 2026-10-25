import { deleteEvent, loadEventData, updateEvent } from "@/lib/db";
import { checkEventPatch } from "@/lib/db/validate";
import { ApiError, authed, body, ids, json, valid } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string }> };

/** GET /api/events/:eventId → EventData (event, slots, orders, restaurants, attendees, meal logs, latest plan). */
export const GET = authed<Ctx>(async (_request, { db }, { params }) => {
  const { eventId } = await ids(params);
  const data = await loadEventData(db, eventId);
  if (!data) throw new ApiError(404, "Not found");
  return json(data);
});

/** PATCH /api/events/:eventId { any event field } → { event }. Organisers only. */
export const PATCH = authed<Ctx>(async (request, { db }, { params }) => {
  const { eventId } = await ids(params);
  const patch = valid(checkEventPatch(await body(request)));
  return json({ event: await updateEvent(db, eventId, patch) });
});

/** DELETE /api/events/:eventId → 204. Organisers only; removes everything in the event. */
export const DELETE = authed<Ctx>(async (_request, { db }, { params }) => {
  const { eventId } = await ids(params);
  if (!(await deleteEvent(db, eventId))) throw new ApiError(404, "Not found");
  return new Response(null, { status: 204 });
});
