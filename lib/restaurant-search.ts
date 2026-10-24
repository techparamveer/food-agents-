import { OXHACK_RESTAURANTS } from "@/lib/seed/oxhack";
import type { Dietary, DietaryMix, Restaurant, Venue } from "@/lib/types";

/* Thin adapter over restaurant search. The planner and chat only call `searchRestaurants`.
   The Restaurants work (feature/restaurants) provides `findRestaurants` with this input, backed by
   Places + Gemini; until it merges this ranks the seeded OxHack restaurants instead. */

export type RestaurantQuery = {
  venue: Venue;
  /** ISO time food must arrive by. */
  slotTime: string;
  headcount: number;
  /** Upper limit on estimated cost per head, in pounds. */
  maxPerHead?: number;
  /** Hard filter: every need must be covered. The planner leaves this out and prices gaps instead. */
  dietary?: Dietary[];
  /** Soft ranking: favour places that cover more of the mix. */
  dietaryMix?: DietaryMix;
};

/** `findRestaurants` returns `{ restaurants }`; a bare list is accepted too. */
export type FindRestaurants = (query: RestaurantQuery) => Promise<Restaurant[] | { restaurants: Restaurant[] }>;

/** Seeded stand-in: covers the most asked-for needs, then cheapest per head. */
export const findSeededRestaurants = async ({ maxPerHead, dietary = [], dietaryMix }: RestaurantQuery): Promise<Restaurant[]> => {
  const covers = (r: Restaurant) =>
    dietary.filter((d) => r.serves.includes(d)).length +
    (dietaryMix ? r.serves.reduce((n, d) => n + (dietaryMix[d] ?? 0), 0) / 100 : 0);
  return OXHACK_RESTAURANTS.filter((r) => maxPerHead === undefined || r.costPerHead.value <= maxPerHead).sort(
    (a, b) => covers(b) - covers(a) || a.costPerHead.value - b.costPerHead.value || a.id.localeCompare(b.id),
  );
};

let impl: FindRestaurants = findSeededRestaurants;

/** Swap in the live search once it lands: `setRestaurantSearch(findRestaurants)`. */
export function setRestaurantSearch(next: FindRestaurants) {
  impl = next;
}

/** Restaurants for one slot. Never throws: a failed or empty live search falls back to the seed. */
export async function searchRestaurants(query: RestaurantQuery): Promise<Restaurant[]> {
  try {
    const found = await impl(query);
    const list = Array.isArray(found) ? found : found.restaurants;
    if (list.length) return list;
  } catch {}
  return findSeededRestaurants(query);
}
