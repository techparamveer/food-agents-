"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useDashboard } from "@/components/dashboard/data";
import { addManualOrder, applyPlan, formFromEvent, mergeRestaurants, plannerInput, type ManualOrderInput, type PlannerForm } from "@/lib/plan-sync";
import { approveSlot, costOrder, planMeals, swapRestaurant, type MealPlan } from "@/lib/planner";
import { searchForSlots, type FindRestaurants } from "@/lib/restaurant-search";
import type { FindRestaurantsResult } from "@/lib/restaurants/find-core";
import type { DeliveryPlatform, OrderLine, OrderStatus, Restaurant } from "@/lib/types";

/* "Get it done" state: the planner's latest proposal and the actions that write it into the event
   (approve, swap, order status, order quantities). Everything stays in memory in the demo.
   Plans use live restaurants from /api/restaurants (Places + Gemini, cached); if that fails the
   planner falls back to the seeded restaurants and the plan says so (`plan.search`). */

/** The browser's restaurant search: the public route, which caches and rate-limits upstream calls. */
const fetchRestaurants: FindRestaurants = async (q) => {
  const params = new URLSearchParams({ slot: q.slotTime, headcount: String(q.headcount), open: "0" });
  const res = await fetch(`/api/restaurants?${params}`);
  if (!res.ok) throw new Error(`Restaurant search failed: ${res.status}`);
  return (await res.json()) as FindRestaurantsResult;
};

async function generateNarrative(plan: MealPlan, restaurants: Restaurant[]) {
  if (!plan.search) return undefined;
  const response = await fetch("/api/plan-narrative", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: plan.search.source,
      budget: plan.budget,
      total: plan.total,
      remaining: plan.remaining,
      fits: plan.fits,
      meals: plan.slots.map((slot) => ({ label: slot.slot.label, restaurantId: slot.restaurantId, missing: slot.missing })),
      restaurants: restaurants.map((restaurant) => ({ id: restaurant.id, name: restaurant.name, serves: restaurant.serves })),
    }),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { narrative?: unknown };
  return typeof body.narrative === "string" && body.narrative.trim() ? body.narrative.trim() : undefined;
}

type Planner = {
  /** The last plan "Get it done" produced; null until it has run. */
  mealPlan: MealPlan | null;
  form: PlannerForm;
  /** Plans the form. `live: false` skips the search and uses the event's restaurants (the landing page tour). */
  run: (form: PlannerForm, options?: { live?: boolean }) => Promise<MealPlan>;
  approve: (slotId?: string) => void;
  swap: (slotId: string, restaurantId: string) => void;
  addOrder: (input: ManualOrderInput) => string;
  setStatus: (orderId: string, status: OrderStatus) => void;
  setLines: (orderId: string, lines: OrderLine[]) => void;
  setPlatform: (orderId: string, platform: DeliveryPlatform) => void;
};

const Ctx = createContext<Planner | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const data = useDashboard();
  const { update, restaurants, now } = data;
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [form, setForm] = useState<PlannerForm>(() => formFromEvent(data));

  const commit = useCallback(
    (plan: MealPlan, only?: string[]) => {
      setMealPlan(plan);
      update((d) => applyPlan(d, plan, now, only));
    },
    [update, now],
  );

  // Only the latest "Get it done" may write its plan, however the searches finish.
  const latest = useRef(0);
  const run = useCallback(
    async (next: PlannerForm, { live = true }: { live?: boolean } = {}) => {
      setForm(next);
      const ticket = ++latest.current;
      if (!live) {
        const plan = planMeals(plannerInput(data, next), restaurants);
        commit(plan);
        return plan;
      }
      const slots = plannerInput(data, next).slots ?? [];
      const { restaurants: found, openAt, ...search } = await searchForSlots(
        { venue: data.event.venue, headcount: next.headcount, dietaryMix: next.dietaryMix },
        slots,
        fetchRestaurants,
      );
      // Placed orders keep their own restaurants; everything else is planned from what the search found.
      const planned: MealPlan = { ...planMeals(plannerInput(data, next, openAt), found), search };
      const narrative = await generateNarrative(planned, found).catch(() => undefined);
      const plan = narrative ? { ...planned, narrative } : planned;
      if (ticket === latest.current) {
        update((d) => mergeRestaurants(d, found));
        commit(plan);
      }
      return plan;
    },
    [data, restaurants, commit, update],
  );

  /** The current plan, or a fresh one from the form when "Get it done" hasn't run yet. */
  const base = useCallback(() => mealPlan ?? planMeals(plannerInput(data, form), restaurants), [mealPlan, data, form, restaurants]);

  const approve = useCallback(
    (slotId?: string) => {
      const plan = base();
      commit(approveSlot(plan, slotId), mealPlan ? [] : undefined);
    },
    [base, mealPlan, commit],
  );

  const swap = useCallback(
    (slotId: string, restaurantId: string) => {
      const plan = base();
      commit(swapRestaurant(plan, slotId, restaurantId, restaurants), mealPlan ? [slotId] : undefined);
    },
    [base, mealPlan, restaurants, commit],
  );

  const addOrder = useCallback(
    (input: ManualOrderInput) => {
      const key = globalThis.crypto.randomUUID();
      update((d) => addManualOrder(d, input, key));
      return `ord-manual-${key}`;
    },
    [update],
  );

  /** Re-costs an order after its quantities or platform change. */
  const reprice = useCallback(
    (orderId: string, patch: { lines?: OrderLine[]; platform?: DeliveryPlatform }) =>
      update((d) => ({
        ...d,
        orders: d.orders.map((o) => {
          if (o.id !== orderId) return o;
          const slot = d.slots.find((s) => s.id === o.slotId);
          const restaurant = d.restaurants.find((r) => r.id === o.restaurantId);
          const lines = patch.lines ?? o.lines;
          const platform = patch.platform ?? o.platform;
          if (!slot || !restaurant) return { ...o, lines, platform };
          const c = costOrder(slot, restaurant, lines.reduce((n, l) => n + l.quantity, 0), platform);
          return { ...o, lines, platform, orderBy: c.orderBy, total: { ...o.total, value: c.cost } };
        }),
      })),
    [update],
  );

  const setStatus = useCallback(
    (orderId: string, status: OrderStatus) => update((d) => ({ ...d, orders: d.orders.map((o) => (o.id === orderId ? { ...o, status } : o)) })),
    [update],
  );
  const setLines = useCallback((orderId: string, lines: OrderLine[]) => reprice(orderId, { lines }), [reprice]);
  const setPlatform = useCallback((orderId: string, platform: DeliveryPlatform) => reprice(orderId, { platform }), [reprice]);

  const value = useMemo<Planner>(
    () => ({ mealPlan, form, run, approve, swap, addOrder, setStatus, setLines, setPlatform }),
    [mealPlan, form, run, approve, swap, addOrder, setStatus, setLines, setPlatform],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlanner must be used inside PlannerProvider");
  return ctx;
}
