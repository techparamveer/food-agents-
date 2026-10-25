import assert from "node:assert/strict";
import { minutesLabel, orderBy } from "@/lib/countdown";
import { extractJsonArray, groundingByRestaurant, heuristicEstimates } from "@/lib/restaurants/estimate-parse";
import { HANDOVER_MINUTES, durationSeconds, parseRouteMatrix, routeTravelMinutes, travelMinutes } from "@/lib/restaurants/geo";
import {
  compactPostcode,
  deliverooListingUrl,
  feeForOrder,
  justEatListingUrl,
  matchListing,
  nameScore,
  nameTokens,
  parseDeliveroo,
  parseJustEat,
  type ListingSnapshot,
  type PlatformListing,
} from "@/lib/restaurants/listings";
import { NORMAL_ORDER_PREP, platformQuote, restaurantEta, scoreRestaurants, travelEstimate } from "@/lib/restaurants/rank";
import { DEFAULT_VENUE } from "@/lib/restaurants/seed";
import type { PlaceResult, RestaurantEstimates } from "@/lib/restaurants/types";
import { costOrder } from "@/lib/planner";
import type { MealSlot } from "@/lib/types";

/* Scraped platform listings, Routes drive times, and which figure wins. */

const venue = DEFAULT_VENUE;
/* Sunday 25 Oct 2026, 19:00 Oxford = 19:00 UTC (clocks went back at 01:00 UTC). */
const dinner = new Date("2026-10-25T19:00:00Z");
const checkedAt = "2026-10-25T17:02:00Z"; // 17:02 in London

/* ---------- URLs ---------- */

assert.equal(compactPostcode("ox2 6gg"), "OX26GG");
assert.equal(justEatListingUrl("OX2 6GG"), "https://uk.api.just-eat.io/discovery/uk/restaurants/enriched/bypostcode/OX26GG");
assert.ok(deliverooListingUrl("OX2 6GG").includes("postcode=OX26GG&collection=all-restaurants"));

/* ---------- Just Eat ---------- */

const justEatBody = {
  restaurants: [
    {
      id: "123",
      name: "Five Guys - Burgers, Fries & Shakes - Oxford",
      uniqueName: "five-guys---oxford-oxford",
      address: { location: { type: "Point", coordinates: [-1.2581, 51.7528] } },
      deliveryEtaMinutes: { rangeLower: 20, rangeUpper: 35 },
      deliveryCost: 1.79,
      isDelivery: true,
      isOpenNowForDelivery: true,
    },
    {
      id: "456",
      name: "Dixy Chicken (Oxford)",
      uniqueName: "dixy-chicken-oxford-iffley",
      address: { location: { coordinates: [-1.2367, 51.7476] } },
      deliveryEtaMinutes: { approximate: 35, rangeLower: 25, rangeUpper: 40 },
      deliveryCost: 3.89,
      isDelivery: true,
      isOpenNowForDelivery: false,
    },
    // Collection only: can't deliver to the venue, so it isn't a listing for us.
    { id: "789", name: "Collect Only Cafe", isDelivery: false, deliveryEtaMinutes: { rangeLower: 10, rangeUpper: 20 } },
    // Junk the parser must survive.
    { id: "999", name: "", isDelivery: true },
    null,
    { id: "1000", name: "No Eta Grill", uniqueName: "bad slug!", isDelivery: true, deliveryEtaMinutes: { rangeLower: 0, rangeUpper: 900 } },
  ],
  deliveryFees: { restaurants: { "123": { bands: [{ minimumAmount: 5000, fee: 0 }, { minimumAmount: 1500, fee: 179 }] } } },
};
const je = parseJustEat(justEatBody);
assert.deepEqual(
  je.map((l) => l.name),
  ["Five Guys - Burgers, Fries & Shakes - Oxford", "Dixy Chicken (Oxford)", "No Eta Grill"],
);
assert.deepEqual(je[0], {
  name: "Five Guys - Burgers, Fries & Shakes - Oxford",
  location: { lat: 51.7528, lon: -1.2581 },
  eta: { low: 20, high: 35 },
  feeBands: [
    { min: 15, fee: 1.79 },
    { min: 50, fee: 0 },
  ],
  openNow: true,
  url: "https://www.just-eat.co.uk/restaurants-five-guys---oxford-oxford/menu",
});
assert.deepEqual(je[1]!.eta, { low: 25, high: 40 }, "the range wins over `approximate`");
assert.deepEqual(je[1]!.feeBands, [{ min: 0, fee: 3.89 }], "no bands: the listed delivery cost");
assert.equal(je[1]!.openNow, false);
assert.equal(je[2]!.eta, undefined, "out-of-range ETAs are dropped");
assert.equal(je[2]!.url, undefined, "a slug that isn't a slug builds no link");
assert.deepEqual(parseJustEat(null), []);
assert.deepEqual(parseJustEat({ restaurants: "nope" }), []);

assert.equal(feeForOrder(je[0]!.feeBands, 10), 1.79, "below every minimum: the first band");
assert.equal(feeForOrder(je[0]!.feeBands, 20), 1.79);
assert.equal(feeForOrder(je[0]!.feeBands, 600), 0, "a bulk basket reaches the free-delivery band");
assert.equal(feeForOrder(undefined, 600), undefined);

/* ---------- Deliveroo ---------- */

const card = (name: string, time: string, miles: string, href: string, extra: Record<string, unknown> = {}) => ({
  "partner-name.content": name,
  "home-units-delivery-time.content": time,
  "distance-presentational.content": miles,
  "partner-card.on-tap": { action: { parameters: { restaurant_name: name, restaurant_href: href, restaurant_id: href } } },
  ...extra,
});
const nextData = {
  props: {
    initialState: {
      home: {
        feed: {
          results: {
            data: [
              { blocks: [card("Wendy's", "15", "0.5 mi", "/menu/Oxford/st-ebbes/wendys-oxford?day=today&postcode=OX26GG&time=ASAP")] },
              {
                data: {
                  carousel: {
                    children: [
                      card("Dishoom", "20 - 30", "0.8 mi", "/menu/Oxford/centre/dishoom-oxford?day=today"),
                      card("Wendy's", "15", "0.5 mi", "/menu/Oxford/st-ebbes/wendys-oxford?day=today&postcode=OX26GG&time=ASAP"),
                      card("Late Kebabs", "", "1.2 mi", "https://evil.example/x", { "opening-at.content": "Back soon" }),
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
};
const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`;
const roo = parseDeliveroo(html);
assert.equal(roo.length, 3, "duplicate cards (feed + carousel) count once");
assert.deepEqual(roo[0], {
  name: "Wendy's",
  distanceMeters: 805,
  eta: { low: 15, high: 15 },
  openNow: true,
  url: "https://deliveroo.co.uk/menu/Oxford/st-ebbes/wendys-oxford",
});
assert.deepEqual(roo[1]!.eta, { low: 20, high: 30 }, "a range if Deliveroo ever shows one");
assert.equal(roo[2]!.openNow, false, "'Back soon' = closed now");
assert.equal(roo[2]!.url, undefined, "only Deliveroo menu paths become links");
assert.equal(roo[2]!.eta, undefined);
assert.deepEqual(parseDeliveroo("<html>no data</html>"), []);
assert.deepEqual(parseDeliveroo('<script id="__NEXT_DATA__">{broken</script>'), []);

/* ---------- name matching ---------- */

assert.deepEqual(nameTokens("Côte Brasserie - Oxford"), ["cote", "brasserie"]);
assert.deepEqual(nameTokens("The Ali’s Kebabs & Bar"), ["alis", "kebabs"]);
assert.equal(nameScore("Five Guys", "Five Guys - Burgers, Fries & Shakes - Oxford"), 1, "brand before ' - '");
assert.equal(nameScore("Ali's Kebabs", "Ali’sKebabs"), 1, "spacing and apostrophes don't matter");
assert.equal(nameScore("Dixy Chicken", "Dixy Chicken (Oxford)"), 1);
assert.equal(nameScore("Dishoom Oxford", "Dishoom"), 1, "'Oxford' is filler");
assert.equal(nameScore("Wagamama", "Wagamama Westgate"), 0.85, "one name inside the other");
assert.ok(nameScore("Pizza", "Pizza Hut Delivery") < 0.6, "a bare generic word isn't enough");
assert.ok(nameScore("Kebab King", "Kebab Kid") < 0.6);
assert.ok(nameScore("Branca", "Gee's") === 0);

function place(id: string, name: string, lat: number, lon: number, distance: number): PlaceResult {
  return { id, name, cuisine: "Burger", address: "", lat, lon, distanceMeters: distance, mapsUrl: `https://maps.example/${id}`, serves: ["veg"] };
}
const fiveGuys = place("p-five", "Five Guys", 51.7531, -1.2585, 754);
const listings: PlatformListing[] = [
  { name: "Five Guys - Oxford Cowley", location: { lat: 51.7476, lon: -1.2367 }, eta: { low: 30, high: 45 } }, // another branch, 1.6 km off
  je[0]!,
];
assert.equal(matchListing(fiveGuys, listings), je[0], "the branch within 300 m, not the other one");
assert.equal(matchListing({ ...fiveGuys, lat: 51.7576, lon: -1.2585 }, [je[0]!]), undefined, "same name 500 m away is a different place");
assert.equal(matchListing(place("p-x", "Branca", 51.7528, -1.2581, 754), [je[0]!]), undefined, "same spot, different name");

// Deliveroo: no pin, only distance from the venue (rounded to 0.1 mi, possibly by road).
const wendys = place("p-wendys", "Wendy's", 51.754, -1.2572, 700);
assert.equal(matchListing(wendys, roo), roo[0]);
assert.equal(matchListing({ ...wendys, distanceMeters: 1800 }, roo), undefined, "distance too different");
assert.equal(matchListing(place("p-d", "Dishoom Westgate", 0, 0, 1290), roo), roo[1], "0.8 mi ≈ 1.29 km");
assert.equal(matchListing(place("p-d", "Dishoom", 0, 0, 1100), roo), roo[1], "a road distance may run longer than the straight line");
assert.equal(matchListing(place("p-d", "Dishoom", 0, 0, 2500), roo), undefined, "listed much nearer than the place: another branch");
assert.equal(matchListing(place("p-k", "Late Night Kebab House", 0, 0, 1930), roo), undefined, "without a pin a loose name isn't enough");

/* ---------- Routes ---------- */

assert.equal(durationSeconds("633s"), 633);
assert.equal(durationSeconds("12.5s"), 12.5);
assert.equal(durationSeconds("10m"), undefined);
assert.equal(durationSeconds(undefined), undefined);
const matrix = [
  { originIndex: 1, destinationIndex: 0, status: {}, duration: "633s", condition: "ROUTE_EXISTS" },
  { destinationIndex: 0, status: {}, duration: "232s", condition: "ROUTE_EXISTS" }, // origin 0: proto3 omits zero
  { originIndex: 2, condition: "ROUTE_NOT_FOUND" },
  { originIndex: 3, status: { code: 5 }, duration: "60s", condition: "ROUTE_EXISTS" },
  { originIndex: 9, duration: "60s", condition: "ROUTE_EXISTS" },
];
assert.deepEqual(parseRouteMatrix(matrix, 4), [232, 633, undefined, undefined]);
assert.deepEqual(parseRouteMatrix({ error: "x" }, 2), [undefined, undefined]);
assert.equal(routeTravelMinutes(232), 4 + HANDOVER_MINUTES, "drive rounded up, plus handover");

const routed = travelEstimate(fiveGuys, venue, { seconds: 232, departAt: dinner.toISOString() });
assert.equal(routed.value, 9);
assert.match(routed.source.label, /^Google Maps drive leaving 19:00/);
assert.match(routed.source.url!, /travelmode=driving/);
assert.match(travelEstimate(fiveGuys, venue, { seconds: 232 }).source.label, /current traffic/);
const guessed = travelEstimate(fiveGuys, venue);
assert.equal(guessed.value, travelMinutes(754), "no route: the distance heuristic");
assert.match(guessed.source.label, /courier speed/);

/* ---------- precedence: scraped → Routes + prep → heuristic ---------- */

const base = heuristicEstimates(fiveGuys, 150);
const jeQuote = base.platforms.find((q) => q.platform === "justeat")!;
const okSnap: ListingSnapshot = { platform: "justeat", checkedAt, ok: true, listings: je };
const prep = 45;
const ctx = { prep, travel: 9, headcount: 150, orderValue: 1200 };

const hit = platformQuote(jeQuote, fiveGuys, { ...ctx, snapshot: okSnap });
const extra = prep - NORMAL_ORDER_PREP;
assert.equal(extra, 30);
assert.equal(hit.checkedAt, checkedAt);
assert.deepEqual(hit.eta.range, { low: 20 + extra, high: 35 + extra }, "bulk cooking goes on top of the platform's range");
assert.equal(hit.eta.value, 35 + extra, "deadlines use the upper bound");
assert.equal(hit.eta.source.label, "Just Eat, checked 17:02: 20–35 min, +30 min to cook for 150");
assert.equal(hit.eta.source.url, "https://www.just-eat.co.uk/restaurants-five-guys---oxford-oxford/menu");
assert.equal(hit.available.value, true);
assert.equal(hit.available.source.label, "Just Eat, checked 17:02");
assert.equal(hit.fee.value, 0, "fee for the bulk basket");
assert.equal(hit.fee.source.label, "Just Eat, checked 17:02, fee for a £1,200 order");
assert.equal(hit.url, je[0]!.url);
assert.equal(minutesLabel(hit.eta), "50–65 min");

const small = platformQuote(jeQuote, fiveGuys, { ...ctx, prep: 10, snapshot: okSnap });
assert.deepEqual(small.eta.range, { low: 20, high: 35 }, "a normal-sized order: the platform's range as is");
assert.equal(small.eta.source.label, "Just Eat, checked 17:02");

const miss = platformQuote(jeQuote, place("p-none", "Nowhere Diner", 51.76, -1.26, 100), { ...ctx, snapshot: okSnap });
assert.equal(miss.checkedAt, undefined);
assert.equal(miss.eta.value, prep + 9 + 6, "unmatched: prep + travel + dispatch");
assert.match(miss.eta.source.label, /^Not matched on Just Eat, so Comeda estimate/);
assert.deepEqual(miss.fee, jeQuote.fee, "unmatched: the estimated fee");
assert.deepEqual(miss.available, jeQuote.available);

const down = platformQuote(jeQuote, fiveGuys, { ...ctx, snapshot: { platform: "justeat", checkedAt, ok: false, listings: [] } });
assert.match(down.eta.source.label, /^Just Eat didn't answer, so Comeda estimate/);
assert.equal(down.checkedAt, undefined);
assert.match(platformQuote(jeQuote, fiveGuys, ctx).eta.source.label, /^Comeda estimate/, "no snapshot at all");

const prepEst = base.prepMinutes;
const travelEst = routed;
const none = restaurantEta([miss, down], { ...prepEst, value: prep }, travelEst);
assert.equal(none.platform, undefined);
assert.equal(none.eta.value, prep + 9, "no scraped ETA: prep + Routes drive");
assert.match(none.eta.source.label, /Google Maps drive/);
const roQuote = platformQuote(base.platforms.find((q) => q.platform === "deliveroo")!, { ...fiveGuys, name: "Wendy's", distanceMeters: 700 }, {
  ...ctx,
  snapshot: { platform: "deliveroo", checkedAt, ok: true, listings: roo },
});
assert.deepEqual(roQuote.eta.range, { low: 45, high: 45 }, "Deliveroo's single figure + bulk cooking");
assert.deepEqual(roQuote.fee, base.platforms.find((q) => q.platform === "deliveroo")!.fee, "Deliveroo shows no fee: keep the estimate");
const both = restaurantEta([hit, roQuote, miss], { ...prepEst, value: prep }, travelEst);
assert.equal(both.platform, "deliveroo", "the fastest scraped platform wins");
assert.equal(both.eta.value, 45);

/* ---------- scoreRestaurants with live data ---------- */

const ests = new Map<string, RestaurantEstimates>([[fiveGuys.id, { ...base, prepMinutes: { ...base.prepMinutes, value: prep } }]]);
const plain = scoreRestaurants([fiveGuys], ests, { headcount: 150, slot: dinner, source: "live", venue })[0]!;
assert.equal(plain.eta.value, prep + travelMinutes(754), "no live data: heuristic travel");
assert.equal(plain.etaPlatform, undefined);

const routedOnly = scoreRestaurants([fiveGuys], ests, {
  headcount: 150,
  slot: dinner,
  source: "live",
  venue,
  live: { listings: [], routes: { [fiveGuys.id]: { seconds: 232, departAt: dinner.toISOString() } } },
})[0]!;
assert.equal(routedOnly.travelMinutes.value, 9);
assert.equal(routedOnly.etaMinutes, prep + 9, "Routes + prep beats the heuristic");

const full = scoreRestaurants([fiveGuys], ests, {
  headcount: 150,
  slot: dinner,
  source: "live",
  venue,
  live: { listings: [okSnap], routes: { [fiveGuys.id]: { seconds: 232, departAt: dinner.toISOString() } } },
})[0]!;
assert.equal(full.etaPlatform, "justeat");
assert.equal(full.etaMinutes, 35 + extra, "scraped beats Routes + prep");
assert.equal(full.orderBy, new Date(dinner.getTime() - (35 + extra) * 60_000).toISOString(), "order by = slot − upper bound");
const jeOption = full.delivery.find((d) => d.platform === "justeat")!;
assert.deepEqual(jeOption.eta.range, { low: 50, high: 65 });
assert.equal(jeOption.url, je[0]!.url);
const direct = full.delivery.find((d) => d.platform === "direct");
if (direct) assert.equal(direct.eta.value, prep + 9, "collecting yourself: prep + the Routes drive");

/* ---------- deadline maths in the planner ---------- */

const slot: MealSlot = { id: "s1", eventId: "e", label: "Dinner", kind: "dinner", servesAt: dinner.toISOString(), headcount: 150, allowance: 1 };
const viaJustEat = costOrder(slot, full, 150, "justeat");
assert.equal(viaJustEat.delivery?.platform, "justeat");
assert.equal(viaJustEat.orderBy, orderBy(slot.servesAt, 0, 35 + extra), "planner deadline = serving time − the platform's upper bound");
assert.equal(viaJustEat.orderBy, "2026-10-25T17:55:00Z");
assert.equal(viaJustEat.fee, 0);

/* ---------- Gemini: prose first, JSON last ---------- */

const prose = `"a": Branca's mains cost £14–£18 [1]. Listed on Deliveroo [2].\n\n"b": Gee's is pricier.\n\n\`\`\`json\n[{"id":"a","costPerHead":{"value":15}},{"id":"b","costPerHead":{"value":25}}]\n\`\`\``;
assert.deepEqual(
  extractJsonArray(prose)?.map((r) => (r as { id: string }).id),
  ["a", "b"],
  "the fenced block, not the [1] citations in the prose",
);
assert.deepEqual(extractJsonArray('[{"id":"x"}]'), [{ id: "x" }], "bare JSON still parses");
const segmentEnd = new TextEncoder().encode(prose.slice(0, prose.indexOf("[2]"))).length;
const grounded = groundingByRestaurant(
  {
    candidates: [
      {
        content: { parts: [{ text: prose }] },
        groundingMetadata: {
          groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/1", title: "deliveroo.co.uk" } }],
          groundingSupports: [{ segment: { partIndex: 0, startIndex: 5, endIndex: segmentEnd }, groundingChunkIndices: [0] }],
        },
      },
    ],
  },
  ["a", "b"],
);
assert.equal(grounded.get("a")?.[0]?.host, "deliveroo.co.uk", "a support in a's paragraph sources a");
assert.equal(grounded.has("b"), false);

console.log("live times: ok");
