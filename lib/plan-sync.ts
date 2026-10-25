import { londonDay } from "@/lib/london-time";
import { costOrder, proposeSlots, splitDietary, type FixedOrder, type MealPlan, type PlannerInput } from "@/lib/planner";
import type { EventData, MealKind, MealSlot, Order, OrderStatus, Restaurant } from "@/lib/types";

/* Between the planner and the dashboard's event data. The planner works on plain inputs;
   these helpers keep slot ids stable (meal check logs point at them) and leave placed orders alone. */

/** An order the organiser has placed. The planner never moves it. */
export const isPlaced = (status: OrderStatus) => status !== "planned";

/** What the organiser fills in on "Get it done". */
export type PlannerForm = Pick<PlannerInput, "headcount" | "budget" | "startsAt" | "endsAt" | "dietaryMix">;

export function formFromEvent(data: Pick<EventData, "event">): PlannerForm {
  const { headcount, budget, startsAt, endsAt, dietaryMix } = data.event;
  return { headcount, budget, startsAt, endsAt, dietaryMix: { ...dietaryMix } };
}

/** Proposed slots, reusing an existing slot's id, label and time when it's the same meal on the
    same day. Slots with placed orders always stay, even outside new dates, and keep the headcount
    they were ordered for. */
export function reconcileSlots(proposed: MealSlot[], existing: MealSlot[], keep: (slot: MealSlot) => boolean = () => false): MealSlot[] {
  const used = new Set<string>();
  const out = proposed.map((p) => {
    const match = existing.find((e) => !used.has(e.id) && e.kind === p.kind && londonDay(e.servesAt) === londonDay(p.servesAt));
    if (!match) return p;
    used.add(match.id);
    return { ...p, id: match.id, label: match.label, servesAt: match.servesAt, allowance: match.allowance, headcount: keep(match) ? match.headcount : p.headcount };
  });
  for (const e of existing) if (!used.has(e.id) && keep(e)) out.push(e);
  return out.sort((a, b) => a.servesAt.localeCompare(b.servesAt) || a.id.localeCompare(b.id));
}

/** A placed order as the planner sees it: its own restaurant, lines and real total. */
export function fixedOrder(order: Order, restaurants: Pick<EventData, "restaurants">["restaurants"] = []): FixedOrder {
  return {
    restaurantId: order.restaurantId,
    restaurantName: restaurants.find((r) => r.id === order.restaurantId)?.name,
    total: order.total.value,
    lines: order.lines,
    orderBy: order.orderBy,
    platform: order.platform,
  };
}

/** Planner input for the form, on top of what's already been ordered. */
export function plannerInput(
  data: Pick<EventData, "event" | "slots" | "orders"> & Partial<Pick<EventData, "restaurants">>,
  form: PlannerForm,
  openAt?: PlannerInput["openAt"],
): PlannerInput {
  const placed = data.orders.filter((o) => isPlaced(o.status));
  const proposed = proposeSlots({ eventId: data.event.id, ...form });
  const slots = reconcileSlots(proposed, data.slots, (s) => placed.some((o) => o.slotId === s.id));
  return {
    eventId: data.event.id,
    ...form,
    slots,
    fixed: Object.fromEntries(placed.filter((o) => slots.some((s) => s.id === o.slotId)).map((o) => [o.slotId, fixedOrder(o, data.restaurants)])),
    ...(openAt ? { openAt } : {}),
  };
}

const est = (value: number) => ({ value, source: { label: "Comeda planner" }, isEstimate: true });

export type ManualOrderInput = {
  label: string;
  kind: MealKind;
  servesAt: string;
  headcount: number;
  restaurantId: string;
};

/** Adds an organiser-created meal and planned order without running the planner. */
export function addManualOrder(data: EventData, input: ManualOrderInput, key: string): EventData {
  const restaurant = data.restaurants.find((r) => r.id === input.restaurantId);
  if (!restaurant) return data;
  const slotId = `slot-manual-${key}`;
  const orderId = `ord-manual-${key}`;
  const slot: MealSlot = {
    id: slotId,
    eventId: data.event.id,
    label: input.label.trim(),
    kind: input.kind,
    servesAt: input.servesAt,
    headcount: input.headcount,
    allowance: 1,
  };
  const lines = splitDietary(input.headcount, data.event.dietaryMix);
  const priced = costOrder(slot, restaurant, input.headcount);
  const order: Order = {
    id: orderId,
    slotId,
    restaurantId: restaurant.id,
    platform: priced.delivery?.platform ?? "direct",
    status: "planned",
    lines,
    orderBy: priced.orderBy,
    total: { value: priced.cost, source: { label: "Comeda estimate" }, isEstimate: true },
  };
  const orders = [...data.orders, order];
  return {
    ...data,
    slots: [...data.slots, slot].sort((a, b) => a.servesAt.localeCompare(b.servesAt) || a.id.localeCompare(b.id)),
    orders,
    plan: {
      ...data.plan,
      slots: [...data.plan.slots, { slotId, restaurantId: restaurant.id, status: "approved", reason: "Added manually by the organiser." }],
      total: { ...data.plan.total, value: orders.reduce((sum, item) => sum + item.total.value, 0) },
    },
  };
}

/** Writes a plan into the event: slots, the plan itself, and one bulk order per slot.
    Placed orders are kept as they are; everything else becomes a planned order. With `only`,
    just those slots' orders are rewritten, so edits to the others survive an approve or a swap. */
export function applyPlan(data: EventData, plan: MealPlan, at: string, only?: string[]): EventData {
  const orders: Order[] = plan.slots.map((s) => {
    const existing = data.orders.find((o) => o.slotId === s.slot.id);
    if (existing && (isPlaced(existing.status) || (only && !only.includes(s.slot.id)))) return existing;
    return {
      id: existing?.id ?? `ord-${s.slot.id}`,
      slotId: s.slot.id,
      restaurantId: s.restaurantId,
      platform: s.delivery?.platform ?? "direct",
      status: "planned",
      lines: s.lines,
      orderBy: s.orderBy,
      total: est(s.cost),
    };
  });
  // A placed order is never dropped, even by a plan that somehow left its slot out.
  const stray = data.orders.filter((o) => isPlaced(o.status) && !plan.slots.some((s) => s.slot.id === o.slotId));
  const straySlots = data.slots.filter((s) => stray.some((o) => o.slotId === s.id));
  const { headcount, budget, startsAt, endsAt, dietaryMix } = plan.input;
  return {
    ...data,
    event: { ...data.event, headcount, budget, startsAt, endsAt, dietaryMix },
    slots: [...plan.slots.map((s) => s.slot), ...straySlots].sort((a, b) => a.servesAt.localeCompare(b.servesAt) || a.id.localeCompare(b.id)),
    orders: [...orders, ...stray],
    plan: {
      eventId: data.event.id,
      generatedAt: at,
      source: "planner",
      slots: plan.slots.map((s) => ({ slotId: s.slot.id, restaurantId: s.restaurantId, status: s.status, reason: s.reason })),
      total: est(plan.total),
    },
  };
}

/** Adds searched restaurants to the event so every view can resolve them by id. Existing ones are refreshed, none dropped
    (placed orders may point at restaurants a later search didn't return). */
export function mergeRestaurants(data: EventData, found: Restaurant[]): EventData {
  if (!found.length) return data;
  const fresh = new Map(found.map((r) => [r.id, r]));
  return { ...data, restaurants: [...data.restaurants.filter((r) => !fresh.has(r.id)), ...fresh.values()] };
}

/** Spent = placed orders; planned = everything in the plan. */
export function budgetSummary(data: Pick<EventData, "event" | "orders">) {
  const spent = data.orders.filter((o) => isPlaced(o.status)).reduce((n, o) => n + o.total.value, 0);
  const planned = data.orders.reduce((n, o) => n + o.total.value, 0);
  const budget = data.event.budget;
  return {
    spent: Math.round(spent * 100) / 100,
    planned: Math.round(planned * 100) / 100,
    budget,
    left: Math.round((budget - planned) * 100) / 100,
    spentShare: budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0,
    plannedShare: budget > 0 ? Math.min(100, Math.round((planned / budget) * 100)) : 0,
  };
}
