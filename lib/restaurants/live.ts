import "server-only";
import { createHash } from "node:crypto";
import { HOUR, cacheGet, cacheSet } from "@/lib/restaurants/cache";
import { parseRouteMatrix } from "@/lib/restaurants/geo";
import {
  SCRAPED_PLATFORMS,
  compactPostcode,
  deliverooListingUrl,
  justEatListingUrl,
  parseDeliveroo,
  parseJustEat,
  type ListingSnapshot,
  type PlatformListing,
} from "@/lib/restaurants/listings";
import type { LiveTimes, PlaceResult, Platform, RouteTime } from "@/lib/restaurants/types";
import type { Venue } from "@/lib/types";

/**
 * Live figures for the venue: what Just Eat and Deliveroo list for its postcode right now, and
 * Google Routes driving times from each restaurant. Both are cached, de-duplicated in flight and
 * time-boxed; any failure returns nothing for that source, so the caller keeps its estimates.
 *
 * Platform listings are public pages read the way a browser reads them, with no login. At most
 * one request per platform per LISTING_TTL, whatever the traffic: a failure is cached too.
 * Uber Eats answers every request with a Cloudflare challenge, so it isn't scraped.
 */

/** ETAs move with the kitchen and courier queue: re-read every 12 minutes. */
const LISTING_TTL = 12 * 60_000;
/** A future departure's traffic prediction is stable; "now" changes. */
const ROUTES_TTL = 6 * HOUR;
const ROUTES_NOW_TTL = 15 * 60_000;
const ROUTES_FAILED_TTL = 10 * 60_000;
const QUARTER = 15 * 60_000;
const TIMEOUT_MS = 8_000;
/** Traffic-aware matrices allow 100 elements; Places returns at most 20 restaurants. */
const MAX_ORIGINS = 100;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ROUTES_ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

const detail = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);

const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Off in tests and when COMEDA_SCRAPE=0. */
const scrapingOn = () => process.env.COMEDA_SCRAPE !== "0";

const FETCHERS: Record<Exclude<Platform, "ubereats">, (postcode: string) => Promise<PlatformListing[]>> = {
  justeat: async (postcode) => parseJustEat(await getText(justEatListingUrl(postcode), "application/json").then(JSON.parse)),
  deliveroo: async (postcode) => parseDeliveroo(await getText(deliverooListingUrl(postcode), "text/html,application/xhtml+xml")),
};

async function getText(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: accept, "Accept-Language": "en-GB,en;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.text();
}

/** One snapshot per scraped platform for the venue's postcode. Never throws. */
export async function platformListings(venue: Pick<Venue, "postcode">): Promise<ListingSnapshot[]> {
  if (!scrapingOn() || !venue.postcode) return [];
  const postcode = compactPostcode(venue.postcode);
  return Promise.all(
    SCRAPED_PLATFORMS.map(async (platform) => {
      const key = `listings:v1:${platform}:${postcode}`;
      const hit = await cacheGet<ListingSnapshot>(key);
      if (hit) return hit;
      return once(key, async () => {
        const checkedAt = new Date().toISOString();
        let snapshot: ListingSnapshot;
        try {
          const listings = await FETCHERS[platform as keyof typeof FETCHERS](postcode);
          if (!listings.length) throw new Error("no restaurants in the listing");
          snapshot = { platform, checkedAt, ok: true, listings };
        } catch (error) {
          console.error(`[restaurants] ${platform} listing failed:`, detail(error));
          snapshot = { platform, checkedAt, ok: false, listings: [] };
        }
        await cacheSet(key, snapshot, LISTING_TTL);
        return snapshot;
      });
    }),
  );
}

/** Departure for the traffic model: the slot if it's still ahead, else none (current traffic). */
function departure(slot: Date, now = Date.now()) {
  return slot.getTime() > now + 2 * 60_000 ? slot : undefined;
}

/**
 * Driving time from every place to the venue, departing at the slot: one `computeRouteMatrix`
 * call for the whole list, cached per place set and 15-minute departure bucket. Never throws.
 */
export async function routeTimes(places: PlaceResult[], venue: Pick<Venue, "lat" | "lon">, slot: Date): Promise<Record<string, RouteTime>> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !places.length) return {};
  const origins = places.slice(0, MAX_ORIGINS);
  const depart = departure(slot);
  // Slots sit on the quarter hour; anything else rounds up to one, so nearby slots share a call.
  const departAt = depart && new Date(Math.ceil(depart.getTime() / QUARTER) * QUARTER);
  const bucket = departAt ? departAt.getTime() / QUARTER : Math.floor(Date.now() / QUARTER);
  const ids = createHash("sha256")
    .update(origins.map((p) => p.id).sort().join(","))
    .digest("hex")
    .slice(0, 16);
  const key = `routes:v1:${venue.lat.toFixed(4)},${venue.lon.toFixed(4)}:${departAt ? "at" : "now"}:${bucket}:${ids}`;
  const hit = await cacheGet<Record<string, RouteTime>>(key);
  if (hit) return hit;
  return once(key, async () => {
    let times: Record<string, RouteTime> = {};
    try {
      const res = await fetch(ROUTES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition,status",
        },
        body: JSON.stringify({
          origins: origins.map((p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lon } } } })),
          destinations: [{ waypoint: { location: { latLng: { latitude: venue.lat, longitude: venue.lon } } } }],
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          ...(departAt ? { departureTime: departAt.toISOString() } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Routes ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const seconds = parseRouteMatrix(await res.json(), origins.length);
      console.info(`[restaurants] Routes matrix: ${origins.length} elements`);
      origins.forEach((p, i) => {
        if (seconds[i] !== undefined) times[p.id] = { seconds: seconds[i]!, ...(departAt ? { departAt: departAt.toISOString() } : {}) };
      });
    } catch (error) {
      console.error("[restaurants] Routes failed:", detail(error));
      times = {};
      await cacheSet(key, times, ROUTES_FAILED_TTL);
      return times;
    }
    await cacheSet(key, times, departAt ? ROUTES_TTL : ROUTES_NOW_TTL);
    return times;
  });
}

/** Listings and drive times together, fetched in parallel. */
export async function liveTimes(places: PlaceResult[], venue: Venue, slot: Date): Promise<LiveTimes> {
  const [listings, routes] = await Promise.all([platformListings(venue), routeTimes(places, venue, slot)]);
  return { listings, routes };
}
