import assert from "node:assert/strict";
import { looksLikePlanRequest, nextAt, parseFoodRequest, plannerInputFor } from "@/lib/food-request";
import { OXHACK_EVENT, OXHACK_NOW } from "@/lib/seed/oxhack";

/* The no-key chat fallback reads requests like the spec's example. */

assert.deepEqual(parseFoodRequest("feed 150, 20 vegan, by 7pm under £600"), {
  headcount: 150,
  budget: 600,
  dietaryCounts: { vegan: 20 },
  dietaryShares: {},
  by: "19:00",
  wholeEvent: false,
  mentions: ["vegan"],
});

const weekend = parseFoodRequest("Plan the whole weekend for 150 people on £5k, 15% veg and 3% gluten-free");
assert.equal(weekend.headcount, 150);
assert.equal(weekend.budget, 5000);
assert.deepEqual(weekend.dietaryShares, { veg: 0.15, gf: 0.03 });
assert.equal(weekend.wholeEvent, true);

const mixed = parseFoodRequest("lunch for 80 hackers at 12:30, 10 vegetarians, 4 halal, under 400 pounds");
assert.equal(mixed.headcount, 80);
assert.equal(mixed.by, "12:30");
assert.deepEqual(mixed.dietaryCounts, { veg: 10, halal: 4 });
assert.equal(mixed.budget, 400);

assert.equal(parseFoodRequest("by 12am").by, "00:00");
assert.equal(parseFoodRequest("by 12pm").by, "12:00");
assert.equal(parseFoodRequest("£1,250.50 total").budget, 1250.5);
assert.equal(parseFoodRequest("for 20 vegans").headcount, undefined, "a dietary count isn't the headcount");
assert.equal(looksLikePlanRequest(parseFoodRequest("hello there")), false);
assert.equal(parseFoodRequest("Plan tomorrow's breakfast").by, "08:30");
assert.equal(parseFoodRequest("dinner by 7pm").by, "19:00", "an explicit time beats the usual one");
assert.deepEqual(parseFoodRequest("Who does vegan and halal?").mentions, ["vegan", "halal"]);
assert.equal(looksLikePlanRequest(parseFoodRequest("feed 40")), true);

// Request → planner input. The demo clock is Saturday 17:05.
assert.equal(nextAt("19:00", OXHACK_NOW).toISOString(), "2026-11-14T19:00:00.000Z", "later today");
assert.equal(nextAt("12:30", OXHACK_NOW).toISOString(), "2026-11-15T12:30:00.000Z", "already passed, so tomorrow");

const one = plannerInputFor(parseFoodRequest("feed 150, 20 vegan, by 7pm under £600"), OXHACK_EVENT, OXHACK_NOW);
assert.equal(one.budget, 600);
assert.equal(one.headcount, 150);
assert.deepEqual(one.dietaryCounts, { vegan: 20 });
assert.equal(one.slots?.length, 1);
assert.equal(one.slots![0].kind, "dinner");
assert.equal(one.slots![0].servesAt, "2026-11-14T19:00:00Z");

const all = plannerInputFor(parseFoodRequest("plan the whole weekend for 150 people, £5,000"), OXHACK_EVENT, OXHACK_NOW);
assert.equal(all.slots, undefined, "whole event generates slots from the dates");
assert.equal(all.budget, 5000);
assert.deepEqual(all.dietaryMix, OXHACK_EVENT.dietaryMix);

// £600 for 150 is £4 a head: one meal, served at the default dinner time.
const cheap = plannerInputFor(parseFoodRequest("feed 150 under £600"), OXHACK_EVENT, OXHACK_NOW);
assert.equal(cheap.slots?.[0].servesAt, "2026-11-14T18:30:00Z");

console.log("test-food-request: ok");
