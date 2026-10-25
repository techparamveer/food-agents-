import { isOpenAt } from "@/lib/restaurants/hours";
import type { DataSource, OpeningPeriod } from "@/lib/restaurants/types";
import { OXHACK_RESTAURANTS } from "@/lib/seed/oxhack";
import type { Dietary, DietaryMix, MealSlot, Restaurant, Venue } from "@/lib/types";

/* Thin adapter over restaurant search, safe to import on the client. The planner and chat call
   `searchRestaurants` (one slot) or `searchForSlots` (a whole plan). On the server the live
   `findRestaurants` is plugged in with `setRestaurantSearch` (see lib/server/food-chat.ts); the
   browser passes a finder that calls /api/restaurants. Anything that fails falls back to the
   seeded OxHack restaurants, and says so. */

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
  /** Drop places known to be closed at `slotTime`. The live search defaults to true. */
  openAtSlot?: boolean;
};

/** What a live search reports alongside its list (`findRestaurants`' result has all of it). */
export type SearchMeta = { source?: DataSource; grounded?: number; warnings?: string[] };

/** `findRestaurants` returns `{ restaurants, source, … }`; a bare list is accepted too. */
export type FindRestaurants = (query: RestaurantQuery) => Promise<Restaurant[] | ({ restaurants: Restaurant[] } & SearchMeta)>;

/** Where a plan's restaurants came from, for the UI to say so. */
export type SearchInfo = {
  /** live / cache = Google Places (fresh or cached); fallback = seeded restaurants. */
  source: DataSource;
  /** Restaurants whose cost per head is grounded in a Google Search result. */
  grounded: number;
  count: number;
  /** Plain sentences: why it fell back or what's degraded. Never upstream error text. */
  warnings: string[];
};

export type SlotSearch = SearchInfo & {
  restaurants: Restaurant[];
  /** Slot id → ids of restaurants open for it (see `openAtSlots`). */
  openAt: Record<string, string[]>;
};

/** Seeded stand-in: covers the most asked-for needs, then cheapest per head. */
export const findSeededRestaurants = async ({ maxPerHead, dietary = [], dietaryMix }: RestaurantQuery): Promise<Restaurant[]> => {
  const covers = (r: Restaurant) =>
    dietary.filter((d) => r.serves.includes(d)).length +
    (dietaryMix ? r.serves.reduce((n, d) => n + (dietaryMix[d] ?? 0), 0) / 100 : 0);
  return OXHACK_RESTAURANTS.slice(0, 3).filter((r) => maxPerHead === undefined || r.costPerHead.value <= maxPerHead).sort(
    (a, b) => covers(b) - covers(a) || a.costPerHead.value - b.costPerHead.value || a.id.localeCompare(b.id),
  );
};

let impl: FindRestaurants = findSeededRestaurants;

/** Plugs in the live search: `setRestaurantSearch(findRestaurants)`. */
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

/**
 * Restaurants open for each slot. A kitchen has to be open when the food leaves it, at serving
 * time minus travel; places with unknown hours count as open (the seed has none).
 */
export function openAtSlots(restaurants: (Restaurant & { openingPeriods?: OpeningPeriod[] })[], slots: MealSlot[]): Record<string, string[]> {
  return Object.fromEntries(
    slots.map((slot) => {
      const serves = Date.parse(slot.servesAt);
      const open = restaurants.filter((r) => isOpenAt(r.openingPeriods, new Date(serves - r.travelMinutes.value * 60_000)) !== false);
      return [slot.id, open.map((r) => r.id)];
    }),
  );
}

const SEEDED_WARNING = "Live restaurant search didn't answer: planning from seeded restaurants.";

/**
 * One search for a whole plan, then opening hours checked per slot. Estimates don't depend on the
 * slot, so one call (cached per headcount band) prices every meal; `openAt` keeps each meal to places
 * open at its time. Never throws: on failure it returns the seeded restaurants with `source: "fallback"`.
 */
export async function searchForSlots(
  query: Omit<RestaurantQuery, "slotTime" | "openAtSlot">,
  slots: MealSlot[],
  find: FindRestaurants = impl,
): Promise<SlotSearch> {
  const slotTime = slots[0]?.servesAt ?? new Date().toISOString();
  const done = (restaurants: Restaurant[], meta: Required<SearchMeta>): SlotSearch => ({
    restaurants,
    openAt: openAtSlots(restaurants, slots),
    count: restaurants.length,
    ...meta,
  });
  try {
    const found = await find({ ...query, slotTime, openAtSlot: false });
    const list = Array.isArray(found) ? found : found.restaurants;
    if (list.length) {
      const meta: SearchMeta = Array.isArray(found) ? {} : found;
      return done(list, {
        source: meta.source ?? (find === findSeededRestaurants ? "fallback" : "live"),
        grounded: meta.grounded ?? 0,
        warnings: meta.warnings ?? [],
      });
    }
  } catch {}
  const seeded = await findSeededRestaurants({ ...query, slotTime });
  return done(seeded, { source: "fallback", grounded: 0, warnings: find === findSeededRestaurants ? [] : [SEEDED_WARNING] });
}
