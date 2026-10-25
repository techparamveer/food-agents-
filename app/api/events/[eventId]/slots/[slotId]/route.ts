import { updateSlotRules } from "@/lib/db";
import { checkSlotRules } from "@/lib/db/validate";
import { authed, body, ids, json, valid } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string; slotId: string }> };

/** PATCH /api/events/:eventId/slots/:slotId { servings?, secondsAfterMinutes? (null = no seconds), seconds?,
    opensBeforeMinutes?, closesAfterMinutes? } → { slot } with its rules. Organisers only. */
export const PATCH = authed<Ctx>(async (request, { db }, { params }) => {
  const { eventId, slotId } = await ids(params);
  const rules = valid(checkSlotRules(await body(request)));
  return json({ slot: await updateSlotRules(db, eventId, slotId, rules) });
});
