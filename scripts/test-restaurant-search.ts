import assert from "node:assert/strict";
import { findSeededRestaurants, searchRestaurants, setRestaurantSearch } from "@/lib/restaurant-search";
import { OXHACK_EVENT, OXHACK_RESTAURANTS } from "@/lib/seed/oxhack";

/* The adapter accepts findRestaurants' { restaurants } result and falls back to the seed. */

async function main() {
  const query = { venue: OXHACK_EVENT.venue, slotTime: "2026-11-14T18:30:00Z", headcount: 150 };

  const seeded = await searchRestaurants(query);
  assert.equal(seeded.length, OXHACK_RESTAURANTS.length);
  assert.deepEqual(seeded.map((r) => r.costPerHead.value), [...seeded.map((r) => r.costPerHead.value)].sort((a, b) => a - b), "cheapest first");
  assert.equal((await findSeededRestaurants({ ...query, dietary: ["halal", "gf"] }))[0].serves.includes("halal"), true);
  assert.ok((await findSeededRestaurants({ ...query, maxPerHead: 6 })).every((r) => r.costPerHead.value <= 6));

  setRestaurantSearch(async () => ({ restaurants: [OXHACK_RESTAURANTS[2]] }));
  assert.deepEqual((await searchRestaurants(query)).map((r) => r.id), [OXHACK_RESTAURANTS[2].id], "unwraps { restaurants }");
  setRestaurantSearch(async () => [OXHACK_RESTAURANTS[1]]);
  assert.deepEqual((await searchRestaurants(query)).map((r) => r.id), [OXHACK_RESTAURANTS[1].id], "accepts a bare list");
  setRestaurantSearch(async () => {
    throw new Error("Places down");
  });
  assert.equal((await searchRestaurants(query)).length, OXHACK_RESTAURANTS.length, "falls back when live search throws");
  setRestaurantSearch(async () => ({ restaurants: [] }));
  assert.equal((await searchRestaurants(query)).length, OXHACK_RESTAURANTS.length, "falls back when live search is empty");

  console.log("test-restaurant-search: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
