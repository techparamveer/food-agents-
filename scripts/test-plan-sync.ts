import assert from "node:assert/strict";
import { applyPlan, budgetSummary, formFromEvent, plannerInput } from "@/lib/plan-sync";
import { planMeals } from "@/lib/planner";
import { OXHACK } from "@/lib/seed/oxhack";

/* "Get it done" on the seeded event keeps slot ids, keeps placed orders, and gives every slot an order. */

const form = formFromEvent(OXHACK);
assert.deepEqual(form, { headcount: 150, budget: 5000, startsAt: OXHACK.event.startsAt, endsAt: OXHACK.event.endsAt, dietaryMix: OXHACK.event.dietaryMix });

const input = plannerInput(OXHACK, form);
assert.deepEqual(input.slots!.map((s) => s.id), OXHACK.slots.map((s) => s.id), "seeded slot ids survive, so meal logs still match");
const lunchOrder = OXHACK.orders.find((o) => o.slotId === "sat-lunch")!;
assert.deepEqual(Object.keys(input.fixed!), ["sat-lunch"], "lunch has arrived, so it's fixed");
assert.deepEqual(input.fixed!["sat-lunch"], {
  restaurantId: "gloucester-green-falafel",
  restaurantName: OXHACK.restaurants.find((r) => r.id === "gloucester-green-falafel")!.name,
  total: lunchOrder.total.value,
  lines: lunchOrder.lines,
  orderBy: lunchOrder.orderBy,
  platform: lunchOrder.platform,
}, "the fixed slot carries the real order");

const plan = planMeals(input, OXHACK.restaurants);
const next = applyPlan(OXHACK, plan, OXHACK.now);
assert.equal(next.orders.length, 5, "one bulk order per slot");
assert.deepEqual(next.orders.find((o) => o.slotId === "sat-lunch"), OXHACK.orders.find((o) => o.slotId === "sat-lunch"), "placed order untouched");
assert.ok(next.orders.filter((o) => o.slotId !== "sat-lunch").every((o) => o.status === "planned"));
assert.equal(next.orders.find((o) => o.slotId === "sat-dinner")!.id, "ord-sat-dinner", "existing order ids are reused");
assert.equal(next.plan.source, "planner");
assert.equal(next.plan.total.value, plan.total);
assert.equal(next.mealLogs, OXHACK.mealLogs);

// Approve rewrites no orders; a swap rewrites only its own slot.
const edited = { ...next, orders: next.orders.map((o) => (o.slotId === "sun-lunch" ? { ...o, lines: [{ dietary: "standard" as const, quantity: 1 }] } : o)) };
const afterApprove = applyPlan(edited, plan, OXHACK.now, []);
assert.deepEqual(afterApprove.orders, edited.orders, "approve keeps edits");
const afterSwap = applyPlan(edited, { ...plan, slots: plan.slots.map((s) => (s.slot.id === "sat-dinner" ? { ...s, restaurantId: "jericho-bagels" } : s)) }, OXHACK.now, ["sat-dinner"]);
assert.equal(afterSwap.orders.find((o) => o.slotId === "sat-dinner")!.restaurantId, "jericho-bagels");
assert.deepEqual(afterSwap.orders.find((o) => o.slotId === "sun-lunch"), edited.orders.find((o) => o.slotId === "sun-lunch"));

const money = budgetSummary(next);
assert.equal(money.spent, OXHACK.orders.find((o) => o.slotId === "sat-lunch")!.total.value);
assert.equal(money.planned, plan.total);
assert.ok(money.left >= 0);

// New dates drop meals outside them, but never a slot that's already been ordered.
const shorter = plannerInput(OXHACK, { ...form, startsAt: "2026-11-14T16:00:00Z" });
assert.ok(shorter.slots!.some((s) => s.id === "sat-lunch"), "ordered lunch stays");
assert.deepEqual(shorter.slots!.map((s) => s.id), ["sat-lunch", "sat-dinner", "sat-midnight", "sun-breakfast", "sun-lunch"]);
const oneDay = plannerInput({ ...OXHACK, orders: [] }, { ...form, endsAt: "2026-11-14T20:00:00Z" });
assert.deepEqual(oneDay.slots!.map((s) => s.id), ["sat-lunch", "sat-dinner"]);

console.log("test-plan-sync: ok");
