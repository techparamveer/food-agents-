import "server-only";
import { estimateRestaurants } from "@/lib/estimates";
import { searchNearbyRestaurants } from "@/lib/places";
import { HOUR, cacheGet, cacheSet } from "@/lib/restaurants/cache";
import { GEMINI_SOURCE_LABEL, heuristicEstimates } from "@/lib/restaurants/estimate-parse";
import {
  fallbackResult,
  finalise,
  normaliseInput,
  type FindRestaurantsInput,
  type FindRestaurantsResult,
} from "@/lib/restaurants/find-core";
import type { PlaceResult, RestaurantEstimates } from "@/lib/restaurants/types";

export type { FindRestaurantsInput, FindRestaurantsResult } from "@/lib/restaurants/find-core";
export type { RankedRestaurant } from "@/lib/restaurants/types";

const PLACES_TTL = 24 * HOUR;
const ESTIMATES_TTL = 72 * HOUR;
/** Gemini is asked about the busiest places only; the rest get labelled heuristics. */
const MAX_GROUNDED = 12;

/** Estimates depend on headcount (prep time, catering): cache per band of 25 people. */
const headcountBand = (n: number) => Math.max(25, Math.ceil(n / 25) * 25);
const isGrounded = (e: RestaurantEstimates) => e.costPerHead.source.label === GEMINI_SOURCE_LABEL;
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 120);

/** One Gemini round per (places, band) at a time, however many requests arrive together. */
const inflight = new Map<string, Promise<Map<string, RestaurantEstimates>>>();

/**
 * Restaurants near the venue that can feed `headcount` people at `slotTime`, ranked by
 * estimated cost per head, ETA and rating.
 *
 * Live path: Places API (New) Nearby Search → Gemini with Google Search grounding for
 * per-head cost, catering and delivery fees → ETA = prep + travel from distance. Both
 * calls are cached (24 h / 72 h). Without keys, or when Places fails, it returns the seeded
 * Oxford list with heuristic estimates and says why in `warnings`. It never throws for
 * upstream failures, only for invalid input (an unparseable `slotTime`).
 *
 * @example
 * const { restaurants, source } = await findRestaurants({
 *   slotTime: "2026-11-14T18:30:00Z",
 *   headcount: 150,
 *   maxPerHead: 8,
 *   dietary: ["vegan"],
 * });
 */
export async function findRestaurants(input: FindRestaurantsInput): Promise<FindRestaurantsResult> {
  const q = normaliseInput(input);
  const warnings: string[] = [];

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return fallbackResult(q, ["Google Places key not set: showing seeded Oxford restaurants."]);
  }

  const placesKey = `places:v1:${q.venue.lat.toFixed(4)},${q.venue.lon.toFixed(4)}:${q.radiusMeters}`;
  let places = await cacheGet<PlaceResult[]>(placesKey);
  const placesCached = Boolean(places);
  if (!places) {
    try {
      places = await searchNearbyRestaurants({ center: q.venue, radiusMeters: q.radiusMeters });
    } catch (error) {
      console.error("[restaurants] Places failed:", short(error));
      return fallbackResult(q, [`Google Places unavailable (${short(error)}): showing seeded Oxford restaurants.`]);
    }
    if (!places.length) return fallbackResult(q, ["Google Places found no restaurants nearby: showing seeded Oxford restaurants."]);
    await cacheSet(placesKey, places, PLACES_TTL);
  }

  const band = headcountBand(q.headcount);
  const estKey = (id: string) => `estimates:v1:${id}:${band}`;
  const estimates = new Map<string, RestaurantEstimates>();
  const cached = await Promise.all(places.map((p) => cacheGet<RestaurantEstimates>(estKey(p.id))));
  places.forEach((p, i) => cached[i] && estimates.set(p.id, cached[i]!));

  const missing = places.filter((p) => !estimates.has(p.id)).slice(0, MAX_GROUNDED);
  if (missing.length && !process.env.GEMINI_API_KEY) {
    warnings.push("Gemini key not set: costs and fees are Comeda heuristics.");
  } else if (missing.length) {
    const roundKey = `${band}:${missing.map((p) => p.id).sort().join(",")}`;
    let round = inflight.get(roundKey);
    if (!round) {
      round = estimateRestaurants(missing, band)
        .then((r) => r.estimates)
        .finally(() => inflight.delete(roundKey));
      inflight.set(roundKey, round);
    }
    try {
      const fresh = await round;
      await Promise.all(
        [...fresh].map(([id, e]) => {
          estimates.set(id, e);
          return isGrounded(e) ? cacheSet(estKey(id), e, ESTIMATES_TTL) : undefined;
        }),
      );
    } catch (error) {
      console.error("[restaurants] Gemini failed:", short(error));
      warnings.push(`Gemini unavailable (${short(error)}): costs and fees are Comeda heuristics.`);
    }
  }
  for (const p of places) if (!estimates.has(p.id)) estimates.set(p.id, heuristicEstimates(p, band));

  const grounded = [...estimates.values()].filter(isGrounded).length;
  const allCached = placesCached && cached.every(Boolean);
  return finalise(q, places, estimates, { source: allCached ? "cache" : "live", grounded, warnings });
}
