import assert from "node:assert/strict";
import { approveSlot, costSlot, planMeals, proposeSlots, swapRestaurant, type PlannerInput } from "@/lib/planner";
import { OXHACK_EVENT, OXHACK_RESTAURANTS } from "@/lib/seed/oxhack";
import type { Dietary, Restaurant } from "@/lib/types";

/* Budget fitting and picking: deterministic, under budget, varied, cheapest where it can be. */

const est = (value: number) => ({ value, source: { label: "Test" }, isEstimate: true });
function place(id: string, perHead: number, cuisine: string, serves: Dietary[] = ["veg", "vegan", "halal", "gf"], fee = 10, rating = 4.5): Restaurant {
  return {
    id,
    name: id,
    cuisine,
    address: "Oxford",
    lat: 51.75,
    lon: -1.25,
    distanceKm: 1,
    rating,
    serves,
    costPerHead: est(perHead),
    prepMinutes: est(20),
    travelMinutes: est(15),
    delivery: [{ platform: "direct", url: `https://example.com/${id}`, fee: est(fee), eta: est(35) }],
    color: "#000",
    monogram: id[0].toUpperCase(),
  };
}

const OX: PlannerInput = {
  eventId: OXHACK_EVENT.id,
  headcount: 150,
  budget: 5000,
  startsAt: OXHACK_EVENT.startsAt,
  endsAt: OXHACK_EVENT.endsAt,
  dietaryMix: OXHACK_EVENT.dietaryMix,
};

// 1. The demo defaults: 150 people, £5,000, the OxHack weekend, seeded restaurants.
const plan = planMeals(OX, OXHACK_RESTAURANTS);
assert.equal(plan.slots.length, 5);
assert.ok(plan.fits && plan.total <= 5000, `fits £5,000, got £${plan.total}`);
assert.equal(plan.remaining, Math.round((5000 - plan.total) * 100) / 100);
assert.equal(plan.total, Math.round(plan.slots.reduce((n, s) => n + s.cost, 0) * 100) / 100, "total is the sum of slots");
assert.deepEqual(planMeals(OX, OXHACK_RESTAURANTS), plan, "same input, same plan");
assert.deepEqual(planMeals(OX, [...OXHACK_RESTAURANTS].reverse()), plan, "restaurant order doesn't matter");
for (const s of plan.slots) {
  assert.equal(s.lines.reduce((n, l) => n + l.quantity, 0), 150, `${s.slot.label} feeds everyone`);
  assert.ok(s.reason.length > 0, `${s.slot.label} explains its pick`);
  assert.ok(s.orderBy < s.slot.servesAt, `${s.slot.label} orders before serving`);
  assert.equal(s.status, "proposed");
}
// Variety: no restaurant twice in a row while there are five to choose from.
plan.slots.slice(1).forEach((s, i) => assert.notEqual(s.restaurantId, plan.slots[i].restaurantId, `${s.slot.label} repeats the previous meal`));
// Breakfast goes to the bakery.
assert.equal(plan.slots.find((s) => s.slot.kind === "breakfast")!.restaurantId, "jericho-bagels");
console.log(plan.slots.map((s) => `${s.slot.label}: ${s.restaurantId} £${s.cost}`).join("\n"), `\ntotal £${plan.total}`);

// 2. Cheaper wins when everything else is equal.
const cheapFirst = planMeals(
  { ...OX, slots: proposeSlots(OX).slice(0, 1) },
  [place("dear", 9, "Thai"), place("cheap", 5, "Pizza"), place("mid", 7, "Indian")],
);
assert.equal(cheapFirst.slots[0].restaurantId, "cheap");
assert.match(cheapFirst.slots[0].reason, /Cheapest option covering every dietary need/);

// 3. Variety: a cheap place doesn't take every meal while the budget allows a change.
const varied = planMeals(OX, [place("cheap", 5, "Pizza"), place("other", 5.5, "Thai"), place("third", 6, "Indian")]);
assert.ok(new Set(varied.slots.map((s) => s.restaurantId)).size >= 3, "uses all three places");
const pricier = varied.slots.find((s) => s.restaurantId !== "cheap" && s.slot.kind === "lunch");
if (pricier) assert.match(pricier.reason, /cheaper|varied|already/);

// 4. Budget fitting: a tight budget forces the cheaper options even if they repeat.
const tightInput = { ...OX, budget: 3200 };
const options = [place("cheap", 5, "Pizza"), place("lux", 9, "Sushi"), place("nice", 8, "Thai")];
const roomy = planMeals({ ...OX, budget: 50_000 }, options);
const tight = planMeals(tightInput, options);
assert.ok(roomy.total > tight.total, "a tight budget costs less");
assert.ok(tight.fits && tight.total <= 3200, `fits £3,200, got £${tight.total}`);

// 5. Impossible budget: cheapest everywhere, flagged, never a crash.
const broke = planMeals({ ...OX, budget: 500 }, options);
assert.equal(broke.fits, false);
assert.ok(broke.slots.every((s) => s.restaurantId === "cheap"), "falls back to the cheapest everywhere");
assert.match(broke.notes[0], /Over budget by £/);

// 6. Dietary coverage beats a small saving; a menu gap is called out.
const gap = planMeals(
  { ...OX, slots: proposeSlots(OX).slice(1, 2) },
  [place("nohalal", 5, "Pizza", ["veg", "vegan", "gf"]), place("all", 5.5, "Indian")],
);
assert.equal(gap.slots[0].restaurantId, "all");
assert.equal(gap.slots[0].alternatives[0].note, "no halal");
const only = planMeals({ ...OX, slots: proposeSlots(OX).slice(1, 2) }, [place("nohalal", 5, "Pizza", ["veg", "vegan", "gf"])]);
assert.deepEqual(only.slots[0].missing, ["halal"]);
assert.match(only.slots[0].reason, /doesn't list halal/);
assert.ok(only.notes.some((n) => /can't cover every dietary need/.test(n)));

// 7. Portions: breakfast and the midnight snack cost less than a full meal.
const [lunch, , snack, breakfast] = proposeSlots(OX);
const p = place("x", 10, "Cafe", undefined, 0);
assert.equal(costSlot(lunch, p).food, 1500);
assert.equal(costSlot(snack, p).food, 750);
assert.equal(costSlot(breakfast, p).food, 900);
assert.equal(costSlot(lunch, p).orderBy, "2026-11-14T11:55:00Z", "12:30 lunch − 20 prep − 15 travel");

// 8. Swap and approve keep the maths honest.
const target = plan.slots[1];
const alt = target.alternatives[0];
const swapped = swapRestaurant(plan, target.slot.id, alt.restaurantId, OXHACK_RESTAURANTS);
assert.equal(swapped.slots[1].restaurantId, alt.restaurantId);
assert.equal(swapped.slots[1].status, "swapped");
assert.equal(swapped.slots[1].cost, alt.cost);
assert.equal(Math.round((swapped.total - plan.total) * 100) / 100, alt.delta);
assert.deepEqual(swapped.slots[0], plan.slots[0], "other slots untouched");
assert.equal(swapRestaurant(plan, "nope", alt.restaurantId, OXHACK_RESTAURANTS), plan);
const approved = approveSlot(plan, plan.slots[0].slot.id);
assert.deepEqual(approved.slots.map((s) => s.status), ["approved", "proposed", "proposed", "proposed", "proposed"]);
assert.ok(approveSlot(plan).slots.every((s) => s.status === "approved"));

// 9. Chat-shaped request: one dinner, 20 vegan, under £600.
const dinner = planMeals(
  { ...OX, budget: 600, dietaryCounts: { vegan: 20 }, slots: [{ ...proposeSlots(OX)[1], headcount: 80 }] },
  OXHACK_RESTAURANTS,
);
assert.ok(dinner.fits, `80 dinners under £600, got £${dinner.total}`);
assert.equal(dinner.slots[0].lines.find((l) => l.dietary === "vegan")!.quantity, 20);

// Budget forces a menu gap: the reason names the restaurant that would have covered it.
const squeeze = planMeals({ ...OX, budget: 700, slots: [proposeSlots(OX)[1]] }, OXHACK_RESTAURANTS);
assert.equal(squeeze.slots[0].restaurantId, "jericho-bagels");
assert.match(squeeze.slots[0].reason, /^Cowley Road Curry House covers every dietary need but costs £\d+ more; Jericho Bagel Bakery keeps the total down\./);
assert.match(squeeze.slots[0].reason, /doesn't list halal, gluten-free/);

assert.deepEqual(planMeals(OX, []).slots, [], "no restaurants, no plan");

// 10. Ordered slots are fixed: kept, counted in the budget, and never swapped.
const lunchId = proposeSlots(OX)[0].id;
const locked = planMeals({ ...OX, fixed: { [lunchId]: "gloucester-green-falafel" } }, OXHACK_RESTAURANTS);
assert.equal(locked.slots[0].restaurantId, "gloucester-green-falafel");
assert.equal(locked.slots[0].locked, true);
assert.equal(locked.slots[0].status, "approved");
assert.match(locked.slots[0].reason, /Already ordered/);
assert.ok(locked.fits);
assert.equal(swapRestaurant(locked, lunchId, "jericho-bagels", OXHACK_RESTAURANTS), locked, "locked slots don't swap");
const squeezed = planMeals({ ...OX, budget: 4000, fixed: { [lunchId]: "high-street-noodles" } }, OXHACK_RESTAURANTS);
assert.equal(squeezed.slots[0].restaurantId, "high-street-noodles", "budget repair leaves fixed slots alone");

console.log("test-planner: ok");
