import assert from "node:assert/strict";
import { checkAllowance, countEaten, defaultRules, logServing, parseRuleOverrides, parseRules, slotAt, type SlotRules } from "@/lib/allowance";
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

// Zero servings blocks everyone until seconds open (odd, but it shouldn't crash), and says so
// without claiming they've already eaten.
{
  const a = check([], at("18:40"), { ...rules, servings: 0 });
  assert.equal(a.ok, false);
  assert.equal(a.reason?.code, "not-open");
  assert.equal(a.reason?.text, "Saturday dinner opens at 19:00");
  assert.equal(check([], at("19:00"), { ...rules, servings: 0 }).ok, true);
  const none = check([], at("18:40"), { ...rules, servings: 0, secondsAfterMinutes: null });
  assert.equal(none.reason?.code, "none");
  assert.doesNotMatch(none.reason!.text, /already/i);
}

// Accepts a numeric clock too.
assert.equal(checkAllowance({ slot: dinner, rules, logs: [], attendeeId: "a", now: Date.parse(at("18:30")) }).ok, true);

// Snacks use their own defaults.
assert.equal(defaultRules({ ...dinner, kind: "snack" }).secondsAfterMinutes, 20);

// Serving re-checks with the clock and logs at the moment of the tap, not the card's.
{
  const serve = (logs: MealLog[], now: string) =>
    logServing({ slot: dinner, rules, logs, attendeeId: "a", now, method: "qr", id: "new" });
  const ok = serve([], at("18:40"));
  assert.ok(ok.ok);
  assert.deepEqual(ok.log, { id: "new", attendeeId: "a", slotId: dinner.id, at: "2026-11-14T18:40:00.000Z", method: "qr" });
  // The card said OK, but they were served meanwhile (a double tap, or another table).
  const twice = serve([ok.log], at("18:40"));
  assert.equal(twice.ok, false);
  assert.equal(!twice.ok && twice.allowance.reason?.code, "seconds-later");
  // The card said OK at 20:29, but the table closed before the tap.
  const late = serve([], at("20:30"));
  assert.equal(!late.ok && late.allowance.reason?.code, "closed");
}

// The slot follows the clock, using each slot's own rules.
{
  const lunch: MealSlot = { ...dinner, id: "sat-lunch", label: "Saturday lunch", kind: "lunch", servesAt: at("12:30") };
  const snack: MealSlot = { ...dinner, id: "sat-snack", label: "Saturday midnight snack", kind: "snack", servesAt: "2026-11-15T00:00:00Z" };
  const slots = [lunch, dinner, snack];
  const pick = (now: string, overrides?: Record<string, SlotRules>) => slotAt(slots, Date.parse(now), overrides).id;
  assert.equal(pick(at("09:00")), "sat-lunch", "before anything: the next to open");
  assert.equal(pick(at("13:00")), "sat-lunch", "while lunch is open");
  assert.equal(pick(at("14:00")), "sat-dinner", "lunch closed at 14:00: on to dinner");
  assert.equal(pick(at("18:30")), "sat-dinner");
  assert.equal(pick(at("20:30")), "sat-snack", "dinner closed at 20:30: on to the snack");
  assert.equal(pick("2026-11-15T03:00:00Z"), "sat-snack", "after everything: the last");
  // Overrides move the boundaries: lunch kept open until 15:00, dinner opening an hour early.
  const longLunch = { ...defaultRules(lunch), closesAfterMinutes: 150 };
  assert.equal(pick(at("14:30"), { "sat-lunch": longLunch }), "sat-lunch");
  assert.equal(pick(at("15:00"), { "sat-lunch": longLunch }), "sat-dinner");
  const earlyDinner = { ...rules, opensBeforeMinutes: 60 };
  assert.equal(pick(at("17:20"), { "sat-lunch": longLunch, "sat-dinner": earlyDinner }), "sat-dinner");
}

// Rules restored from storage: valid ones kept, anything malformed dropped.
{
  assert.deepEqual(parseRules(rules), rules);
  assert.deepEqual(parseRules({ ...rules, secondsAfterMinutes: null }), { ...rules, secondsAfterMinutes: null });
  for (const bad of [
    null,
    "rules",
    [],
    {},
    { ...rules, servings: "2" },
    { ...rules, servings: -1 },
    { ...rules, servings: 1.5 },
    { ...rules, servings: 99 },
    { ...rules, secondsAfterMinutes: undefined },
    { ...rules, secondsAfterMinutes: Number.NaN },
    { ...rules, seconds: Infinity },
    { ...rules, closesAfterMinutes: 0 },
    { servings: 1 },
  ]) {
    assert.equal(parseRules(bad), null, JSON.stringify(bad));
  }
  // Extra keys are dropped rather than carried along.
  assert.deepEqual(parseRules({ ...rules, evil: true }), rules);

  const restored = parseRuleOverrides(
    { "sat-dinner": { ...rules, servings: 2 }, "sat-lunch": { servings: "lots" }, "gone-slot": rules, __proto__: rules },
    [dinner, { ...dinner, id: "sat-lunch" }],
  );
  assert.deepEqual(restored, { "sat-dinner": { ...rules, servings: 2 } });
  for (const bad of [null, 42, "x", [rules], JSON.parse("[]")]) assert.deepEqual(parseRuleOverrides(bad, [dinner]), {});
}

console.log("allowance: all tests passed");
