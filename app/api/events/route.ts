import { createEvent, listMyEvents } from "@/lib/db";
import { checkEventInput } from "@/lib/db/validate";
import { authed, body, json, valid } from "@/lib/server/api";

/** GET /api/events → { events: (Event & { role })[] }: the caller's events, soonest first. */
export const GET = authed(async (_request, { db }) => json({ events: await listMyEvents(db) }));

/** POST /api/events { name, venue: { name, address?, postcode?, lat, lon }, startsAt, endsAt, headcount, budget,
    dietaryMix?, timeZone?, currency? } → 201 { event }. The caller becomes its organiser. */
export const POST = authed(async (request, { db }) => {
  const input = valid(checkEventInput(await body(request)));
  return json({ event: await createEvent(db, input) }, 201);
});
