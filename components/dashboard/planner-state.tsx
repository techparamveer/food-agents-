"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useDashboard } from "@/components/dashboard/data";
import { applyPlan, formFromEvent, plannerInput, type PlannerForm } from "@/lib/plan-sync";
import { approveSlot, costOrder, planMeals, swapRestaurant, type MealPlan } from "@/lib/planner";
import type { DeliveryPlatform, OrderLine, OrderStatus } from "@/lib/types";

/* "Get it done" state: the planner's latest proposal and the actions that write it into the event
   (approve, swap, order status, order quantities). Everything stays in memory in the demo. */

type Planner = {
  /** The last plan "Get it done" produced; null until it has run. */
  mealPlan: MealPlan | null;
  form: PlannerForm;
  run: (form: PlannerForm) => MealPlan;
  approve: (slotId?: string) => void;
  swap: (slotId: string, restaurantId: string) => void;
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

  const run = useCallback(
    (next: PlannerForm) => {
      setForm(next);
      const plan = planMeals(plannerInput(data, next), restaurants);
      commit(plan);
      return plan;
    },
    [data, restaurants, commit],
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
    () => ({ mealPlan, form, run, approve, swap, setStatus, setLines, setPlatform }),
    [mealPlan, form, run, approve, swap, setStatus, setLines, setPlatform],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlanner must be used inside PlannerProvider");
  return ctx;
}
