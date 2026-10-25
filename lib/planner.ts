import { orderBy } from "@/lib/countdown";
import type { SearchInfo } from "@/lib/restaurant-search";
import { iso, londonClock, londonDay, londonInstant, nextDay } from "@/lib/london-time";
import {
  DIETARY,
  type DeliveryOption,
  type DeliveryPlatform,
  type Dietary,
  type DietaryMix,
  type MealKind,
  type MealSlot,
  type OrderLine,
  type PlanStatus,
  type Restaurant,
} from "@/lib/types";

/* "Get it done": propose meal slots from the event dates, pick a restaurant per slot, split the
   quantities by dietary need and keep the total under budget. Pure and deterministic: the same
   input always gives the same plan. Gemini may narrate a plan; it never changes the numbers. */

export type PlannerInput = {
  eventId?: string;
  headcount: number;
  /** Total food budget in pounds. */
  budget: number;
  startsAt: string;
  endsAt: string;
  dietaryMix: DietaryMix;
  /** Head counts that override the mix, e.g. "20 vegan". */
  dietaryCounts?: Partial<Record<Dietary, number>>;
  /** Plan exactly these slots instead of generating them from the dates. */
  slots?: MealSlot[];
  /** Slots already ordered: slot id → restaurant id, or the order itself. Always kept locked, even
      when the restaurant isn't in this search's results, and counted at the order's real total. */
  fixed?: Record<string, string | FixedOrder>;
  /** Restaurants open for each slot: slot id → restaurant ids. Slots not listed may use any restaurant;
      when none of a slot's restaurants is open the planner uses them all and says so. */
  openAt?: Record<string, string[]>;
};

/** A placed order as the planner needs it. Missing fields are costed from the restaurant. */
export type FixedOrder = {
  restaurantId: string;
  /** Shown when the restaurant isn't in the search results. */
  restaurantName?: string;
  /** What the order really costs, in pounds. */
  total?: number;
  lines?: OrderLine[];
  orderBy?: string;
  platform?: DeliveryPlatform;
};

export type Alternative = {
  restaurantId: string;
  name: string;
  cost: number;
  /** Cost against the current pick: negative is cheaper. */
  delta: number;
  note?: string;
};

export type SlotPlan = {
  slot: MealSlot;
  restaurantId: string;
  delivery?: DeliveryOption;
  lines: OrderLine[];
  food: number;
  fee: number;
  cost: number;
  orderBy: string;
  status: PlanStatus;
  /** Already ordered: the planner won't move it. */
  locked: boolean;
  /** Needs this restaurant's menu doesn't list. */
  missing: Dietary[];
  reason: string;
  alternatives: Alternative[];
};

export type MealPlan = {
  input: PlannerInput;
  slots: SlotPlan[];
  total: number;
  budget: number;
  remaining: number;
  fits: boolean;
  /** Plan-wide trade-offs, plain sentences. */
  notes: string[];
  /** Where the restaurants came from. Set by the caller that searched; the planner never fetches. */
  search?: SearchInfo;
};

/* ---------- Slots ---------- */

type MealTemplate = { kind: MealKind; label: string; hour: number; minute: number; portion: number };

/** When each meal lands, and how much of a full meal it costs. The midnight snack opens the day it falls on. */
export const MEALS: MealTemplate[] = [
  { kind: "snack", label: "midnight snack", hour: 0, minute: 0, portion: 0.5 },
  { kind: "breakfast", label: "breakfast", hour: 8, minute: 30, portion: 0.6 },
  { kind: "lunch", label: "lunch", hour: 12, minute: 30, portion: 1 },
  { kind: "dinner", label: "dinner", hour: 18, minute: 30, portion: 1 },
];

const PORTION: Record<MealKind, number> = Object.fromEntries(MEALS.map((m) => [m.kind, m.portion])) as Record<MealKind, number>;

/** A meal needs this long after doors open and before close to be worth serving. */
const AFTER_START_MIN = 60;
const BEFORE_END_MIN = 30;

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/London" });

/** Meal slots between `startsAt` and `endsAt`, in time order. */
export function proposeSlots(input: Pick<PlannerInput, "eventId" | "headcount" | "startsAt" | "endsAt">): MealSlot[] {
  const start = new Date(input.startsAt).getTime();
  const end = new Date(input.endsAt).getTime();
  if (!(end > start)) return [];
  const slots: MealSlot[] = [];
  const lastDay = londonDay(input.endsAt);
  for (let day = londonDay(input.startsAt); day <= lastDay; day = nextDay(day)) {
    for (const meal of MEALS) {
      const at = londonInstant(day, meal.hour, meal.minute);
      const t = at.getTime();
      if (t < start + AFTER_START_MIN * 60_000 || t > end - BEFORE_END_MIN * 60_000) continue;
      slots.push({
        id: `slot-${day}-${meal.kind}`,
        eventId: input.eventId ?? "event",
        // A midnight snack belongs to the night before: "Sat midnight snack" lands at 00:00 Sunday.
        label: `${weekday.format(meal.hour < 4 ? new Date(t - 6 * 3_600_000) : at)} ${meal.label}`,
        kind: meal.kind,
        servesAt: iso(at),
        headcount: input.headcount,
        allowance: 1,
      });
    }
  }
  return slots.sort((a, b) => a.servesAt.localeCompare(b.servesAt));
}

/* ---------- Dietary split ---------- */

/** Head counts per need for `headcount` people, standard last so the lines always add up.
    Each need rounds half up (better one spare vegan meal than one short); counts in `exact` win
    over the mix. If the needs add up to more than the headcount they shrink by largest remainder. */
export function splitDietary(headcount: number, mix: DietaryMix, exact: Partial<Record<Dietary, number>> = {}): OrderLine[] {
  const people = Math.max(0, Math.round(headcount));
  let counts = DIETARY.map((d) => {
    const raw = exact[d.id] !== undefined ? Math.max(0, exact[d.id]!) : people * Math.max(0, mix[d.id] ?? 0);
    return Math.round(raw + 1e-9);
  });
  const asked = counts.reduce((sum, n) => sum + n, 0);
  if (asked > people) {
    const raw = counts.map((n) => (n * people) / asked);
    counts = raw.map((r) => Math.floor(r + 1e-9));
    let short = people - counts.reduce((sum, n) => sum + n, 0);
    const order = raw.map((r, i) => ({ i, rem: r - counts[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (const { i } of order) {
      if (short-- <= 0) break;
      counts[i] += 1;
    }
  }
  const special = counts.reduce((sum, n) => sum + n, 0);
  return [
    ...DIETARY.map((d, i) => ({ dietary: d.id, quantity: counts[i] })),
    { dietary: "standard" as const, quantity: people - special },
  ];
}

/* ---------- Costing ---------- */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The cheapest way to get this restaurant's food to the venue; ties go to the faster, then by name. */
export function cheapestDelivery(r: Restaurant): DeliveryOption | undefined {
  return [...r.delivery].sort((a, b) => a.fee.value - b.fee.value || a.eta.value - b.eta.value || a.platform.localeCompare(b.platform))[0];
}

/** Order-to-door minutes for a restaurant: its cheapest delivery option's ETA (the one the planner
    picks), else prep + travel. Platform ETAs are the scraped figure when there is one. */
export function doorMinutes(r: Restaurant): number {
  return cheapestDelivery(r)?.eta.value ?? Math.round(r.prepMinutes.value) + r.travelMinutes.value;
}

/** Travel minutes for an option. Platform ETAs include prep, so take prep off. */
function travelMinutes(r: Restaurant, option?: DeliveryOption) {
  return option ? Math.max(0, option.eta.value - r.prepMinutes.value) : r.travelMinutes.value;
}

/** Cost and deadline for `meals` meals from `r`, delivered via `platform` (the cheapest when unset). */
export function costOrder(slot: MealSlot, r: Restaurant, meals: number, platform?: DeliveryOption["platform"]) {
  const delivery = r.delivery.find((d) => d.platform === platform) ?? cheapestDelivery(r);
  const food = round2(r.costPerHead.value * PORTION[slot.kind] * Math.max(0, meals));
  const fee = round2(delivery?.fee.value ?? 0);
  return { delivery, food, fee, cost: round2(food + fee), orderBy: orderBy(slot.servesAt, r.prepMinutes.value, travelMinutes(r, delivery)) };
}

export function costSlot(slot: MealSlot, r: Restaurant) {
  return costOrder(slot, r, slot.headcount);
}

/* ---------- Picking ---------- */

const BREAKFAST = /caf[eé]|bakery|bagel|breakfast|brunch|coffee|pastr|deli/i;

function needs(lines: OrderLine[]): Dietary[] {
  return lines.filter((l): l is OrderLine & { dietary: Dietary } => l.dietary !== "standard" && l.quantity > 0).map((l) => l.dietary);
}

function missingFor(r: Restaurant, wanted: Dietary[]) {
  return wanted.filter((d) => !r.serves.includes(d));
}

/** Restaurants open for a slot, or every restaurant when the slot has no list or nothing on it is open. */
function openFor(slot: MealSlot, restaurants: Restaurant[], openAt?: PlannerInput["openAt"]) {
  const listed = openAt?.[slot.id];
  if (!listed) return { open: restaurants, noneOpen: false };
  const open = restaurants.filter((r) => listed.includes(r.id));
  return open.length ? { open, noneOpen: false } : { open: restaurants, noneOpen: true };
}

/** Restaurants worth considering for a slot: open at the time, and for breakfast, cafés and bakeries when there are any. */
function candidatesFor(slot: MealSlot, restaurants: Restaurant[], openAt?: PlannerInput["openAt"]) {
  const { open } = openFor(slot, restaurants, openAt);
  if (slot.kind !== "breakfast") return open;
  const morning = open.filter((r) => BREAKFAST.test(r.cuisine) || BREAKFAST.test(r.name));
  return morning.length ? morning : open;
}

/** How much worse than its price a pick feels: repeats, gaps in the menu, low ratings. In pounds. */
function penalty(slot: MealSlot, r: Restaurant, cost: number, wanted: Dietary[], others: { slot: MealSlot; r: Restaurant }[]) {
  let p = 0;
  for (const o of others) {
    const hours = Math.abs(new Date(o.slot.servesAt).getTime() - new Date(slot.servesAt).getTime()) / 3_600_000;
    const near = hours <= 12 ? 1.5 : 1;
    if (o.r.id === r.id) p += 0.3 * cost * near;
    else if (o.r.cuisine.toLowerCase() === r.cuisine.toLowerCase()) p += 0.12 * cost * near;
  }
  p += missingFor(r, wanted).length * cost;
  p -= ((r.rating ?? 4) - 4) * 0.05 * cost;
  return p;
}

const byId = (a: Restaurant, b: Restaurant) => a.id.localeCompare(b.id);
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

function buildSlot(
  slot: MealSlot,
  r: Restaurant,
  lines: OrderLine[],
  restaurants: Restaurant[],
  others: { slot: MealSlot; r: Restaurant }[],
  status: PlanStatus,
  openAt?: PlannerInput["openAt"],
): SlotPlan {
  const c = costSlot(slot, r);
  const wanted = needs(lines);
  const missing = missingFor(r, wanted);
  const usedBy = (id: string) => others.filter((o) => o.r.id === id).map((o) => o.slot.label);

  const pool = candidatesFor(slot, restaurants, openAt)
    .map((x) => ({ r: x, cost: costSlot(slot, x).cost, missing: missingFor(x, wanted) }))
    .sort((a, b) => a.cost - b.cost || byId(a.r, b.r));
  const alternatives: Alternative[] = pool
    .filter((x) => x.r.id !== r.id)
    .slice(0, 3)
    .map((x) => {
      const used = usedBy(x.r.id);
      const notes = [
        used.length ? `already doing ${used.join(", ")}` : "",
        x.missing.length ? `no ${x.missing.map(label).join(", ")}` : "",
      ].filter(Boolean);
      return { restaurantId: x.r.id, name: x.r.name, cost: x.cost, delta: round2(x.cost - c.cost), note: notes.join("; ") || undefined };
    });

  const covered = pool.filter((x) => x.missing.length === 0);
  const cheapest = covered[0] ?? pool[0];
  let reason: string;
  if (status === "swapped") reason = `You picked ${r.name}.`;
  else if (!cheapest || cheapest.r.id === r.id)
    reason = missing.length ? `Cheapest option, est. ${gbp(c.cost)}.` : `Cheapest option covering every dietary need, est. ${gbp(c.cost)}.`;
  else {
    const saved = gbp(c.cost - cheapest.cost);
    const used = usedBy(cheapest.r.id);
    const sameCuisine = others.some((o) => o.r.cuisine.toLowerCase() === cheapest.r.cuisine.toLowerCase());
    reason =
      c.cost < cheapest.cost
        ? `${cheapest.r.name} covers every dietary need but costs ${gbp(cheapest.cost - c.cost)} more; ${r.name} keeps the total down.`
        : used.length
          ? `${cheapest.r.name} is ${saved} cheaper but already does ${used.join(", ")}; ${r.name} keeps the menu varied.`
          : sameCuisine
            ? `${cheapest.r.name} is ${saved} cheaper, but ${cheapest.r.cuisine.toLowerCase()} is already on the menu.`
            : `Rated ${r.rating ?? "?"}★ against ${cheapest.r.rating ?? "?"}★ for ${saved} more.`;
  }
  if (missing.length) reason += ` Menu doesn't list ${missing.map(label).join(", ")}; sort those separately.`;
  if (openFor(slot, restaurants, openAt).noneOpen)
    reason += ` Nothing nearby is listed as open at ${londonClock(slot.servesAt)}, so order ahead and hold it.`;

  return { slot, restaurantId: r.id, ...c, lines, status, locked: false, missing, reason, alternatives };
}

/** An order that's already placed: its real restaurant, lines and total, whatever the search found. */
function lockedSlot(slot: MealSlot, order: FixedOrder, r: Restaurant | undefined, lines: OrderLine[]): SlotPlan {
  const own = order.lines ?? lines;
  const c = r ? costOrder(slot, r, own.reduce((n, l) => n + l.quantity, 0), order.platform) : undefined;
  const cost = round2(order.total ?? c?.cost ?? 0);
  const fee = Math.min(cost, c?.fee ?? 0);
  return {
    slot,
    restaurantId: order.restaurantId,
    delivery: c?.delivery,
    lines: own,
    food: round2(cost - fee),
    fee,
    cost,
    orderBy: order.orderBy ?? c?.orderBy ?? slot.servesAt,
    status: "approved",
    locked: true,
    missing: r ? missingFor(r, needs(own)) : [],
    reason: `Already ordered from ${r?.name ?? order.restaurantName ?? "the restaurant"}.`,
    alternatives: [],
  };
}

/** People as a whole number; anything that isn't a positive number is nobody. */
const people = (n: unknown) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const label = (d: Dietary) => DIETARY.find((x) => x.id === d)!.label.toLowerCase();

/** Budget in pounds; anything that isn't a non-negative number is £0. */
const pounds = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

function totals(input: PlannerInput, slots: SlotPlan[]): Omit<MealPlan, "input" | "slots"> {
  const budget = pounds(input.budget);
  const total = round2(slots.reduce((sum, s) => sum + s.cost, 0));
  const remaining = round2(budget - total);
  const fits = total <= budget + 1e-9;
  const notes: string[] = [];
  const meals = slots.reduce((sum, s) => sum + s.lines.reduce((n, l) => n + l.quantity, 0), 0);
  if (!slots.length)
    notes.push(people(input.headcount) ? "No meals fall inside these dates. Check the start and end times." : "Add how many people you're feeding to plan meals.");
  else if (fits) {
    notes.push(`${gbp(total)} of ${gbp(budget)} across ${slots.length} meals${meals ? `, about £${(total / meals).toFixed(2)} a head per meal` : ""}.`);
    notes.push(`${gbp(remaining)} left for drinks, snacks and surprises.`);
  } else notes.push(`Over budget by ${gbp(-remaining)} even with the cheapest options. Drop a meal or raise the budget.`);
  const gaps = slots.filter((s) => s.missing.length);
  if (gaps.length) notes.push(`${gaps.map((s) => s.slot.label).join(", ")} can't cover every dietary need from one restaurant.`);
  return { total, budget, remaining, fits, notes };
}

/** Builds the plan: greedy picks in slot order, then cheaper swaps until it fits the budget. */
export function planMeals(input: PlannerInput, restaurants: Restaurant[]): MealPlan {
  const pool = [...restaurants].sort(byId);
  const fixed = (id: string): FixedOrder | undefined => {
    const f = input.fixed?.[id];
    return typeof f === "string" ? { restaurantId: f } : f;
  };
  const headcount = people(input.headcount);
  // Nobody to feed (or no restaurants) plans nothing new, but placed orders always stay.
  const slots = (input.slots ?? (headcount ? proposeSlots({ ...input, headcount }) : []))
    .map((s) => ({ ...s, headcount: people(s.headcount) }))
    .filter((s) => fixed(s.id) || (s.headcount > 0 && pool.length > 0));
  const { openAt } = input;

  const lines = slots.map((s) => splitDietary(s.headcount, input.dietaryMix, input.dietaryCounts));
  const wanted = lines.map(needs);
  const fixedAt = slots.map((s) => fixed(s.id));
  const picks: (Restaurant | undefined)[] = slots.map((_, i) => fixedAt[i] && pool.find((r) => r.id === fixedAt[i]!.restaurantId));
  const lockedCost = slots.map((s, i) => (fixedAt[i] ? lockedSlot(s, fixedAt[i]!, picks[i], lines[i]).cost : 0));

  const scoreAt = (i: number, r: Restaurant, current: (Restaurant | undefined)[]) => {
    const others = current.flatMap((x, j) => (j !== i && x ? [{ slot: slots[j], r: x }] : []));
    const cost = costSlot(slots[i], r).cost;
    return { cost, pen: penalty(slots[i], r, cost, wanted[i], others) };
  };

  // 1. Greedy, in time order: cheapest once repeats and menu gaps are priced in. Ordered slots stay put.
  slots.forEach((_, i) => {
    if (fixedAt[i]) return;
    const ranked = candidatesFor(slots[i], pool, openAt)
      .map((r) => ({ r, ...scoreAt(i, r, picks) }))
      .sort((a, b) => a.cost + a.pen - (b.cost + b.pen) || byId(a.r, b.r));
    picks[i] = ranked[0].r;
  });

  // 2. Over budget: make the swap that gives up the least per pound saved, until it fits.
  const budget = pounds(input.budget);
  const total = () => picks.reduce((sum, r, i) => sum + (fixedAt[i] ? lockedCost[i] : costSlot(slots[i], r!).cost), 0);
  for (let guard = 0; total() > budget && guard < 100; guard++) {
    let best: { i: number; r: Restaurant; rate: number; saving: number } | undefined;
    slots.forEach((_, i) => {
      if (fixedAt[i]) return;
      const now = scoreAt(i, picks[i]!, picks);
      for (const r of candidatesFor(slots[i], pool, openAt)) {
        const alt = scoreAt(i, r, picks);
        const saving = now.cost - alt.cost;
        if (saving <= 0.005) continue;
        const rate = (alt.pen - now.pen) / saving;
        if (!best || rate < best.rate - 1e-9 || (Math.abs(rate - best.rate) <= 1e-9 && saving > best.saving)) best = { i, r, rate, saving };
      }
    });
    if (!best) break;
    picks[best.i] = best.r;
  }

  const planned = slots.map((slot, i) => {
    if (fixedAt[i]) return lockedSlot(slot, fixedAt[i]!, picks[i], lines[i]);
    const others = picks.flatMap((r, j) => (j !== i && r ? [{ slot: slots[j], r }] : []));
    return buildSlot(slot, picks[i]!, lines[i], pool, others, "proposed", openAt);
  });
  return { input, slots: planned, ...totals(input, planned) };
}

/** Puts `restaurantId` on one slot. Other slots keep their picks; totals and notes are recomputed. */
export function swapRestaurant(plan: MealPlan, slotId: string, restaurantId: string, restaurants: Restaurant[]): MealPlan {
  const r = restaurants.find((x) => x.id === restaurantId);
  const at = plan.slots.findIndex((s) => s.slot.id === slotId);
  if (!r || at < 0 || plan.slots[at].locked) return plan;
  const others = plan.slots.flatMap((s, j) => {
    const x = restaurants.find((y) => y.id === s.restaurantId);
    return j !== at && x ? [{ slot: s.slot, r: x }] : [];
  });
  const slots = plan.slots.map((s, j) => (j === at ? buildSlot(s.slot, r, s.lines, restaurants, others, "swapped", plan.input.openAt) : s));
  return { ...plan, slots, ...totals(plan.input, slots) };
}

/** Marks one slot (or every slot, without `slotId`) as approved. */
export function approveSlot(plan: MealPlan, slotId?: string): MealPlan {
  return { ...plan, slots: plan.slots.map((s) => (!slotId || s.slot.id === slotId ? { ...s, status: "approved" } : s)) };
}
