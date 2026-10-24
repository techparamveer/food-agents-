import assert from "node:assert/strict";
import {
  GEMINI_SOURCE_LABEL,
  extractJsonArray,
  heuristicDeliveryFee,
  heuristicEstimates,
  parseGeminiEstimates,
  responseText,
} from "@/lib/restaurants/estimate-parse";
import { fallbackResult, normaliseInput } from "@/lib/restaurants/find-core";
import { bulkPrepMinutes, distanceMeters, etaMinutes, orderByTime, travelMinutes } from "@/lib/restaurants/geo";
import { daily, describeHours, isOpenAt } from "@/lib/restaurants/hours";
import { cuisineFrom, parsePlacesResponse, priceLevelFrom } from "@/lib/restaurants/parse-places";
import { dietaryCoverage, filterRestaurants, ratingScore, scoreRestaurants, sortRestaurants } from "@/lib/restaurants/rank";
import { DEFAULT_VENUE, seedPlaces } from "@/lib/restaurants/seed";
import type { PlaceResult, RestaurantEstimates } from "@/lib/restaurants/types";

const venue = DEFAULT_VENUE;
/* OxHack weekend. Saturday 24 Oct 2026, 13:00 Oxford time (BST, UTC+1). */
const saturdayLunch = new Date("2026-10-24T12:00:00Z");
/* Clocks go back at 01:00 UTC on Sunday 25 Oct: 19:00 Oxford = 19:00 UTC. */
const sundayDinner = new Date("2026-10-25T19:00:00Z");

/* ---------- ETA maths ---------- */

assert.equal(venue.postcode, "OX2 6GG", "searches centre on the Mathematical Institute");
assert.equal(Math.round(distanceMeters(venue, venue)), 0);
// Mathematical Institute → Carfax is ~1 km as the crow flies.
const carfax = distanceMeters(venue, { lat: 51.7519, lon: -1.2578 });
assert.ok(carfax > 900 && carfax < 1100, `venue → Carfax ${carfax}`);

assert.equal(travelMinutes(0), 5, "handover only at zero distance");
// 1 km × 1.3 road factor at 15 km/h = 5.2 min + 5 handover → 11 (rounded up).
assert.equal(travelMinutes(1000), 11);
assert.equal(travelMinutes(-50), 5, "negative distance clamps");
assert.equal(etaMinutes(30, 1000), 41, "ETA = prep + travel");
assert.equal(bulkPrepMinutes(20), 20);
assert.equal(bulkPrepMinutes(21), 30);
assert.equal(bulkPrepMinutes(150), 50);
assert.equal(bulkPrepMinutes(5000), 120, "prep is capped");
assert.equal(orderByTime(new Date("2026-10-24T17:30:00Z"), 50).toISOString(), "2026-10-24T16:40:00.000Z");

/* ---------- opening hours ---------- */

const lunchOnly = daily(12 * 60, 14 * 60 + 30);
assert.equal(isOpenAt(lunchOnly, saturdayLunch), true);
assert.equal(isOpenAt(lunchOnly, sundayDinner), false);
assert.equal(isOpenAt(undefined, saturdayLunch), null, "unknown hours stay unknown");
const lateNight = daily(18 * 60, 26 * 60); // 18:00 → 02:00
assert.equal(isOpenAt(lateNight, new Date("2026-10-26T01:30:00Z")), true, "past-midnight close");
// Saturday 22:00 → Sunday 03:00 (Places represents as close.day 0); 00:30Z is still BST → Sunday 01:30.
assert.equal(isOpenAt([{ open: { day: 6, minutes: 22 * 60 }, close: { day: 0, minutes: 180 } }], new Date("2026-10-25T00:30:00Z")), true);
assert.equal(isOpenAt([{ open: { day: 0, minutes: 0 } }], sundayDinner), true, "no close = 24h");
assert.equal(describeHours(lunchOnly)[0], "Monday: 12:00–14:30");
assert.equal(describeHours(daily(720, 1320, [6]))[0], "Monday: Closed");

/* ---------- Places response parsing ---------- */

const placesBody = {
  places: [
    {
      id: "ChIJ-branca",
      displayName: { text: "Branca", languageCode: "en" },
      formattedAddress: "111 Walton St, Oxford OX2 6AJ, UK",
      shortFormattedAddress: "111 Walton St, Oxford",
      location: { latitude: 51.7593, longitude: -1.2662 },
      googleMapsUri: "https://maps.google.com/?cid=1",
      primaryType: "italian_restaurant",
      types: ["italian_restaurant", "restaurant", "food"],
      rating: 4.3,
      userRatingCount: 1480,
      priceLevel: "PRICE_LEVEL_MODERATE",
      priceRange: { startPrice: { currencyCode: "GBP", units: "20" }, endPrice: { currencyCode: "GBP", units: "30" } },
      regularOpeningHours: {
        periods: [{ open: { day: 6, hour: 12, minute: 0 }, close: { day: 6, hour: 22, minute: 0 } }],
        weekdayDescriptions: ["Saturday: 12:00–22:00"],
      },
      servesVegetarianFood: true,
      businessStatus: "OPERATIONAL",
    },
    { id: "closed", displayName: { text: "Gone" }, location: { latitude: 51.76, longitude: -1.26 }, businessStatus: "CLOSED_PERMANENTLY" },
    { id: "no-location", displayName: { text: "Nowhere" } },
    { displayName: { text: "No id" }, location: { latitude: 51.76, longitude: -1.26 } },
  ],
};
const parsed = parsePlacesResponse(placesBody, venue);
assert.equal(parsed.length, 1, "drops closed / incomplete places");
const branca = parsed[0]!;
assert.equal(branca.id, "place-ChIJ-branca");
assert.equal(branca.placeId, "ChIJ-branca");
assert.equal(branca.name, "Branca");
assert.equal(branca.address, "111 Walton St, Oxford", "prefers the short address");
assert.equal(branca.cuisine, "Italian");
assert.equal(branca.priceLevel, 2);
assert.deepEqual(branca.priceRange, { low: 20, high: 30 });
assert.equal(branca.mapsUrl, "https://maps.google.com/?cid=1");
assert.ok(branca.serves.includes("veg"));
assert.ok(branca.distanceMeters > 200 && branca.distanceMeters < 400, `distance ${branca.distanceMeters}`);
assert.deepEqual(branca.openingPeriods, [{ open: { day: 6, minutes: 720 }, close: { day: 6, minutes: 1320 } }]);
assert.deepEqual(branca.hours, ["Saturday: 12:00–22:00"]);
assert.deepEqual(parsePlacesResponse({}, venue), []);
assert.deepEqual(parsePlacesResponse(null, venue), []);
assert.equal(priceLevelFrom("PRICE_LEVEL_VERY_EXPENSIVE"), 4);
assert.equal(priceLevelFrom("PRICE_LEVEL_FREE"), undefined);
assert.equal(priceLevelFrom("PRICE_LEVEL_UNSPECIFIED"), undefined);
assert.equal(cuisineFrom("restaurant", ["middle_eastern_restaurant", "restaurant"]), "Middle Eastern");
assert.equal(cuisineFrom("fast_food_restaurant", ["fast_food_restaurant"]), "Fast food");
assert.equal(cuisineFrom("restaurant", ["restaurant"], "Restaurant"), "Restaurant");

/* ---------- Gemini response parsing ---------- */

const geminiBody = {
  candidates: [
    {
      content: {
        parts: [
          { text: "thinking about menus", thought: true },
          {
            text:
              'Here you go:\n```json\n[{"id":"place-ChIJ-branca","costPerHead":{"value":11.5,"low":9,"high":14,"sourceUrl":"https://branca.co.uk/menu"},' +
              '"catering":{"value":true,"sourceUrl":null},"prepMinutes":{"value":"oops"},' +
              '"platforms":[{"platform":"Deliveroo","available":true,"deliveryFee":"£2.49","url":"https://deliveroo.co.uk/menu/oxford/jericho/branca","sourceUrl":"https://deliveroo.co.uk/menu/oxford/jericho/branca"},' +
              '{"platform":"just eat","available":false,"deliveryFee":99}]}]\n```',
          },
        ],
      },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "branca.co.uk" } }],
      },
    },
  ],
};
assert.ok(responseText(geminiBody).startsWith("Here you go"), "thought parts are skipped");
assert.equal(extractJsonArray("no json here"), null);
assert.equal(extractJsonArray("[not json"), null);
assert.deepEqual(extractJsonArray("prefix [1, 2] suffix"), [1, 2]);

const { estimates: gem, grounded } = parseGeminiEstimates(geminiBody, parsed, 150);
assert.equal(grounded, 1);
const g = gem.get(branca.id)!;
assert.equal(g.costPerHead.value, 11.5);
assert.deepEqual(g.costPerHead.source, { label: GEMINI_SOURCE_LABEL, url: "https://branca.co.uk/menu" });
assert.equal(g.costPerHead.isEstimate, true);
assert.equal(g.catering.value, true);
assert.ok(g.catering.source.url!.includes("grounding-api-redirect"), "null sourceUrl falls back to the grounding chunk");
const heuristic = heuristicEstimates(branca, 150);
assert.deepEqual(g.prepMinutes, heuristic.prepMinutes, "bad number falls back to heuristic");
const deliveroo = g.platforms.find((p) => p.platform === "deliveroo")!;
assert.equal(deliveroo.fee.value, 2.49, "£ strings are parsed; platform labels map to ids");
assert.equal(deliveroo.url, "https://deliveroo.co.uk/menu/oxford/jericho/branca");
const justEat = g.platforms.find((p) => p.platform === "justeat")!;
assert.equal(justEat.available.value, false);
assert.deepEqual(justEat.fee, heuristic.platforms.find((p) => p.platform === "justeat")!.fee, "out-of-range fee ignored");
assert.equal(g.platforms.length, 3, "every platform present");

const garbage = parseGeminiEstimates({ candidates: [] }, parsed, 150);
assert.equal(garbage.grounded, 0);
assert.deepEqual(garbage.estimates.get(branca.id), heuristic, "unparseable answer → heuristics");

const unsourced = parseGeminiEstimates(
  { candidates: [{ content: { parts: [{ text: '[{"id":"place-ChIJ-branca","costPerHead":{"value":9}}]' }] } }] },
  parsed,
  150,
);
assert.deepEqual(unsourced.estimates.get(branca.id)!.costPerHead, heuristic.costPerHead, "no source anywhere → not trusted");

for (const value of [g.costPerHead, g.catering, g.prepMinutes, ...g.platforms.flatMap((p) => [p.available, p.fee])]) {
  assert.equal(value.isEstimate, true);
  assert.match(value.source.url ?? "", /^https?:\/\//);
}

assert.equal(heuristicDeliveryFee("ubereats", 1500), 1.49);
assert.equal(heuristicDeliveryFee("deliveroo", 1500), 2.49);
assert.equal(heuristicDeliveryFee("justeat", 1500), 2.99);
assert.equal(heuristicDeliveryFee("ubereats", 0), 0.49, "fees never drop below 49p");

/* ---------- ranking ---------- */

function place(id: string, distance: number, extra: Partial<PlaceResult> = {}): PlaceResult {
  return {
    id,
    name: id,
    cuisine: "Pizza",
    address: "",
    lat: venue.lat,
    lon: venue.lon,
    distanceMeters: distance,
    mapsUrl: `https://maps.example/${id}`,
    serves: ["veg"],
    rating: 4.2,
    ratingCount: 500,
    ...extra,
  };
}
function est(p: PlaceResult, cost: number, prep = 30): RestaurantEstimates {
  const base = heuristicEstimates(p, 150);
  return { ...base, costPerHead: { ...base.costPerHead, value: cost }, prepMinutes: { ...base.prepMinutes, value: prep } };
}

const cheapNear = place("cheap-near", 300);
const cheapFar = place("cheap-far", 4000);
const pricey = place("pricey-near", 300, { rating: 4.8, cuisine: "Japanese", serves: ["veg", "vegan", "gf"] });
const closed = place("closed-at-slot", 50, { openingPeriods: daily(18 * 60, 22 * 60) });
const pool = [cheapNear, cheapFar, pricey, closed];
const estMap = new Map([
  [cheapNear.id, est(cheapNear, 7)],
  [cheapFar.id, est(cheapFar, 7)],
  [pricey.id, est(pricey, 16)],
  [closed.id, est(closed, 7)],
]);
const scored = scoreRestaurants(pool, estMap, { headcount: 150, slot: saturdayLunch, source: "live", venue });
const best = sortRestaurants(scored);
assert.equal(best[0]!.id, "cheap-near", "cheap and near wins");
assert.equal(best.at(-1)!.id, "closed-at-slot", "closed at slot sinks");
assert.ok(scored.find((r) => r.id === "cheap-near")!.score > scored.find((r) => r.id === "cheap-far")!.score, "nearer beats farther");
const near = scored.find((r) => r.id === "cheap-near")!;
assert.equal(near.etaMinutes, 30 + travelMinutes(300));
assert.equal(near.travelMinutes.value, travelMinutes(300));
assert.equal(near.travelMinutes.isEstimate, true);
assert.equal(near.distanceKm, 0.3);
assert.equal(near.totalCost, 1050);
assert.equal(near.orderBy, orderByTime(saturdayLunch, near.etaMinutes).toISOString());
assert.ok(near.platforms.every((q) => q.etaMinutes > near.etaMinutes), "platform ETA adds dispatch");
assert.ok(near.delivery.length > 0 && near.delivery.every((d) => d.eta.value >= near.etaMinutes), "delivery options for the shared type");
assert.ok(near.monogram === "C" && /^#[0-9a-f]{6}$/.test(near.color));
assert.equal(scored.find((r) => r.id === "closed-at-slot")!.openAtSlot, false);

assert.deepEqual(sortRestaurants(scored, "cost").map((r) => r.costPerHead.value).slice(-1), [16]);
assert.equal(sortRestaurants(scored, "rating")[0]!.id, "pricey-near");
assert.equal(sortRestaurants(scored, "eta")[0]!.id, "closed-at-slot");

assert.deepEqual(filterRestaurants(scored, { maxPerHead: 10 }).map((r) => r.id).sort(), ["cheap-far", "cheap-near", "closed-at-slot"]);
assert.deepEqual(filterRestaurants(scored, { dietary: ["vegan"] }).map((r) => r.id), ["pricey-near"]);
assert.deepEqual(filterRestaurants(scored, { cuisines: ["japanese"] }).map((r) => r.id), ["pricey-near"]);
assert.equal(filterRestaurants(scored, { openAtSlot: true }).some((r) => r.id === "closed-at-slot"), false);
assert.equal(filterRestaurants(scored, {}).length, 4);

assert.equal(ratingScore(undefined), 0.5);
assert.equal(ratingScore(5, 1000), 1);
assert.ok(ratingScore(5, 2) < 0.6, "two 5★ reviews barely move the needle");

const mix = { veg: 0.15, vegan: 0.08, halal: 0.04, gf: 0.03 };
assert.equal(dietaryCoverage(["veg", "vegan", "halal", "gf"], mix), 1);
assert.equal(dietaryCoverage([], mix), 0);
assert.equal(dietaryCoverage([], undefined), 1);
const withMix = scoreRestaurants(pool, estMap, { headcount: 150, slot: saturdayLunch, source: "live", venue, dietaryMix: mix });
const gain = (id: string) => withMix.find((r) => r.id === id)!.score - scored.find((r) => r.id === id)!.score;
assert.ok(gain("pricey-near") > gain("cheap-near"), "covering more of the mix ranks higher");

/* ---------- seeded fallback ---------- */

const seeds = seedPlaces();
assert.ok(seeds.length >= 15, `seed has ${seeds.length}`);
assert.equal(new Set(seeds.map((s) => s.id)).size, seeds.length, "seed ids unique");
for (const s of seeds) {
  assert.ok(s.distanceMeters < 5000, `${s.name} is within 5 km`);
  assert.ok(s.openingPeriods?.length && s.hours?.length === 7, `${s.name} has hours`);
}

const input = normaliseInput({ slotTime: "2026-10-24T12:00:00Z", headcount: 150, maxPerHead: 12, dietary: ["veg"] });
assert.equal(input.headcount, 150);
assert.equal(input.venue.name, DEFAULT_VENUE.name, "venue defaults to the event venue");
assert.throws(() => normaliseInput({ slotTime: "not a date", headcount: 10 }));
assert.equal(normaliseInput({ slotTime: saturdayLunch, headcount: 0 }).headcount, 1, "headcount clamps");
assert.deepEqual(normaliseInput({ slotTime: saturdayLunch, headcount: 5, dietary: ["veg", "keto" as "veg"] }).dietary, ["veg"]);

const fb = fallbackResult(input, ["test"]);
assert.equal(fb.source, "fallback");
assert.ok(fb.restaurants.length > 0);
assert.ok(fb.restaurants.every((r) => r.costPerHead.value <= 12 && r.serves.includes("veg") && r.source === "fallback"));
assert.ok(fb.restaurants.every((r) => r.costPerHead.isEstimate && /^https?:\/\//.test(r.costPerHead.source.url ?? "")));
assert.ok(fb.restaurants.every((r) => r.openAtSlot !== false), "open-at-slot filter on by default");
for (let i = 1; i < fb.restaurants.length; i++) {
  assert.ok(fb.restaurants[i - 1]!.score >= fb.restaurants[i]!.score, "fallback sorted best-first");
}
assert.deepEqual(fb.warnings, ["test"]);
assert.ok(fb.cuisines.length >= 8);

console.log("restaurants ok");
