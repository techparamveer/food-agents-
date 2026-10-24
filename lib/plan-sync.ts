import { londonDay } from "@/lib/london-time";
import { proposeSlots, type MealPlan, type PlannerInput } from "@/lib/planner";
import type { EventData, MealSlot, Order, OrderStatus } from "@/lib/types";

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
    same day. Slots with placed orders always stay, even outside new dates. */
export function reconcileSlots(proposed: MealSlot[], existing: MealSlot[], keep: (slot: MealSlot) => boolean = () => false): MealSlot[] {
  const used = new Set<string>();
  const out = proposed.map((p) => {
    const match = existing.find((e) => !used.has(e.id) && e.kind === p.kind && londonDay(e.servesAt) === londonDay(p.servesAt));
    if (!match) return p;
    used.add(match.id);
    return { ...p, id: match.id, label: match.label, servesAt: match.servesAt, allowance: match.allowance };
  });
  for (const e of existing) if (!used.has(e.id) && keep(e)) out.push({ ...e, headcount: proposed[0]?.headcount ?? e.headcount });
  return out.sort((a, b) => a.servesAt.localeCompare(b.servesAt) || a.id.localeCompare(b.id));
}

/** Planner input for the form, on top of what's already been ordered. */
export function plannerInput(data: Pick<EventData, "event" | "slots" | "orders">, form: PlannerForm): PlannerInput {
  const placed = data.orders.filter((o) => isPlaced(o.status));
  const proposed = proposeSlots({ eventId: data.event.id, ...form });
  const slots = reconcileSlots(proposed, data.slots, (s) => placed.some((o) => o.slotId === s.id));
  return {
    eventId: data.event.id,
    ...form,
    slots,
    fixed: Object.fromEntries(placed.filter((o) => slots.some((s) => s.id === o.slotId)).map((o) => [o.slotId, o.restaurantId])),
  };
}

const est = (value: number) => ({ value, source: { label: "Comeda planner" }, isEstimate: true });

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
  const { headcount, budget, startsAt, endsAt, dietaryMix } = plan.input;
  return {
    ...data,
    event: { ...data.event, headcount, budget, startsAt, endsAt, dietaryMix },
    slots: plan.slots.map((s) => s.slot),
    orders,
    plan: {
      eventId: data.event.id,
      generatedAt: at,
      source: "planner",
      slots: plan.slots.map((s) => ({ slotId: s.slot.id, restaurantId: s.restaurantId, status: s.status, reason: s.reason })),
      total: est(plan.total),
    },
  };
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
