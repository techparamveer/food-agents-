"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { EventData, MealSlot, Order, Restaurant } from "@/lib/types";

/* The event the dashboard is showing. The demo passes seeded OxHack data and keeps every
   change in memory; feature threads swap in live data behind the same shape. */

type Dashboard = EventData & {
  demo: boolean;
  restaurantById: (id: string) => Restaurant;
  slotById: (id: string) => MealSlot | undefined;
  orderForSlot: (slotId: string) => Order | undefined;
  /** Meals collected so far in a slot. */
  eatenIn: (slotId: string) => number;
  update: (patch: (data: EventData) => EventData) => void;
};

const Ctx = createContext<Dashboard | null>(null);

const UNKNOWN: Omit<Restaurant, "id"> = {
  name: "Restaurant",
  cuisine: "",
  address: "",
  lat: 0,
  lon: 0,
  distanceKm: 0,
  serves: [],
  costPerHead: { value: 0, source: { label: "Unknown" }, isEstimate: true },
  prepMinutes: { value: 0, source: { label: "Unknown" }, isEstimate: true },
  travelMinutes: { value: 0, source: { label: "Unknown" }, isEstimate: true },
  delivery: [],
  color: "#737373",
  monogram: "?",
};

export function DashboardProvider({
  initial,
  demo = false,
  children,
}: {
  initial: EventData;
  demo?: boolean;
  children: ReactNode;
}) {
  const [data, setData] = useState(initial);

  const restaurants = useMemo(() => new Map(data.restaurants.map((r) => [r.id, r])), [data.restaurants]);
  const restaurantById = useCallback((id: string) => restaurants.get(id) ?? { ...UNKNOWN, id }, [restaurants]);
  const slotById = useCallback((id: string) => data.slots.find((s) => s.id === id), [data.slots]);
  const orderForSlot = useCallback((slotId: string) => data.orders.find((o) => o.slotId === slotId), [data.orders]);
  const eatenIn = useCallback((slotId: string) => data.mealLogs.filter((l) => l.slotId === slotId).length, [data.mealLogs]);

  const value = useMemo<Dashboard>(
    () => ({ ...data, demo, restaurantById, slotById, orderForSlot, eatenIn, update: setData }),
    [data, demo, restaurantById, slotById, orderForSlot, eatenIn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}

/* ---------- Formatting shared by the views. Wall-clock times are shown in London. ---------- */

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/London" });

export const clock = (iso: string) => time.format(new Date(iso));
export const longDay = (iso: string) => day.format(new Date(iso));
export const weekday = (iso: string) => shortDay.format(new Date(iso));
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

export const money = (pounds: number) =>
  pounds.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(pounds) ? 0 : 2,
    maximumFractionDigits: 2,
  });

/** "in 53 min", "in 6 h 10 min", or "passed". */
export function countdown(target: string, now: string) {
  const minutes = Math.round((Date.parse(target) - Date.parse(now)) / 60_000);
  if (minutes <= 0) return "passed";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}
