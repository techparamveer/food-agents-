import { directionsUrl, etaMinutes, orderByTime, travelMinutes, type LatLon } from "@/lib/restaurants/geo";
import { isOpenAt } from "@/lib/restaurants/hours";
import type { DataSource, PlaceResult, Platform, RankedRestaurant, RestaurantEstimates } from "@/lib/restaurants/types";
import type { DeliveryOption, Dietary, DietaryMix } from "@/lib/types";

/** How much each signal counts in the default "Best" ranking. */
export const WEIGHTS = { cost: 0.45, eta: 0.3, rating: 0.25 } as const;
/** Extra weight for covering the event's dietary mix, when one is given. */
export const DIETARY_WEIGHT = 0.15;

/** Platform dispatch overhead on top of prep + travel (courier assignment, batching). */
const DISPATCH_MINUTES: Record<Platform, number> = { ubereats: 3, deliveroo: 4, justeat: 6 };

/** Tile colours from the scaffold's seed palette, picked by name so they stay stable. */
const TILE_COLORS = ["#c2410c", "#15803d", "#b45309", "#a16207", "#be123c", "#0f766e", "#7c3aed", "#1d4ed8"];

export type RestaurantFilters = {
  cuisines?: string[];
  /** Every listed need must be covered. */
  dietary?: Dietary[];
  /** Drop places known to be closed at the slot. Unknown hours are kept. */
  openAtSlot?: boolean;
  maxPerHead?: number;
};

export type SortKey = "best" | "cost" | "eta" | "rating";

/** Rating on 0–1, shrunk toward neutral when few people have rated. */
export function ratingScore(rating: number | undefined, count = 0): number {
  if (rating === undefined) return 0.5;
  const raw = Math.min(1, Math.max(0, (rating - 3) / 2));
  const confidence = Math.min(1, count / 50);
  return 0.5 + (raw - 0.5) * confidence;
}

/** Share of the event's special-diet attendees this place can feed, 0–1 (1 when nobody has a need). */
export function dietaryCoverage(serves: Dietary[], mix: DietaryMix | undefined): number {
  if (!mix) return 1;
  const needs = Object.entries(mix) as [Dietary, number][];
  const total = needs.reduce((n, [, share]) => n + share, 0);
  if (total <= 0) return 1;
  return needs.reduce((n, [d, share]) => n + (serves.includes(d) ? share : 0), 0) / total;
}

const spread = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });
/** Lower-is-better value → 0–1 (1 = best). A flat field scores everyone 1. */
const lowerIsBetter = (v: number, { min, max }: { min: number; max: number }) => (max === min ? 1 : (max - v) / (max - min));

function tileColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length]!;
}

/** Join places with estimates into shared Restaurants with ETA, totals and a composite score. Unfiltered, unsorted. */
export function scoreRestaurants(
  places: PlaceResult[],
  estimates: Map<string, RestaurantEstimates>,
  {
    headcount,
    slot,
    source,
    venue,
    dietaryMix,
  }: { headcount: number; slot: Date; source: DataSource; venue: LatLon; dietaryMix?: DietaryMix },
): RankedRestaurant[] {
  const rows = places.flatMap((place): RankedRestaurant[] => {
    const est = estimates.get(place.id);
    if (!est) return [];
    const travel = travelMinutes(place.distanceMeters);
    const eta = etaMinutes(est.prepMinutes.value, place.distanceMeters);
    const platforms = est.platforms.map((q) => ({ ...q, etaMinutes: eta + DISPATCH_MINUTES[q.platform] }));
    const delivery: DeliveryOption[] = platforms
      .filter((q) => q.available.value)
      .map((q) => ({ platform: q.platform, url: q.url, fee: q.fee, eta: { value: q.etaMinutes, source: est.prepMinutes.source, isEstimate: true } }));
    if (est.catering.value) {
      delivery.push({
        platform: "direct",
        url: place.websiteUrl ?? place.mapsUrl,
        fee: { value: 0, source: { label: "Collect or arrange with the restaurant", url: place.mapsUrl }, isEstimate: true },
        eta: { value: eta, source: est.prepMinutes.source, isEstimate: true },
      });
    }
    return [
      {
        id: place.id,
        placeId: place.placeId,
        name: place.name,
        cuisine: place.cuisine,
        address: place.address,
        lat: place.lat,
        lon: place.lon,
        distanceKm: Math.round(place.distanceMeters / 100) / 10,
        rating: place.rating,
        ratingCount: place.ratingCount,
        priceLevel: place.priceLevel,
        hours: place.hours,
        serves: place.serves,
        costPerHead: est.costPerHead,
        prepMinutes: est.prepMinutes,
        travelMinutes: {
          value: travel,
          source: { label: "Distance at courier speed (15 km/h, 1.3× road factor, +5 min handover)", url: directionsUrl(place, venue) },
          isEstimate: true,
        },
        delivery,
        websiteUrl: place.websiteUrl,
        mapsUrl: place.mapsUrl,
        ...(place.websiteUrl && place.placeId ? { logoUrl: `/api/restaurants/logo?place=${encodeURIComponent(place.placeId)}` } : {}),
        ...(place.photo && place.placeId
          ? {
              photoUrl: `/api/restaurants/photo?place=${encodeURIComponent(place.placeId)}`,
              photoMapsUrl: place.photo.mapsUrl,
              photoCredit: place.photo.credit,
            }
          : {}),
        color: tileColor(place.name),
        monogram: place.name.replace(/^the\s+/i, "").charAt(0).toUpperCase(),
        catering: est.catering,
        platforms,
        openingPeriods: place.openingPeriods,
        etaMinutes: eta,
        orderBy: orderByTime(slot, eta).toISOString(),
        totalCost: Math.round(est.costPerHead.value * headcount * 100) / 100,
        openAtSlot: isOpenAt(place.openingPeriods, slot),
        score: 0,
        source,
      },
    ];
  });
  if (!rows.length) return rows;
  const cost = spread(rows.map((r) => r.costPerHead.value));
  const eta = spread(rows.map((r) => r.etaMinutes));
  const dietWeight = dietaryMix ? DIETARY_WEIGHT : 0;
  for (const r of rows) {
    const base =
      WEIGHTS.cost * lowerIsBetter(r.costPerHead.value, cost) +
      WEIGHTS.eta * lowerIsBetter(r.etaMinutes, eta) +
      WEIGHTS.rating * ratingScore(r.rating, r.ratingCount);
    const s = (base + dietWeight * dietaryCoverage(r.serves, dietaryMix)) / (1 + dietWeight);
    // Closed at the slot: keep visible (organisers may pre-order) but sink it.
    r.score = Math.round((r.openAtSlot === false ? s * 0.5 : s) * 1000) / 1000;
  }
  return rows;
}

export function filterRestaurants(rows: RankedRestaurant[], f: RestaurantFilters): RankedRestaurant[] {
  const cuisines = f.cuisines?.map((c) => c.toLowerCase()) ?? [];
  return rows.filter(
    (r) =>
      (cuisines.length === 0 || cuisines.includes(r.cuisine.toLowerCase())) &&
      (f.dietary ?? []).every((d) => r.serves.includes(d)) &&
      (!f.openAtSlot || r.openAtSlot !== false) &&
      (f.maxPerHead === undefined || r.costPerHead.value <= f.maxPerHead),
  );
}

export function sortRestaurants(rows: RankedRestaurant[], key: SortKey = "best"): RankedRestaurant[] {
  const by: Record<SortKey, (a: RankedRestaurant, b: RankedRestaurant) => number> = {
    best: (a, b) => b.score - a.score,
    cost: (a, b) => a.costPerHead.value - b.costPerHead.value,
    eta: (a, b) => a.etaMinutes - b.etaMinutes,
    rating: (a, b) => ratingScore(b.rating, b.ratingCount) - ratingScore(a.rating, a.ratingCount),
  };
  return [...rows].sort((a, b) => by[key](a, b) || b.score - a.score || a.name.localeCompare(b.name));
}
