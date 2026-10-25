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
const WEEKDAYS = [1, 2, 3, 4, 5];
const NOT_MONDAY = [0, 2, 3, 4, 5, 6];

/**
 * Realistic central-Oxford restaurants used whenever Places is unavailable.
 * Ratings, counts and hours are representative, not live: the UI labels the whole list as offline data.
 */
const SEEDS: Seed[] = [
  { name: "Gee's", cuisine: "Mediterranean", address: "61 Banbury Rd, Oxford OX2 6PE", lat: 51.7631, lon: -1.2597, rating: 4.4, ratingCount: 1210, priceLevel: 3, hours: daily(h(9), h(22, 30)), serves: ["veg", "vegan", "gf"] },
  { name: "Branca", cuisine: "Italian", address: "111 Walton St, Oxford OX2 6AJ", lat: 51.7593, lon: -1.2662, rating: 4.3, ratingCount: 1480, priceLevel: 2, hours: daily(h(12), h(22)), serves: ["veg", "vegan", "gf"] },
  { name: "Al-Shami", cuisine: "Lebanese", address: "25 Walton Crescent, Oxford OX1 2JG", lat: 51.7578, lon: -1.265, rating: 4.4, ratingCount: 890, priceLevel: 2, hours: daily(h(12), h(23)), serves: ["veg", "vegan", "halal"] },
  { name: "Pierre Victoire Bistrot", cuisine: "French", address: "9 Little Clarendon St, Oxford OX1 2HP", lat: 51.7586, lon: -1.2621, rating: 4.5, ratingCount: 1620, priceLevel: 2, hours: daily(h(12), h(22)), serves: ["veg"] },
  { name: "Côte Oxford", cuisine: "French", address: "23–25 Little Clarendon St, Oxford OX1 2HU", lat: 51.7588, lon: -1.2617, rating: 4.2, ratingCount: 1150, priceLevel: 2, hours: daily(h(8), h(22)), serves: ["veg", "gf"] },
  { name: "Zheng", cuisine: "Malaysian", address: "82 Walton St, Oxford OX2 6EA", lat: 51.7586, lon: -1.2648, rating: 4.3, ratingCount: 640, priceLevel: 2, hours: daily(h(17, 30), h(22, 30), NOT_MONDAY), serves: ["veg", "vegan", "halal"] },
  { name: "Turl Street Kitchen", cuisine: "British", address: "16–17 Turl St, Oxford OX1 3DH", lat: 51.7536, lon: -1.2567, rating: 4.4, ratingCount: 1030, priceLevel: 2, hours: daily(h(8), h(23)), serves: ["veg", "vegan"] },
  { name: "Edamame", cuisine: "Japanese", address: "15 Holywell St, Oxford OX1 3SA", lat: 51.755, lon: -1.2526, rating: 4.6, ratingCount: 980, priceLevel: 1, hours: daily(h(11, 30), h(20, 30), [3, 4, 5, 6, 0]), serves: ["veg", "vegan", "gf"] },
  { name: "Chiang Mai Kitchen", cuisine: "Thai", address: "Kemp Hall Passage, 130a High St, Oxford OX1 4DH", lat: 51.7521, lon: -1.2571, rating: 4.3, ratingCount: 1340, priceLevel: 2, hours: daily(h(12), h(22, 30)), serves: ["veg", "vegan", "gf"] },
  { name: "PizzaExpress Golden Cross", cuisine: "Pizza", address: "8 Golden Cross, Cornmarket St, Oxford OX1 3EU", lat: 51.7525, lon: -1.2583, rating: 4.2, ratingCount: 1890, priceLevel: 2, hours: daily(h(11, 30), h(22, 30)), serves: ["veg", "vegan", "gf"] },
  { name: "Nando's Oxford George Street", cuisine: "Chicken", address: "4–5 George St, Oxford OX1 2AT", lat: 51.7541, lon: -1.2614, rating: 4.0, ratingCount: 2350, priceLevel: 1, hours: daily(h(11, 30), h(22, 30)), serves: ["veg", "vegan", "halal", "gf"] },
  { name: "Wagamama Oxford Westgate", cuisine: "Japanese", address: "Westgate Centre, Queen St, Oxford OX1 1PB", lat: 51.7497, lon: -1.2608, rating: 4.2, ratingCount: 1720, priceLevel: 2, hours: daily(h(11, 30), h(22)), serves: ["veg", "vegan", "gf"] },
  { name: "Atomic Burger", cuisine: "Burgers", address: "96 Cowley Rd, Oxford OX4 1JE", lat: 51.748, lon: -1.2389, rating: 4.4, ratingCount: 2650, priceLevel: 2, hours: daily(h(12), h(22)), serves: ["veg", "vegan"] },
  { name: "Arbequina", cuisine: "Spanish", address: "74 Cowley Rd, Oxford OX4 1JB", lat: 51.7491, lon: -1.241, rating: 4.6, ratingCount: 860, priceLevel: 2, hours: daily(h(17), h(22), WEEKDAYS).concat(daily(h(12), h(22), [6])), serves: ["veg", "gf"] },
  { name: "Mamma Mia Pizzeria", cuisine: "Pizza", address: "8 South Parade, Oxford OX2 7JL", lat: 51.7739, lon: -1.2659, rating: 4.5, ratingCount: 1270, priceLevel: 1, hours: daily(h(12), h(22)), serves: ["veg", "vegan", "gf"] },
  { name: "Oli's Thai", cuisine: "Thai", address: "38 Magdalen Rd, Oxford OX4 1RB", lat: 51.7438, lon: -1.2266, rating: 4.7, ratingCount: 1110, priceLevel: 2, hours: daily(h(12), h(14, 30), [2, 3, 4, 5, 6]).concat(daily(h(17, 30), h(21, 30), [2, 3, 4, 5, 6])), serves: ["veg", "vegan", "gf"] },
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
