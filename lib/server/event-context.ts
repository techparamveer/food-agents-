import "server-only";

import { getEvent } from "@/lib/db/events";
import { isUuid } from "@/lib/db/validate";
import { currentUser } from "@/lib/server/api";
import { OXHACK_EVENT, OXHACK_NOW } from "@/lib/seed/oxhack";
import type { Event } from "@/lib/types";

/** The event a public planning route (restaurants, chat) works for, and its clock. */
export type EventContext = { event: Event; now: string; demo: boolean };

export const DEMO_CONTEXT: EventContext = { event: OXHACK_EVENT, now: OXHACK_NOW, demo: true };

/**
 * No `eventId`: the seeded OxHack demo (no sign-in needed). With one: that event, if the caller is
 * signed in and a member, else null (the route answers 404, so ids can't be probed).
 */
export async function eventContext(eventId: string | null | undefined): Promise<EventContext | null> {
  if (!eventId) return DEMO_CONTEXT;
  if (!isUuid(eventId)) return null;
  const auth = await currentUser();
  if (!auth) return null;
  try {
    const event = await getEvent(auth.db, eventId);
    return event ? { event, now: new Date().toISOString(), demo: false } : null;
  } catch {
    return null;
  }
}
