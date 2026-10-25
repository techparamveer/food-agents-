import { distanceMeters } from "@/lib/restaurants/geo";
import { daily, describeHours } from "@/lib/restaurants/hours";
import { mapsSearchUrl } from "@/lib/restaurants/parse-places";
import type { OpeningPeriod, PlaceResult } from "@/lib/restaurants/types";
import { OXHACK_EVENT } from "@/lib/seed/oxhack";
import type { Dietary, Venue } from "@/lib/types";

/** Searches centre on the event venue unless the caller passes another. */
export const DEFAULT_VENUE: Venue = OXHACK_EVENT.venue;

type Seed = {
  name: string;
  cuisine: string;
  address: string;
  lat: number;
  lon: number;
  rating: number;
  ratingCount: number;
  priceLevel: 1 | 2 | 3 | 4;
  hours: OpeningPeriod[];
  serves: Dietary[];
};

const h = (hour: number, minute = 0) => hour * 60 + minute;
/**
 * Three fictional, Oxford-style restaurants used whenever Places is unavailable.
 * Every value is sample data and the UI labels the result accordingly.
 */
const SEEDS: Seed[] = [
  {
    name: "Covered Market Pizza Co.",
    cuisine: "Pizza",
    address: "Market Street, Oxford OX1 3DZ",
    lat: 51.7524,
    lon: -1.2571,
    rating: 4.5,
    ratingCount: 842,
    priceLevel: 1,
    hours: daily(h(11), h(23)),
    serves: ["veg", "vegan", "gf"],
  },
  {
    name: "Gloucester Green Falafel",
    cuisine: "Middle Eastern",
    address: "Gloucester Green, Oxford OX1 2BU",
    lat: 51.7543,
    lon: -1.2627,
    rating: 4.7,
    ratingCount: 516,
    priceLevel: 1,
    hours: daily(h(10), h(23, 30)),
    serves: ["veg", "vegan", "halal"],
  },
  {
    name: "Cowley Road Curry House",
    cuisine: "Indian",
    address: "Cowley Road, Oxford OX4 1JE",
    lat: 51.7466,
    lon: -1.2396,
    rating: 4.4,
    ratingCount: 731,
    priceLevel: 2,
    hours: daily(h(11, 30), h(23)),
    serves: ["veg", "vegan", "halal", "gf"],
  },
];

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Fallback restaurants as PlaceResults, with distances measured from `venue`. */
export function seedPlaces(venue: Venue = DEFAULT_VENUE): PlaceResult[] {
  return SEEDS.map((s) => ({
    id: `seed-${slug(s.name)}`,
    name: s.name,
    cuisine: s.cuisine,
    address: s.address,
    lat: s.lat,
    lon: s.lon,
    distanceMeters: Math.round(distanceMeters(venue, { lat: s.lat, lon: s.lon })),
    rating: s.rating,
    ratingCount: s.ratingCount,
    priceLevel: s.priceLevel,
    openingPeriods: s.hours,
    hours: describeHours(s.hours),
    mapsUrl: mapsSearchUrl(s.name, s.address),
    serves: s.serves,
  }));
}
