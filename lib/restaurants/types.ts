import type { ListingSnapshot } from "@/lib/restaurants/listings";
import type { DeliveryPlatform, Dietary, Estimate, Restaurant } from "@/lib/types";

/* Types internal to the restaurants pipeline. What leaves it is a `RankedRestaurant`,
   which is a shared `Restaurant` plus ranking fields, so other views can use it as-is. */

/** Day 0 = Sunday, minutes since local (Europe/London) midnight. Mirrors Places `regularOpeningHours`. */
export type OpeningPoint = { day: number; minutes: number };
/** No `close` = open around the clock. */
export type OpeningPeriod = { open: OpeningPoint; close?: OpeningPoint };

/** A yes/no estimate with provenance, e.g. "takes catering orders". */
export type Flag = Omit<Estimate, "value"> & { value: boolean };

export type Platform = Exclude<DeliveryPlatform, "direct">;
export const PLATFORMS: { id: Platform; label: string; site: string }[] = [
  { id: "ubereats", label: "Uber Eats", site: "ubereats.com" },
  { id: "deliveroo", label: "Deliveroo", site: "deliveroo.co.uk" },
  { id: "justeat", label: "Just Eat", site: "just-eat.co.uk" },
];

/** One delivery platform for one restaurant, whether or not it is listed there. */
export type PlatformQuote = {
  platform: Platform;
  available: Flag;
  /** Delivery fee for the whole order, GBP. */
  fee: Estimate;
  /** Order to door, minutes: the platform's own figure (plus bulk cooking time) when scraped, else prep + travel + dispatch. */
  eta: Estimate;
  /** When the platform's listing was read (ISO). Only set when this quote matched a scraped listing. */
  checkedAt?: string;
  /** Listing if known, otherwise a search for it. */
  url: string;
};

/** What Places (or the seed) says about a restaurant. Facts, not estimates. */
export type PlaceResult = {
  id: string;
  placeId?: string;
  name: string;
  cuisine: string;
  address: string;
  lat: number;
  lon: number;
  /** Straight-line distance from the venue. */
  distanceMeters: number;
  rating?: number;
  ratingCount?: number;
  priceLevel?: 1 | 2 | 3 | 4;
  /** Per-person range from Places, GBP. */
  priceRange?: { low: number; high: number };
  openingPeriods?: OpeningPeriod[];
  /** Human-readable, one line per day. */
  hours?: string[];
  mapsUrl: string;
  websiteUrl?: string;
  /** First Places photo: its resource name (never sent to the browser) and author. */
  photo?: { name: string; credit?: { name: string; url?: string } };
  /** Dietary needs the place is known or likely to cover. */
  serves: Dietary[];
};

/** Gemini (grounded) or heuristic estimates for one restaurant. */
export type RestaurantEstimates = {
  /** Bulk-order cost per head, GBP. */
  costPerHead: Estimate;
  /** Offers catering / takes bulk orders. */
  catering: Flag;
  /** Kitchen time for the whole bulk order, minutes. */
  prepMinutes: Estimate;
  platforms: Omit<PlatformQuote, "eta" | "checkedAt">[];
};

/** One restaurant's driving time to the venue from the Routes API. */
export type RouteTime = {
  seconds: number;
  /** Departure the traffic model used (ISO); absent = current traffic. */
  departAt?: string;
};

/** Live figures that beat the estimates when present: scraped platform listings and Routes drive times by place id. */
export type LiveTimes = {
  listings: ListingSnapshot[];
  routes: Record<string, RouteTime>;
};

/** live = fresh API calls, cache = served from cache, fallback = seeded Oxford data. */
export type DataSource = "live" | "cache" | "fallback";

export type RankedRestaurant = Restaurant & {
  catering: Flag;
  /** Every platform, listed or not, for the comparison table. `delivery` holds only the usable ones. */
  platforms: PlatformQuote[];
  openingPeriods?: OpeningPeriod[];
  /** Order to door: the fastest scraped platform ETA, else prep + travel (Routes, then the distance heuristic). */
  eta: Estimate;
  /** Whose listing `eta` came from; absent when it's prep + travel. */
  etaPlatform?: Platform;
  /** `eta.value`, the figure ranking and `orderBy` use. */
  etaMinutes: number;
  /** Latest time to order for food to arrive by the slot (ISO). */
  orderBy: string;
  /** costPerHead × headcount, GBP (before delivery). */
  totalCost: number;
  /** null when opening hours are unknown. */
  openAtSlot: boolean | null;
  /** 0–1, higher is better. */
  score: number;
  source: DataSource;
};
