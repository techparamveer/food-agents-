import "server-only";
import { estimateRestaurants } from "@/lib/estimates";
import { fetchPhotoUri, searchNearbyRestaurants } from "@/lib/places";
import { HOUR, cacheGet, cacheSet } from "@/lib/restaurants/cache";
import { heuristicEstimates, isGroundedEstimate, platformLabel } from "@/lib/restaurants/estimate-parse";
import { liveTimes } from "@/lib/restaurants/live";
import {
  estimatesKey,
  fallbackResult,
  finalise,
  headcountBand,
  normaliseInput,
  type FindRestaurantsInput,
  type FindRestaurantsResult,
} from "@/lib/restaurants/find-core";
import { DEFAULT_VENUE } from "@/lib/restaurants/seed";
import type { PlaceResult, RestaurantEstimates } from "@/lib/restaurants/types";
import type { Venue } from "@/lib/types";

export type { FindRestaurantsInput, FindRestaurantsResult } from "@/lib/restaurants/find-core";
export type { RankedRestaurant } from "@/lib/restaurants/types";

const PLACES_TTL = 24 * HOUR;
/** Grounded estimates are expensive and stable: keep them three days. */
const GROUNDED_TTL = 72 * HOUR;
/** Gemini answered without a search source, or skipped the place: still cached so it isn't re-asked every request. */
const UNGROUNDED_TTL = 12 * HOUR;
/** Gemini failed: serve heuristics for a few minutes instead of retrying on every request. */
const FAILED_TTL = 10 * 60_000;
/** Gemini is asked about the busiest places only; the rest get labelled heuristics. */
const MAX_GROUNDED = 12;

/** Photo URLs are re-fetched twice a day; places without one (or a failed fetch) are retried hourly. */
const PHOTO_TTL = 12 * HOUR;
const NO_PHOTO_TTL = HOUR;
const DEFAULT_RADIUS = 1500;

/** v2: results carry each place's first photo. */
const placesKey = (venue: Pick<Venue, "lat" | "lon">, radius: number) => `places:v2:${venue.lat.toFixed(4)},${venue.lon.toFixed(4)}:${radius}`;

/** Upstream detail for the server log only. Users get a fixed, friendly sentence. */
const detail = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);

/** One Places call and one Gemini round per key at a time, however many requests arrive together. */
const placesInflight = new Map<string, Promise<PlaceResult[]>>();
const photoInflight = new Map<string, Promise<string | null>>();
const inflight = new Map<string, Promise<Map<string, RestaurantEstimates>>>();

function once<T>(map: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  let p = map.get(key);
  if (!p) {
    p = run().finally(() => map.delete(key));
    map.set(key, p);
  }
  return p;
}

/**
 * Restaurants near the venue that can feed `headcount` people at `slotTime`, ranked by
 * estimated cost per head, ETA and rating.
 *
 * Live path: Places API (New) Nearby Search → Gemini with Google Search grounding for
 * per-head cost, catering and delivery fees. Alongside, Just Eat and Deliveroo listings for the
 * venue's postcode (real ETA ranges, fees, who's listed) and Google Routes drive times (live.ts).
 * ETA, best first: the platform's own ETA → prep + Routes drive → prep + distance heuristic. Places is
 * cached 24 h; estimates 72 h when grounded, 12 h otherwise, per headcount band; listings 12 min;
 * drive times 6 h per departure. Without keys,
 * or when Places fails, it returns the seeded Oxford list with heuristic estimates and says why in
 * `warnings`. It never throws for upstream failures, only for invalid input (an unparseable `slotTime`).
 *
 * `source` is "live" when this call fetched anything from Google, "cache" when everything came
 * from the cache (or heuristics), and "fallback" for the seeded list.
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
  let fetched = false;

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return fallbackResult(q, ["Live restaurant search isn't set up here: showing seeded Oxford restaurants."]);
  }

  const key = placesKey(q.venue, q.radiusMeters);
  let places = await cacheGet<PlaceResult[]>(key);
  if (!places) {
    try {
      places = await once(placesInflight, key, async () => {
        const found = await searchNearbyRestaurants({ center: q.venue, radiusMeters: q.radiusMeters });
        if (found.length) await cacheSet(key, found, PLACES_TTL);
        return found;
      });
    } catch (error) {
      console.error("[restaurants] Places failed:", detail(error));
      return fallbackResult(q, ["Google Places didn't answer just now: showing seeded Oxford restaurants."]);
    }
    if (!places.length) return fallbackResult(q, ["Google Places found no restaurants nearby: showing seeded Oxford restaurants."]);
    fetched = true;
  }

  // Platform listings and drive times don't depend on the estimates: fetch them alongside Gemini.
  const live = liveTimes(places, q.venue, q.slot);
  const band = headcountBand(q.headcount);
  const estimates = new Map<string, RestaurantEstimates>();
  const cached = await Promise.all(places.map((p) => cacheGet<RestaurantEstimates>(estimatesKey(p.id, band))));
  places.forEach((p, i) => cached[i] && estimates.set(p.id, cached[i]!));

  const missing = places.filter((p) => !estimates.has(p.id)).slice(0, MAX_GROUNDED);
  if (missing.length && !process.env.GEMINI_API_KEY) {
    warnings.push("Gemini isn't set up here: costs and fees are Comeda heuristics.");
  } else if (missing.length) {
    const roundKey = `${band}:${missing.map((p) => p.id).sort().join(",")}`;
    try {
      const fresh = await once(inflight, roundKey, async () => {
        const { estimates: found } = await estimateRestaurants(missing, band);
        await Promise.all(
          [...found].map(([id, e]) => cacheSet(estimatesKey(id, band), e, isGroundedEstimate(e) ? GROUNDED_TTL : UNGROUNDED_TTL)),
        );
        return found;
      });
      fresh.forEach((e, id) => estimates.set(id, e));
      fetched = true;
    } catch (error) {
      console.error("[restaurants] Gemini failed:", detail(error));
      warnings.push("Gemini pricing is unavailable right now: costs and fees are Comeda heuristics.");
      await Promise.all(missing.map((p) => cacheSet(estimatesKey(p.id, band), heuristicEstimates(p, band), FAILED_TTL)));
    }
  }
  for (const p of places) if (!estimates.has(p.id)) estimates.set(p.id, heuristicEstimates(p, band));

  const grounded = [...estimates.values()].filter(isGroundedEstimate).length;
  const times = await live;
  for (const s of times.listings) {
    if (!s.ok) warnings.push(`${platformLabel(s.platform)} didn't answer: its fees and ETAs are Comeda estimates.`);
  }
  return finalise(q, places, estimates, { source: fetched ? "live" : "cache", grounded, warnings, live: times });
}

/**
 * Image URL for a restaurant's photo, or null. Only places already in the cached search around the
 * OxHack venue qualify, so a caller can't make the server fetch (and pay for) arbitrary photos;
 * this never runs a Places search itself. Each photo is fetched at most once per PHOTO_TTL.
 */
export async function placePhotoUrl(placeId: string): Promise<string | null> {
  if (!process.env.GOOGLE_PLACES_API_KEY) return null;
  const cacheKey = `photo:v1:${placeId}`;
  const hit = await cacheGet<{ uri: string | null }>(cacheKey);
  if (hit) return hit.uri;
  const photo = (await cachedPlace(placeId))?.photo;
  if (!photo) return null;
  return once(photoInflight, placeId, async () => {
    let uri: string | null = null;
    try {
      uri = await fetchPhotoUri(photo.name);
    } catch (error) {
      console.error("[restaurants] photo failed:", detail(error));
    }
    await cacheSet(cacheKey, { uri }, uri ? PHOTO_TTL : NO_PHOTO_TTL);
    return uri;
  });
}

/** A place from the cached search around the OxHack venue, or undefined. Never runs a search:
    routes that act on a place id use this as their allow-list. */
export async function cachedPlace(placeId: string): Promise<PlaceResult | undefined> {
  const places = await cacheGet<PlaceResult[]>(placesKey(DEFAULT_VENUE, DEFAULT_RADIUS));
  return places?.find((p) => p.placeId === placeId);
}
