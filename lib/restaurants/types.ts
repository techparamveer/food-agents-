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
  /** Prep + travel + platform dispatch, minutes. */
  etaMinutes: number;
  /** Listing if known, otherwise a search for it. */
  url: string;
};

/** Realistic order-to-door window for the Andrew Wiles Building, in minutes. */
export type EtaRange = {
  shortestMinutes: number;
  longestMinutes: number;
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
  /** First Places photo: its resource name (never sent to the browser), source and author. */
  photo?: { name: string; mapsUrl?: string; credit?: { name: string; url?: string } };
  /** Dietary needs the place is known or likely to cover. */
  serves: Dietary[];
  /** Explicit sample range used only by the seeded fallback restaurants. */
  mockEtaRange?: EtaRange;
};

/** Gemini (grounded) or heuristic estimates for one restaurant. */
export type RestaurantEstimates = {
  /** Bulk-order cost per head, GBP. */
  costPerHead: Estimate;
  /** Offers catering / takes bulk orders. */
  catering: Flag;
  /** Kitchen time for the whole bulk order, minutes. */
  prepMinutes: Estimate;
  /** Shortest and longest order-to-building times returned by Gemini, or a labelled fallback. */
  etaRange: EtaRange & { source: Estimate["source"] };
  platforms: Omit<PlatformQuote, "etaMinutes">[];
};

/** live = fresh API calls, cache = served from cache, fallback = seeded Oxford data. */
export type DataSource = "live" | "cache" | "fallback";

export type RankedRestaurant = Restaurant & {
  catering: Flag;
  /** Every platform, listed or not, for the comparison table. `delivery` holds only the usable ones. */
  platforms: PlatformQuote[];
  openingPeriods?: OpeningPeriod[];
  /** prepMinutes + travelMinutes. */
  etaMinutes: number;
  /** Shortest and longest order-to-building times. */
  etaRange: RestaurantEstimates["etaRange"];
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
