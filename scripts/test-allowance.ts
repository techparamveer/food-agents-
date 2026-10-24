import assert from "node:assert/strict";
import { checkAllowance, countEaten, defaultRules, type SlotRules } from "@/lib/allowance";
import type { MealLog, MealSlot } from "@/lib/types";

/* Meal allowance: one serving by default, seconds N minutes after the slot starts. */

const dinner: MealSlot = {
  id: "sat-dinner",
  eventId: "oxhack-2026",
  label: "Saturday dinner",
  kind: "dinner",
  servesAt: "2026-11-14T18:30:00Z",
  headcount: 150,
  allowance: 1,
};
const at = (hhmm: string) => `2026-11-14T${hhmm}:00Z`;
let n = 0;
const log = (attendeeId: string, slotId = dinner.id): MealLog => ({ id: `l${++n}`, attendeeId, slotId, at: at("18:35"), method: "qr" });

const rules = defaultRules(dinner);
const check = (logs: MealLog[], now: string, r: SlotRules = rules, attendeeId = "a") =>
  checkAllowance({ slot: dinner, rules: r, logs, attendeeId, now });

// Defaults: the slot's allowance, seconds 30 minutes in.
assert.equal(rules.servings, 1);
assert.equal(rules.secondsAfterMinutes, 30);
assert.equal(rules.seconds, 1);

// First serving at the start of the slot.
{
  const a = check([], at("18:30"));
  assert.equal(a.ok, true);
  assert.equal(a.eaten, 0);
  assert.equal(a.remaining, 1);
  assert.equal(a.limit, 1);
  assert.equal(a.max, 2);
  assert.equal(a.secondsOpen, false);
  assert.equal(a.secondsAt, "2026-11-14T19:00:00.000Z");
}

// Second serving before seconds open is blocked, and says when they open (London is on UTC in November).
{
  const a = check([log("a")], at("18:45"));
  assert.equal(a.ok, false);
  assert.equal(a.reason?.code, "seconds-later");
  assert.match(a.reason!.text, /19:00/);
  assert.equal(a.eaten, 1);
  assert.equal(a.remaining, 0);
}

// Seconds open exactly N minutes after the start.
{
  const a = check([log("a")], at("19:00"));
  assert.equal(a.ok, true);
  assert.equal(a.secondsOpen, true);
  assert.equal(a.limit, 2);
  assert.equal(a.remaining, 1);
}

// After seconds are used, blocked for good.
{
  const a = check([log("a"), log("a")], at("19:10"));
  assert.equal(a.ok, false);
  assert.equal(a.reason?.code, "used");
  assert.equal(a.eaten, 2);
}

// Other attendees' logs and other slots' logs don't count.
{
  const logs = [log("b"), log("b"), log("a", "sat-lunch")];
  assert.equal(countEaten(logs, dinner.id, "a"), 0);
  assert.equal(check(logs, at("18:40")).ok, true);
}

// No seconds for this slot: one serving, then "used", even late on.
{
  const noSeconds = { ...rules, secondsAfterMinutes: null };
  const a = check([log("a")], at("19:30"), noSeconds);
  assert.equal(a.ok, false);
  assert.equal(a.reason?.code, "used");
  assert.equal(a.max, 1);
  assert.equal(a.secondsAt, null);
  // seconds: 0 also means none.
  assert.equal(check([log("a")], at("19:30"), { ...rules, seconds: 0 }).reason?.code, "used");
}

// Configurable per slot: two servings, seconds after 10 minutes, two extra.
{
  const generous: SlotRules = { ...rules, servings: 2, secondsAfterMinutes: 10, seconds: 2 };
  assert.equal(check([log("a")], at("18:35"), generous).ok, true);
  assert.equal(check([log("a"), log("a")], at("18:35"), generous).reason?.code, "seconds-later");
  const late = check([log("a"), log("a"), log("a")], at("18:41"), generous);
  assert.equal(late.ok, true);
  assert.equal(late.limit, 4);
  assert.equal(late.remaining, 1);
}

// Table window: opens before the slot, closes after.
{
  const early = check([], at("18:00"));
  assert.equal(early.ok, false);
  assert.equal(early.reason?.code, "not-open");
  assert.match(early.reason!.text, /opens at 18:15/);
  assert.equal(check([], at("18:15")).ok, true);
  const closed = check([], at("20:30"));
  assert.equal(closed.ok, false);
  assert.equal(closed.reason?.code, "closed");
  assert.equal(check([], at("20:29")).ok, true);
}

// Zero servings blocks everyone until seconds open (odd, but it shouldn't crash).
{
  const a = check([], at("18:40"), { ...rules, servings: 0 });
  assert.equal(a.ok, false);
  assert.equal(a.reason?.code, "seconds-later");
}

// Accepts a numeric clock too.
assert.equal(checkAllowance({ slot: dinner, rules, logs: [], attendeeId: "a", now: Date.parse(at("18:30")) }).ok, true);

// Snacks use their own defaults.
assert.equal(defaultRules({ ...dinner, kind: "snack" }).secondsAfterMinutes, 20);

console.log("allowance: all tests passed");
