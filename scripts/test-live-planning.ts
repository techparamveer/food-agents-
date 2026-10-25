import assert from "node:assert/strict";
import { applyPlan, budgetSummary, formFromEvent, plannerInput } from "@/lib/plan-sync";
import { planMeals, swapRestaurant } from "@/lib/planner";
import { openAtSlots, searchForSlots } from "@/lib/restaurant-search";
import { fallbackResult, normaliseInput } from "@/lib/restaurants/find-core";
import { OXHACK, OXHACK_EVENT } from "@/lib/seed/oxhack";

/* Planning on live search results: restaurants the seeded event has never seen, opening hours per
   slot, and placed orders that must survive whatever the search returns. */

async function main() {
  // Stand-in for a live search: the Oxford seed with real-shaped ids and opening hours.
  const live = fallbackResult(normaliseInput({ slotTime: "2026-11-14T18:30:00Z", headcount: 150, openAtSlot: false }), []).restaurants;
  const form = formFromEvent(OXHACK);
  const lunch = OXHACK.orders.find((o) => o.slotId === "sat-lunch")!;
  assert.ok(!live.some((r) => r.id === lunch.restaurantId), "the placed order's restaurant isn't in the live results");

  /* ---------- placed orders stay locked ---------- */

  const slots = plannerInput(OXHACK, form).slots!;
  const openAt = openAtSlots(live, slots);
  const plan = planMeals(plannerInput(OXHACK, form, openAt), live);
  const locked = plan.slots.find((s) => s.slot.id === "sat-lunch")!;
  assert.equal(locked.locked, true, "still locked though the search didn't return its restaurant");
  assert.equal(locked.restaurantId, lunch.restaurantId);
  assert.equal(locked.status, "approved");
  assert.deepEqual(locked.lines, lunch.lines, "the order's own quantities");
  assert.equal(locked.orderBy, lunch.orderBy);
  assert.match(locked.reason, /^Already ordered from Gloucester Green Falafel/);
  assert.ok(plan.slots.filter((s) => s.slot.id !== "sat-lunch").every((s) => live.some((r) => r.id === s.restaurantId)), "the rest come from the live list");

  // Swapping a locked slot does nothing; swapping another works even with the locked restaurant missing from the list.
  assert.equal(swapRestaurant(plan, "sat-lunch", live[0].id, live), plan);
  const dinner = plan.slots.find((s) => s.slot.id === "sat-dinner")!;
  const swapped = swapRestaurant(plan, "sat-dinner", dinner.alternatives[0].restaurantId, live);
  assert.equal(swapped.slots.find((s) => s.slot.id === "sat-dinner")!.status, "swapped");

  /* ---------- real totals: the plan matches the Overview ---------- */

  assert.equal(locked.cost, lunch.total.value, "the placed order counts at its real total");
  const applied = applyPlan(OXHACK, plan, OXHACK.now);
  assert.deepEqual(applied.orders.find((o) => o.slotId === "sat-lunch"), lunch, "applyPlan keeps the real order");
  assert.equal(budgetSummary(applied).planned, plan.total, "plan total = Overview's planned total");

  // A bigger headcount re-plans the open meals but not the one already ordered.
  const bigger = planMeals(plannerInput(OXHACK, { ...form, headcount: 200 }, openAt), live);
  const biggerLunch = bigger.slots.find((s) => s.slot.id === "sat-lunch")!;
  assert.equal(biggerLunch.cost, lunch.total.value, "no re-pricing at the new headcount");
  assert.equal(biggerLunch.slot.headcount, 150, "the ordered slot keeps the headcount it was ordered for");
  assert.ok(bigger.slots.filter((s) => !s.locked).every((s) => s.slot.headcount === 200));
  assert.equal(budgetSummary(applyPlan(OXHACK, bigger, OXHACK.now)).planned, bigger.total);

  // Budget repair can't touch the locked slot: squeezing still leaves it at its real total.
  const squeezed = planMeals(plannerInput(OXHACK, { ...form, budget: 1 }, openAt), live);
  assert.equal(squeezed.slots.find((s) => s.slot.id === "sat-lunch")!.cost, lunch.total.value);
  assert.equal(squeezed.fits, false);

  /* ---------- opening hours per slot ---------- */

  for (const s of plan.slots.filter((x) => !x.locked)) {
    const open = openAt[s.slot.id];
    if (open.length) assert.ok(open.includes(s.restaurantId), `${s.slot.label}: ${s.restaurantId} is open`);
  }
  // Zheng opens 17:30, so it can't do Sunday breakfast or lunch.
  const zheng = live.find((r) => r.name === "Zheng")!;
  assert.ok(openAt["sat-dinner"].includes(zheng.id));
  assert.ok(!openAt["sun-breakfast"].includes(zheng.id) && !openAt["sun-lunch"].includes(zheng.id));
  // Nothing in the seed is open at midnight: the planner still picks, and says to order ahead.
  assert.deepEqual(openAt["sat-midnight"], []);
  assert.match(plan.slots.find((s) => s.slot.id === "sat-midnight")!.reason, /Nothing nearby is listed as open at 00:00/);
  // A restaurant without hours (the dashboard seed) counts as open.
  assert.deepEqual(openAtSlots(OXHACK.restaurants.slice(0, 1), slots.slice(0, 1)), { [slots[0].id]: [OXHACK.restaurants[0].id] });

  /* ---------- headcount 0 or junk ---------- */

  const OX = { headcount: 150, budget: 5000, startsAt: OXHACK_EVENT.startsAt, endsAt: OXHACK_EVENT.endsAt, dietaryMix: OXHACK_EVENT.dietaryMix };
  for (const headcount of [0, -5, Number.NaN, "lots" as unknown as number]) {
    const p = planMeals({ ...OX, headcount }, live);
    assert.equal(p.slots.length, 0, `headcount ${String(headcount)} plans nothing`);
    assert.equal(p.total, 0);
    assert.deepEqual(p.notes, ["Add how many people you're feeding to plan meals."]);
  }
  const zeroSlots = plannerInput(OXHACK, { ...form, headcount: 0 });
  const zero = planMeals(zeroSlots, live);
  assert.deepEqual(zero.slots.map((s) => s.slot.id), ["sat-lunch"], "headcount 0 still keeps the placed order");
  assert.equal(zero.total, lunch.total.value);
  for (const p of [zero, planMeals({ ...OX, budget: Number.NaN }, live), planMeals({ ...OX, headcount: 1, budget: 0 }, live)]) {
    const text = p.notes.join(" ");
    assert.ok(!/NaN|Infinity/.test(text) && Number.isFinite(p.total) && Number.isFinite(p.remaining), text);
    assert.ok(!/£\d{2,} a head/.test(text), `no runaway per-head figure: ${text}`);
  }

  /* ---------- applyPlan never drops a placed order ---------- */

  const partial = applyPlan(OXHACK, { ...plan, slots: plan.slots.filter((s) => s.slot.id !== "sat-lunch") }, OXHACK.now);
  assert.deepEqual(partial.orders.find((o) => o.slotId === "sat-lunch"), lunch);
  assert.ok(partial.slots.some((s) => s.id === "sat-lunch"));

  /* ---------- search fallback is labelled ---------- */

  const q = { venue: OXHACK_EVENT.venue, headcount: 150 };
  const seeded = await searchForSlots(q, slots);
  assert.equal(seeded.source, "fallback", "the default (seeded) search says it's seeded");
  assert.deepEqual(seeded.warnings, []);
  const failed = await searchForSlots(q, slots, async () => {
    throw new Error("HTTP 429");
  });
  assert.equal(failed.source, "fallback");
  assert.equal(failed.restaurants.length, OXHACK.restaurants.length);
  assert.match(failed.warnings[0], /seeded restaurants/);
  assert.ok(!failed.warnings.join(" ").includes("429"), "no upstream detail in what users see");
  const empty = await searchForSlots(q, slots, async () => ({ restaurants: [] }));
  assert.equal(empty.source, "fallback");
  const ok = await searchForSlots(q, slots, async (query) => {
    assert.equal(query.openAtSlot, false, "one unfiltered search; hours are checked per slot");
    assert.equal(query.slotTime, slots[0].servesAt);
    return { restaurants: live, source: "live", grounded: 4, warnings: [] };
  });
  assert.deepEqual([ok.source, ok.grounded, ok.count], ["live", 4, live.length]);
  assert.deepEqual(ok.openAt, openAt);

  console.log("test-live-planning: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
