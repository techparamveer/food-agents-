import { distanceMeters, type LatLon } from "@/lib/restaurants/geo";
import type { OpeningPeriod, PlaceResult } from "@/lib/restaurants/types";
import type { Dietary } from "@/lib/types";

/** Pure mapping from Places API (New) JSON to PlaceResult. No fetch, no env: safe for scripts/test-*.ts. */

type ApiPoint = { day?: number; hour?: number; minute?: number };
type ApiMoney = { currencyCode?: string; units?: string | number; nanos?: number };
type ApiPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  websiteUri?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  priceRange?: { startPrice?: ApiMoney; endPrice?: ApiMoney };
  regularOpeningHours?: { periods?: { open?: ApiPoint; close?: ApiPoint }[]; weekdayDescriptions?: string[] };
  servesVegetarianFood?: boolean;
  businessStatus?: string;
  photos?: { name?: string; googleMapsUri?: string; authorAttributions?: { displayName?: string; uri?: string }[] }[];
};

/** The first photo with a usable resource name, and who to credit for it. */
export function photoFrom(photos: ApiPlace["photos"]): PlaceResult["photo"] {
  const photo = photos?.find((p) => typeof p.name === "string" && /^places\/[^/]+\/photos\/[^/]+$/.test(p.name));
  if (!photo?.name) return undefined;
  const author = photo.authorAttributions?.find((a) => a.displayName?.trim());
  const url = author?.uri && /^https:\/\//.test(author.uri) ? author.uri : undefined;
  const mapsUrl = photo.googleMapsUri && /^https:\/\//.test(photo.googleMapsUri) ? photo.googleMapsUri : undefined;
  return {
    name: photo.name,
    ...(mapsUrl ? { mapsUrl } : {}),
    credit: author?.displayName ? { name: author.displayName.trim(), ...(url ? { url } : {}) } : undefined,
  };
}

const PRICE_LEVELS: Record<string, 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** Places enum → the shared 1–4 scale. Free and unspecified have no level. */
export function priceLevelFrom(value: string | undefined): 1 | 2 | 3 | 4 | undefined {
  return value ? PRICE_LEVELS[value] : undefined;
}

const money = (m: ApiMoney | undefined) =>
  m && m.units !== undefined ? Number(m.units) + (m.nanos ?? 0) / 1e9 : undefined;

const titleCase = (s: string) =>
  s
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

/** "pizza_restaurant" → "Pizza". Generic types collapse to "Restaurant" so they don't pollute filters. */
export function cuisineFrom(primaryType: string | undefined, types: string[] = [], label?: string): string {
  const pick = [primaryType, ...types].find((t) => t && t.endsWith("_restaurant") && t !== "fast_food_restaurant");
  if (pick) return titleCase(pick.replace(/_restaurant$/, ""));
  if (primaryType === "fast_food_restaurant" || types.includes("fast_food_restaurant")) return "Fast food";
  if (primaryType === "sandwich_shop") return "Sandwiches";
  if (primaryType === "cafe" || primaryType === "coffee_shop") return "Café";
  if (primaryType === "bakery") return "Bakery";
  if (label && !/restaurant|takeaway|delivery/i.test(label)) return label;
  return "Restaurant";
}

function periodsFrom(raw: ApiPlace["regularOpeningHours"]): OpeningPeriod[] | undefined {
  const out: OpeningPeriod[] = [];
  for (const p of raw?.periods ?? []) {
    if (p.open?.day === undefined) continue;
    out.push({
      open: { day: p.open.day, minutes: (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0) },
      // No close point means open 24 hours (Places convention).
      close:
        p.close?.day !== undefined ? { day: p.close.day, minutes: (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0) } : undefined,
    });
  }
  return out.length ? out : undefined;
}

/** Dietary coverage: Places facts where it has them, cuisine hints otherwise (shown as estimates in the UI). */
export function servesFrom(cuisine: string, types: string[] = [], vegetarian?: boolean, name = ""): Dietary[] {
  const tags = new Set<Dietary>();
  if (vegetarian || types.includes("vegetarian_restaurant") || types.includes("vegan_restaurant")) tags.add("veg");
  if (types.includes("vegan_restaurant")) tags.add("vegan");
  if (/indian|middle eastern|lebanese|turkish|thai|vegan|ethiopian/i.test(cuisine)) tags.add("veg").add("vegan");
  if (/pizza|italian|mediterranean|mexican|japanese|chinese/i.test(cuisine)) tags.add("veg");
  if (/middle eastern|lebanese|turkish|pakistani|afghan|persian/i.test(cuisine) || /halal/i.test(name)) tags.add("halal");
  if (/japanese|thai|indian|mexican|vietnamese|korean/i.test(cuisine)) tags.add("gf");
  return (["veg", "vegan", "halal", "gf"] as Dietary[]).filter((d) => tags.has(d));
}

export function parsePlacesResponse(body: unknown, center: LatLon): PlaceResult[] {
  const places = (body as { places?: ApiPlace[] } | null)?.places;
  if (!Array.isArray(places)) return [];
  const out: PlaceResult[] = [];
  for (const p of places) {
    const name = p.displayName?.text?.trim();
    const lat = p.location?.latitude;
    const lon = p.location?.longitude;
    if (!p.id || !name || typeof lat !== "number" || typeof lon !== "number") continue;
    if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
    const cuisine = cuisineFrom(p.primaryType, p.types, p.primaryTypeDisplayName?.text);
    const start = money(p.priceRange?.startPrice);
    const end = money(p.priceRange?.endPrice);
    const address = p.shortFormattedAddress ?? p.formattedAddress ?? "";
    out.push({
      id: `place-${p.id}`,
      placeId: p.id,
      name,
      cuisine,
      address,
      lat,
      lon,
      distanceMeters: Math.round(distanceMeters(center, { lat, lon })),
      rating: typeof p.rating === "number" ? p.rating : undefined,
      ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : undefined,
      priceLevel: priceLevelFrom(p.priceLevel),
      priceRange: start !== undefined ? { low: start, high: end ?? start } : undefined,
      openingPeriods: periodsFrom(p.regularOpeningHours),
      hours: p.regularOpeningHours?.weekdayDescriptions,
      mapsUrl: p.googleMapsUri ?? mapsSearchUrl(name, address),
      websiteUrl: p.websiteUri,
      photo: photoFrom(p.photos),
      serves: servesFrom(cuisine, p.types, p.servesVegetarianFood, name),
    });
  }
  return out;
}

export function mapsSearchUrl(name: string, address?: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(", "))}`;
}
