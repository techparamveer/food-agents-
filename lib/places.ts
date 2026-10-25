import "server-only";
import type { LatLon } from "@/lib/restaurants/geo";
import { parsePlacesResponse } from "@/lib/restaurants/parse-places";
import type { PlaceResult } from "@/lib/restaurants/types";

/**
 * Places API (New) Nearby Search around the venue.
 * https://developers.google.com/maps/documentation/places/web-service/nearby-search
 *
 * The field mask asks for exactly what the Restaurants view shows: distance (from location),
 * rating, opening hours, price level/range, maps URL. Rating, hours and price put this on the
 * Nearby Search Enterprise SKU; servesVegetarianFood adds Atmosphere.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.priceRange",
  "places.regularOpeningHours",
  "places.servesVegetarianFood",
].join(",");

/** Places worth feeding a hackathon from (Table A types). */
const INCLUDED_TYPES = ["restaurant", "meal_takeaway", "meal_delivery"];

export type NearbyOptions = {
  center: LatLon;
  radiusMeters?: number;
  maxResults?: number;
  apiKey?: string;
  signal?: AbortSignal;
};

/** Live Nearby Search. Throws on a missing key or any non-2xx so callers can fall back. */
export async function searchNearbyRestaurants({
  center,
  radiusMeters = 1500,
  maxResults = 20,
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
  signal,
}: NearbyOptions): Promise<PlaceResult[]> {
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: INCLUDED_TYPES,
      maxResultCount: Math.min(20, Math.max(1, maxResults)),
      rankPreference: "POPULARITY",
      regionCode: "GB",
      languageCode: "en-GB",
      locationRestriction: {
        circle: { center: { latitude: center.lat, longitude: center.lon }, radius: Math.min(50_000, radiusMeters) },
      },
    }),
    signal: signal ?? AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) {
    // Google error bodies never echo the key, but keep it short anyway.
    const detail = await res.text().catch(() => "");
    throw new Error(`Places searchNearby ${res.status}: ${detail.slice(0, 200)}`);
  }
  return parsePlacesResponse(await res.json(), center);
}

export { mapsSearchUrl, parsePlacesResponse } from "@/lib/restaurants/parse-places";
