import assert from "node:assert/strict";
import { checkAllowance, defaultRules } from "@/lib/allowance";
import {
  attendeeFromRow,
  dietaryMixFromJson,
  eventFromRow,
  eventToInsert,
  eventToUpdate,
  linesFromJson,
  mealLogFromRow,
  memberFromRow,
  orderFromRow,
  planFromRow,
  restaurantsFromOrders,
  rulesFromSlotRow,
  rulesToSlotUpdate,
  savePlanPayload,
  savePlanResultFromJson,
  serveResultFromJson,
  slotFromRow,
} from "@/lib/db/mappers";
import type { AttendeeRow, EventRow, MealLogRow, MemberRow, OrderRow, PlanRow, SlotRow } from "@/lib/db/types";
import { statusFor } from "@/lib/db/types";
import { checkEventInput, checkEventPatch, checkInvite, checkOrderPatch, checkServe, checkSlotRules, isUuid } from "@/lib/db/validate";
import { HASH_PATTERN } from "@/lib/qr";
import { OXHACK } from "@/lib/seed/oxhack";

/* Database rows ↔ lib/types.ts, and the API's request checks. No database needed. */

const ts = "2026-11-14T13:00:00+00:00";
const E = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";

// Events: round trip through the insert shape, PostgREST timestamps normalised to ISO "Z".
const eventRow: EventRow = {
  id: E,
  created_by: null,
  name: "OxHack 2026",
  venue_name: "Mathematical Institute",
  venue_address: "Andrew Wiles Building, Woodstock Road, Oxford",
  venue_postcode: "OX2 6GG",
  venue_lat: 51.7604,
  venue_lng: -1.2632,
  timezone: "Europe/London",
  starts_at: "2026-11-14T10:00:00+00:00",
  ends_at: "2026-11-15T16:00:00+00:00",
  headcount: 150,
  budget: 5000 as unknown as number,
  currency: "GBP",
  dietary_mix: { veg: 0.15, vegan: 0.08, halal: 0.04, gf: 0.03 },
  created_at: ts,
  updated_at: ts,
};
const event = eventFromRow(eventRow);
assert.deepEqual(event.venue, { ...OXHACK.event.venue });
assert.equal(event.startsAt, "2026-11-14T10:00:00.000Z");
assert.deepEqual(event.dietaryMix, OXHACK.event.dietaryMix);
assert.equal(event.timeZone, "Europe/London");
const insert = eventToInsert(OXHACK.event);
assert.equal(insert.venue_lng, OXHACK.event.venue.lon);
assert.equal(insert.timezone, "Europe/London", "the demo has no timezone, so the default applies");
assert.equal(insert.currency, "GBP");
assert.deepEqual(eventToUpdate({ budget: 10, venue: { lat: 1 } }), { budget: 10, venue_lat: 1 });
// Numeric columns can arrive as strings; bad mix values clamp to 0–1.
assert.equal(eventFromRow({ ...eventRow, budget: "4999.50" as unknown as number }).budget, 4999.5);
assert.deepEqual(dietaryMixFromJson({ veg: 2, vegan: -1, halal: "x" }), { veg: 1, vegan: 0, halal: 0, gf: 0 });
assert.deepEqual(dietaryMixFromJson(null), { veg: 0, vegan: 0, halal: 0, gf: 0 });

// Members: a pending invite has no user.
const memberRow: MemberRow = { id: "m", event_id: E, user_id: null, invited_email: "a@b.co", role: "staff", invited_by: null, accepted_at: null, created_at: ts, updated_at: ts };
assert.deepEqual(memberFromRow(memberRow), { id: "m", eventId: E, userId: null, email: "a@b.co", role: "staff", pending: true, acceptedAt: null });

// Slots and their meal check rules feed lib/allowance.ts unchanged.
const slotRow: SlotRow = {
  id: S,
  event_id: E,
  label: "Saturday lunch",
  kind: "lunch",
  serves_at: ts,
  headcount: 150,
  allowance: 1,
  seconds_after_minutes: 30,
  seconds: 1,
  opens_before_minutes: 15,
  closes_after_minutes: 90,
  created_at: ts,
  updated_at: ts,
};
const slot = slotFromRow(slotRow);
assert.deepEqual(slot, { id: S, eventId: E, label: "Saturday lunch", kind: "lunch", servesAt: "2026-11-14T13:00:00.000Z", headcount: 150, allowance: 1 });
assert.deepEqual(rulesFromSlotRow(slotRow), defaultRules(slot), "database defaults match lib/allowance.ts for lunch");
assert.deepEqual(rulesToSlotUpdate({ servings: 2, secondsAfterMinutes: null }), { allowance: 2, seconds_after_minutes: null });

// Meal logs: undone logs are filtered by the query; mapped logs count in checkAllowance.
const logRow: MealLogRow = { id: "l1", event_id: E, slot_id: S, attendee_id: "a1", method: "qr", served_at: "2026-11-14T13:01:00+00:00", served_by: "u1", undone_at: null, undone_by: null, created_at: ts };
const log = mealLogFromRow(logRow);
assert.deepEqual(log, { id: "l1", attendeeId: "a1", slotId: S, at: "2026-11-14T13:01:00.000Z", method: "qr", servedBy: "u1" });
assert.equal(checkAllowance({ slot, rules: rulesFromSlotRow(slotRow), logs: [log], attendeeId: "a1", now: "2026-11-14T13:10:00Z" }).reason?.code, "seconds-later");

// serve_meal() answers.
const served = serveResultFromJson({ ok: true, log: logRow, eaten: 1, maxNow: 1, maxTotal: 2, secondsAt: "2026-11-14T13:30:00+00:00" });
assert.ok(served.ok && served.log.id === "l1" && served.secondsAt === "2026-11-14T13:30:00.000Z");
const refused = serveResultFromJson({ ok: false, code: "used", eaten: 2, maxNow: 2, maxTotal: 2, secondsAt: null });
assert.ok(!refused.ok && refused.code === "used" && refused.eaten === 2);
assert.throws(() => serveResultFromJson("nope"));

// Orders: lines are cleaned, the restaurant snapshot comes back by id.
const restaurant = OXHACK.restaurants[0];
const orderRow: OrderRow = {
  id: "o1",
  event_id: E,
  slot_id: S,
  plan_id: null,
  restaurant_id: restaurant.id,
  restaurant: restaurant as unknown as OrderRow["restaurant"],
  platform: "direct",
  status: "ordered",
  lines: [{ dietary: "vegan", quantity: 12.4 }, { dietary: "keto", quantity: 3 }, { dietary: "standard", quantity: 100, item: "Margherita" }],
  total: "612.50" as unknown as number,
  total_source: { label: "Comeda planner" },
  total_is_estimate: true,
  order_by: "2026-11-14T12:20:00+00:00",
  ordered_at: ts,
  created_at: ts,
  updated_at: ts,
};
const order = orderFromRow(orderRow);
assert.deepEqual(order.lines, [{ dietary: "vegan", quantity: 12 }, { dietary: "standard", quantity: 100, item: "Margherita" }]);
assert.deepEqual(order.total, { value: 612.5, source: { label: "Comeda planner" }, isEstimate: true });
assert.equal(order.orderBy, "2026-11-14T12:20:00.000Z");
assert.equal(orderFromRow({ ...orderRow, order_by: null }).orderBy, "");
assert.deepEqual(restaurantsFromOrders([orderRow, { ...orderRow, id: "o2" }, { ...orderRow, restaurant: {}, restaurant_id: "x" }]), [restaurant]);
assert.deepEqual(linesFromJson("nope"), []);

// Attendees: a missing avatar is generated from the name; email and dietary only when set.
const attendeeRow: AttendeeRow = { id: "a1", event_id: E, name: "Ada Lovelace", email: null, discord_handle: null, avatar_url: null, qr_hash: "q_" + "a".repeat(32), dietary: null, created_at: ts, updated_at: ts };
const attendee = attendeeFromRow(attendeeRow);
assert.equal(attendee.discordHandle, "");
assert.ok(attendee.avatarUrl.startsWith("data:image/svg+xml,"));
assert.ok(!("email" in attendee) && !("dietary" in attendee));
assert.match(attendee.qrHash, HASH_PATTERN, "database QR hashes scan");
assert.equal(attendeeFromRow({ ...attendeeRow, dietary: "halal", email: "ada@x.io" }).dietary, "halal");

// Plans: bad slots dropped, unknown statuses become "proposed".
const planRow: PlanRow = {
  id: "p1",
  event_id: E,
  source: "planner",
  status: "approved",
  slots: [{ slotId: S, restaurantId: "r", status: "approved", reason: "Cheapest" }, { slotId: S }, { slotId: S, restaurantId: "r2", status: "weird" }],
  total: 900 as unknown as number,
  total_source: {},
  generated_at: ts,
  created_by: null,
  approved_at: ts,
  approved_by: null,
  created_at: ts,
  updated_at: ts,
};
const plan = planFromRow(planRow);
assert.equal(plan.status, "approved");
assert.deepEqual(plan.slots, [
  { slotId: S, restaurantId: "r", status: "approved", reason: "Cheapest" },
  { slotId: S, restaurantId: "r2", status: "proposed" },
]);

// The save_plan payload carries every slot, each order with its restaurant snapshot, and the plan.
const payload = savePlanPayload(OXHACK, { approve: true });
assert.equal(payload.slots.length, OXHACK.slots.length);
assert.equal(payload.orders.length, OXHACK.orders.length);
for (const o of payload.orders) assert.equal((o.restaurant as { id: string }).id, o.restaurantId);
assert.equal(payload.approve, true);
assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload, "payload survives JSON");
assert.deepEqual(savePlanResultFromJson({ planId: "p", slotIds: { "sat-lunch": S, bad: 1 } }), { planId: "p", slotIds: { "sat-lunch": S } });

// Postgres errors → HTTP statuses.
assert.equal(statusFor("42501"), 403);
assert.equal(statusFor("PGRST116"), 404);
assert.equal(statusFor("23505"), 409);
assert.equal(statusFor("23514"), 400);
assert.equal(statusFor("XX000"), 500);

/* ---------- Request checks ---------- */

const goodEvent = {
  name: " Hack Night ",
  venue: { name: "Hall", lat: 52.2, lon: 0.12 },
  startsAt: "2026-12-01T18:00:00Z",
  endsAt: "2026-12-02T02:00:00Z",
  headcount: 80,
  budget: 1200.456,
  timeZone: "Europe/Paris",
};
const checked = checkEventInput(goodEvent);
assert.ok(checked.ok);
assert.equal(checked.value.name, "Hack Night");
assert.equal(checked.value.budget, 1200.46);
assert.deepEqual(checked.value.venue, { name: "Hall", lat: 52.2, lon: 0.12, address: "", postcode: "" });
assert.deepEqual(checked.value.dietaryMix, { veg: 0, vegan: 0, halal: 0, gf: 0 });
const bad = checkEventInput({ ...goodEvent, endsAt: "2026-11-30T00:00:00Z", headcount: 0, timeZone: "Mars/Base", venue: { name: "", lat: 200 } });
assert.ok(!bad.ok);
for (const p of ["endsAt must be after startsAt", "headcount", "Unknown timeZone", "venue.name is required", "venue.lat", "venue.lon is required"]) {
  assert.ok(bad.errors.some((e) => e.includes(p)), `expected a problem about ${p}: ${bad.errors.join("; ")}`);
}
assert.ok(!checkEventInput("x").ok);
assert.ok(!checkEventPatch({}).ok);
const patch = checkEventPatch({ budget: 10, venue: { postcode: "CB2" } });
assert.ok(patch.ok && patch.value.budget === 10 && patch.value.venue?.postcode === "CB2");

assert.deepEqual(checkInvite({ email: " Staff@Example.COM " }), { ok: true, value: { email: "staff@example.com", role: "staff" } });
assert.ok(!checkInvite({ email: "nope" }).ok);
assert.ok(!checkInvite({ email: "a@b.co", role: "admin" }).ok);

const orderPatch = checkOrderPatch({ status: "ordered", lines: [{ dietary: "vegan", quantity: 10 }] });
assert.ok(orderPatch.ok && orderPatch.value.status === "ordered" && orderPatch.value.lines?.length === 1);
assert.ok(!checkOrderPatch({ status: "eaten" }).ok);
assert.ok(!checkOrderPatch({ lines: [{ dietary: "vegan", quantity: 1.5 }] }).ok);
assert.ok(!checkOrderPatch({}).ok);

assert.deepEqual(checkSlotRules({ secondsAfterMinutes: null, servings: 2 }), { ok: true, value: { servings: 2, secondsAfterMinutes: null } });
assert.ok(!checkSlotRules({ closesAfterMinutes: 0 }).ok);

assert.ok(checkServe({ slotId: S, attendeeId: E }).ok);
assert.ok(!checkServe({ slotId: "sat-lunch", attendeeId: E }).ok);
assert.ok(!checkServe({ slotId: S, attendeeId: E, method: "nfc" }).ok);
assert.ok(isUuid(S) && !isUuid("oxhack-2026"));

console.log("test-db-mappers: ok");
