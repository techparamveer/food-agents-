import { attendeeFromRow, emptyPlan, eventFromRow, eventToInsert, eventToUpdate, mealLogFromRow, orderFromRow, planFromRow, restaurantsFromOrders, slotFromRow, type EventInput, type EventPatch } from "@/lib/db/mappers";
import { maybe, unwrap, type Db, type EventRole } from "@/lib/db/types";
import type { Event, EventData } from "@/lib/types";

/* Events. Every call runs as the client's user, so RLS decides: members read, organisers write. */

/** Events the signed-in user organises or staffs, soonest first, with their role. */
export async function listMyEvents(db: Db): Promise<(Event & { role: EventRole })[]> {
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return [];
  const rows = unwrap(
    await db.from("events").select("*, event_members!inner(role)").eq("event_members.user_id", uid).order("starts_at", { ascending: true }),
  );
  return rows.map(({ event_members, ...row }) => ({ ...eventFromRow(row), role: event_members[0]?.role ?? "staff" }));
}

/** One event, or null when it doesn't exist or isn't the caller's. */
export async function getEvent(db: Db, eventId: string): Promise<Event | null> {
  const row = maybe(await db.from("events").select("*").eq("id", eventId).maybeSingle());
  return row ? eventFromRow(row) : null;
}

/** Creates an event; the database makes the caller its organiser. */
export async function createEvent(db: Db, input: EventInput): Promise<Event> {
  return eventFromRow(unwrap(await db.from("events").insert(eventToInsert(input)).select().single()));
}

export async function updateEvent(db: Db, eventId: string, patch: EventPatch): Promise<Event> {
  return eventFromRow(unwrap(await db.from("events").update(eventToUpdate(patch)).eq("id", eventId).select().single()));
}

/** Deletes the event and everything in it (organisers only). False if nothing was deleted. */
export async function deleteEvent(db: Db, eventId: string): Promise<boolean> {
  const rows = unwrap(await db.from("events").delete().eq("id", eventId).select("id"));
  return rows.length > 0;
}

/**
 * Everything the dashboard renders for one event, in lib/types.ts's EventData shape, or null if the
 * caller can't see the event. Restaurants are the snapshots orders were planned with; undone meal
 * logs are left out (they don't count towards allowances).
 */
export async function loadEventData(db: Db, eventId: string, now = new Date().toISOString()): Promise<EventData | null> {
  const event = await getEvent(db, eventId);
  if (!event) return null;
  const [slots, orders, attendees, logs, plan] = await Promise.all([
    db.from("meal_slots").select("*").eq("event_id", eventId).order("serves_at"),
    db.from("orders").select("*").eq("event_id", eventId),
    db.from("attendees").select("*").eq("event_id", eventId).order("name").limit(10_000),
    db.from("meal_logs").select("*").eq("event_id", eventId).is("undone_at", null).order("served_at").limit(50_000),
    db.from("plans").select("*").eq("event_id", eventId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const orderRows = unwrap(orders);
  const latest = maybe(plan);
  return {
    now,
    event,
    slots: unwrap(slots).map(slotFromRow),
    restaurants: restaurantsFromOrders(orderRows),
    orders: orderRows.map(orderFromRow),
    attendees: unwrap(attendees).map(attendeeFromRow),
    mealLogs: unwrap(logs).map(mealLogFromRow),
    plan: latest ? planFromRow(latest) : emptyPlan(eventId, now),
  };
}
