import { heuristicEstimates } from "@/lib/restaurants/estimate-parse";
import { filterRestaurants, scoreRestaurants, sortRestaurants, type SortKey } from "@/lib/restaurants/rank";
import { DEFAULT_VENUE, seedPlaces } from "@/lib/restaurants/seed";
import type { DataSource, PlaceResult, RankedRestaurant, RestaurantEstimates } from "@/lib/restaurants/types";
import { DIETARY, type Dietary, type DietaryMix, type Venue } from "@/lib/types";

/**
 * Input to `findRestaurants`. Stable contract: the Planner calls this.
 * Only `slotTime` and `headcount` are required.
 */
export type FindRestaurantsInput = {
  /** Where food is delivered. Defaults to the OxHack venue (Mathematical Institute, OX2 6GG). */
  venue?: Venue;
  /** When food must be on the table: ISO string or Date. Drives "open at slot" and `orderBy`. */
  slotTime: string | Date;
  /** People to feed. Scales prep time and `totalCost`. */
  headcount: number;
  /** Drop restaurants whose estimated cost per head (GBP) is above this. */
  maxPerHead?: number;
  /** Hard filter: the restaurant must cover every need listed. */
  dietary?: Dietary[];
  /** Soft ranking: favour restaurants that cover more of this mix (e.g. the event's `dietaryMix`). */
  dietaryMix?: DietaryMix;
  /** Optional dashboard filters. */
  cuisines?: string[];
  /** Drop restaurants known to be closed at `slotTime`. Default true. */
  openAtSlot?: boolean;
  /** Default "best": weighted cost per head, ETA and rating. */
  sort?: SortKey;
  /** Search radius around the venue, metres (200–5000). Default 1500. */
  radiusMeters?: number;
};

export type FindRestaurantsResult = {
  /** Filtered and sorted, best first. Each is a shared `Restaurant` plus ranking fields. */
  restaurants: RankedRestaurant[];
  /** Cuisines across the unfiltered set, for building filters. */
  cuisines: string[];
  /** live = fresh API calls, cache = served from cache, fallback = seeded Oxford data. */
  source: DataSource;
  /** How many restaurants have Gemini-grounded (not heuristic) cost estimates. */
  grounded: number;
  venue: Venue;
  slotTime: string;
  headcount: number;
  generatedAt: string;
  /** Why we fell back or degraded, human readable. Never contains secrets. */
  warnings: string[];
};

export type NormalisedInput = {
  venue: Venue;
  slot: Date;
  headcount: number;
  maxPerHead?: number;
  dietary: Dietary[];
  dietaryMix?: DietaryMix;
  cuisines: string[];
  openAtSlot: boolean;
  sort: SortKey;
  radiusMeters: number;
};

const DIETARY_IDS = DIETARY.map((d) => d.id);

/** Biggest event the search prices for. Anything above is clamped, so a public caller can't fan out cache keys. */
export const MAX_HEADCOUNT = 1000;

/** People → a whole number in 1…MAX_HEADCOUNT. Junk becomes 1. */
export const clampHeadcount = (n: unknown) => Math.min(MAX_HEADCOUNT, Math.max(1, Math.round(Number(n) || 1)));

/** Estimates are cached per band, not per headcount: five bands cover 1–1,000 people. */
const BANDS = [50, 100, 200, 500, MAX_HEADCOUNT];
export const headcountBand = (n: number) => BANDS.find((b) => clampHeadcount(n) <= b) ?? MAX_HEADCOUNT;

/** Cache key for one restaurant's estimates. Bump the version when the estimate shape or sourcing rules change. */
export const estimatesKey = (placeId: string, headcount: number) => `estimates:v3:${placeId}:${headcountBand(headcount)}`;

export function normaliseInput(input: FindRestaurantsInput): NormalisedInput {
  const slot = input.slotTime instanceof Date ? input.slotTime : new Date(input.slotTime);
  if (Number.isNaN(slot.getTime())) throw new Error(`Invalid slotTime: ${String(input.slotTime)}`);
  const max = Number(input.maxPerHead);
  return {
    venue: input.venue ?? DEFAULT_VENUE,
    slot,
    headcount: clampHeadcount(input.headcount),
    maxPerHead: input.maxPerHead !== undefined && Number.isFinite(max) && max > 0 ? max : undefined,
    dietary: (input.dietary ?? []).filter((d): d is Dietary => DIETARY_IDS.includes(d)),
    dietaryMix: input.dietaryMix,
    cuisines: input.cuisines ?? [],
    openAtSlot: input.openAtSlot ?? true,
    sort: input.sort ?? "best",
    radiusMeters: Math.min(5000, Math.max(200, Math.round(input.radiusMeters ?? 1500))),
  };
}

/** Score → filter → sort, wrapped in the result envelope. */
export function finalise(
  input: NormalisedInput,
  places: PlaceResult[],
  estimates: Map<string, RestaurantEstimates>,
  meta: { source: DataSource; grounded: number; warnings: string[] },
): FindRestaurantsResult {
  const scored = scoreRestaurants(places, estimates, {
    headcount: input.headcount,
    slot: input.slot,
    source: meta.source,
    venue: input.venue,
    dietaryMix: input.dietaryMix,
  });
  return {
    restaurants: sortRestaurants(filterRestaurants(scored, input), input.sort),
    cuisines: [...new Set(scored.map((r) => r.cuisine))].sort(),
    source: meta.source,
    grounded: meta.grounded,
    venue: input.venue,
    slotTime: input.slot.toISOString(),
    headcount: input.headcount,
    generatedAt: new Date().toISOString(),
    warnings: meta.warnings,
  };
}

/** The seeded Oxford list with heuristic estimates. Never throws, never touches the network. */
export function fallbackResult(input: NormalisedInput, warnings: string[]): FindRestaurantsResult {
  const places = seedPlaces(input.venue);
  const estimates = new Map(places.map((p) => [p.id, heuristicEstimates(p, input.headcount)]));
  return finalise(input, places, estimates, { source: "fallback", grounded: 0, warnings });
}
