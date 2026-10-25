import { distanceMeters, type LatLon } from "@/lib/restaurants/geo";
import type { PlaceResult, Platform } from "@/lib/restaurants/types";

/* Pure side of the platform scrapers: parse what Just Eat and Deliveroo publish for a postcode,
   and match those listings to our Places restaurants. No fetch, no env (see live.ts). */

/** One restaurant as a delivery platform lists it for the venue's postcode. */
export type PlatformListing = {
  name: string;
  /** Just Eat gives coordinates. */
  location?: LatLon;
  /** Deliveroo gives only a rounded distance from the venue. */
  distanceMeters?: number;
  /** Minutes from order to door for a normal-sized order. Deliveroo gives one number: low = high. */
  eta?: { low: number; high: number };
  /** Delivery fee in pounds by order value: the highest `min` at or below the basket applies. */
  feeBands?: { min: number; fee: number }[];
  openNow?: boolean;
  /** The restaurant's page on the platform. */
  url?: string;
};

/** Everything one platform listed for the venue at `checkedAt`. `ok: false` = the scrape failed. */
export type ListingSnapshot = {
  platform: Platform;
  checkedAt: string;
  ok: boolean;
  listings: PlatformListing[];
};

/** Platforms Comeda can read without logging in. Uber Eats sits behind a Cloudflare challenge, so it stays an estimate. */
export const SCRAPED_PLATFORMS: Platform[] = ["justeat", "deliveroo"];

/** Postcode as both platforms want it in URLs: "OX2 6GG" → "OX26GG". */
export const compactPostcode = (postcode: string) => postcode.replace(/\s+/g, "").toUpperCase();

export const justEatListingUrl = (postcode: string) =>
  `https://uk.api.just-eat.io/discovery/uk/restaurants/enriched/bypostcode/${encodeURIComponent(compactPostcode(postcode))}`;

/** Any Oxford area slug works: Deliveroo redirects to the postcode's own area when it differs. */
export const deliverooListingUrl = (postcode: string) =>
  `https://deliveroo.co.uk/restaurants/oxford/jericho-and-walton-manor?postcode=${encodeURIComponent(compactPostcode(postcode))}&collection=all-restaurants`;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const minutesOk = (n: number | undefined): n is number => n !== undefined && n > 0 && n <= 240;

/* ---------- Just Eat ---------- */

/**
 * Listings from Just Eat's public discovery endpoint (`…/enriched/bypostcode/{postcode}`).
 * Collection-only restaurants are dropped: they can't deliver to the venue.
 */
export function parseJustEat(body: unknown): PlatformListing[] {
  const root = obj(body);
  const rows = Array.isArray(root?.restaurants) ? root.restaurants : [];
  const fees = obj(obj(root?.deliveryFees)?.restaurants) ?? {};
  return rows.flatMap((row): PlatformListing[] => {
    const r = obj(row);
    const name = str(r?.name);
    if (!r || !name || r.isDelivery === false) return [];
    const [lon, lat] = (obj(obj(r.address)?.location)?.coordinates as unknown[] | undefined) ?? [];
    const etaRaw = obj(r.deliveryEtaMinutes) ?? obj(obj(obj(r.availability)?.delivery)?.etaMinutes);
    const low = num(etaRaw?.rangeLower) ?? num(etaRaw?.approximate);
    const high = num(etaRaw?.rangeUpper) ?? low;
    const bands = (Array.isArray(obj(fees[String(r.id)])?.bands) ? (obj(fees[String(r.id)])!.bands as unknown[]) : [])
      .map(obj)
      .flatMap((b) => (num(b?.minimumAmount) !== undefined && num(b?.fee) !== undefined ? [{ min: num(b!.minimumAmount)! / 100, fee: num(b!.fee)! / 100 }] : []))
      .sort((a, b) => a.min - b.min);
    const cost = num(r.deliveryCost);
    const slug = str(r.uniqueName);
    return [
      {
        name,
        ...(num(lat) !== undefined && num(lon) !== undefined ? { location: { lat: num(lat)!, lon: num(lon)! } } : {}),
        ...(minutesOk(low) && minutesOk(high) ? { eta: { low: Math.min(low, high), high: Math.max(low, high) } } : {}),
        ...(bands.length ? { feeBands: bands } : cost !== undefined && cost >= 0 ? { feeBands: [{ min: 0, fee: cost }] } : {}),
        ...(typeof r.isOpenNowForDelivery === "boolean" ? { openNow: r.isOpenNowForDelivery } : {}),
        ...(slug && /^[a-z0-9-]+$/i.test(slug) ? { url: `https://www.just-eat.co.uk/restaurants-${slug}/menu` } : {}),
      },
    ];
  });
}

/** The fee for a basket of `orderValue` pounds: the band with the highest minimum it reaches (the first band if none). */
export function feeForOrder(bands: { min: number; fee: number }[] | undefined, orderValue: number): number | undefined {
  if (!bands?.length) return undefined;
  const reached = bands.filter((b) => b.min <= orderValue);
  return (reached.length ? reached[reached.length - 1]! : bands[0]!).fee;
}

/* ---------- Deliveroo ---------- */

const MILE = 1609.344;

/** Restaurant cards from a Deliveroo listing page's `__NEXT_DATA__`. Deliveroo shows no fee on the listing. */
export function parseDeliveroo(html: string): PlatformListing[] {
  const json = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!json) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const cards: Raw[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 40 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Raw;
    if (typeof o["partner-name.content"] === "string") return void cards.push(o);
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(data, 0);

  const seen = new Set<string>();
  return cards.flatMap((c): PlatformListing[] => {
    const params = obj(obj(obj(c["partner-card.on-tap"])?.action)?.parameters);
    const name = str(params?.restaurant_name) ?? str(c["partner-name.content"]);
    const href = str(params?.restaurant_href);
    const key = str(params?.restaurant_id) ?? href ?? name;
    if (!name || !key || seen.has(key)) return [];
    seen.add(key);
    const time = /(\d+)(?:\s*[-–]\s*(\d+))?/.exec(str(c["home-units-delivery-time.content"]) ?? "");
    const low = time ? Number(time[1]) : undefined;
    const high = time?.[2] ? Number(time[2]) : low;
    const miles = /([\d.]+)\s*mi/.exec(str(c["distance-presentational.content"]) ?? "");
    const path = href?.startsWith("/menu/") ? href.split("?")[0] : undefined;
    return [
      {
        name,
        ...(miles ? { distanceMeters: Math.round(Number(miles[1]) * MILE) } : {}),
        ...(minutesOk(low) && minutesOk(high) ? { eta: { low, high } } : {}),
        // Closed and not-yet-open cards carry an "opening-at" line ("Back soon", "Opens at 11:00").
        openNow: !str(c["opening-at.content"]),
        ...(path ? { url: `https://deliveroo.co.uk${path}` } : {}),
      },
    ];
  });
}

/* ---------- matching ---------- */

/** Words that say nothing about which restaurant it is. */
const FILLER = new Set(["the", "restaurant", "oxford", "and", "bar", "cafe", "kitchen", "ltd", "uk", "co"]);

/** Lowercase words without accents, punctuation or filler: "Côte Brasserie - Oxford" → ["cote", "brasserie"]. */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`®™]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !FILLER.has(t));
}

/** A name and its brand part: platforms append the branch ("Five Guys - Burgers, Fries & Shakes - Oxford"). */
const variants = (name: string) => [...new Set([name, name.split(/\s[-–|]\s|\(/)[0]!])].map(nameTokens).filter((t) => t.length);

/** 0–1: 1 for the same name, 0.85 when one name is the other plus extra words, otherwise word overlap. */
export function nameScore(a: string, b: string): number {
  let best = 0;
  for (const ta of variants(a)) {
    for (const tb of variants(b)) {
      if (ta.join("") === tb.join("")) return 1;
      const sa = new Set(ta);
      const sb = new Set(tb);
      const shared = [...sa].filter((t) => sb.has(t)).length;
      const smaller = sa.size <= sb.size ? ta : tb;
      // "Dishoom" in "Dishoom Oxford Westgate" counts; a bare "pizza" in "Pizza Hut" doesn't.
      const contained = shared === Math.min(sa.size, sb.size) && smaller.join("").length >= 6 ? 0.85 : 0;
      best = Math.max(best, contained, shared / new Set([...sa, ...sb]).size);
    }
  }
  return best;
}

/** How far a listing may sit from the Places pin and still be the same restaurant. */
export const MATCH_RADIUS_M = 300;
/** Names at least this alike can match. */
export const MIN_NAME_SCORE = 0.6;
/** With only a distance from the venue (Deliveroo), the name has to agree more. */
const MIN_NAME_SCORE_NO_PIN = 0.85;
/** Deliveroo rounds distance to 0.1 mi. */
const DISTANCE_SLACK_M = 0.05 * MILE;

/**
 * The listing for `place`, or undefined. Same restaurant = alike names (normalised) and within
 * ~300 m: by coordinates when the platform gives them, otherwise by distance from the venue.
 * Several candidates: the best name wins, then the nearest.
 */
export function matchListing(place: Pick<PlaceResult, "name" | "lat" | "lon" | "distanceMeters">, listings: PlatformListing[]): PlatformListing | undefined {
  let best: { listing: PlatformListing; score: number; gap: number } | undefined;
  for (const listing of listings) {
    const score = nameScore(place.name, listing.name);
    let gap: number;
    if (listing.location) {
      gap = distanceMeters(place, listing.location);
      if (score < MIN_NAME_SCORE) continue;
    } else if (listing.distanceMeters !== undefined) {
      if (score < MIN_NAME_SCORE_NO_PIN) continue;
      // The listed distance may be by road, up to ~1.4× the straight line Places gives.
      const d = listing.distanceMeters;
      gap = Math.max(0, d < place.distanceMeters ? place.distanceMeters - d : d - place.distanceMeters * 1.4) - DISTANCE_SLACK_M;
      gap = Math.max(0, gap);
    } else continue;
    if (gap > MATCH_RADIUS_M) continue;
    if (!best || score > best.score || (score === best.score && gap < best.gap)) best = { listing, score, gap };
  }
  return best?.listing;
}
