/** Panels in the dashboard, addressable as /demo?section=… */
export type Section = "overview" | "restaurants" | "orders" | "mealcheck";

export const isSection = (value: string): value is Section =>
  value === "overview" || value === "restaurants" || value === "orders" || value === "mealcheck";

export type SettingsTab = "event" | "dietary" | "notifications";

export const isSettingsTab = (value: unknown): value is SettingsTab =>
  value === "event" || value === "dietary" || value === "notifications";
