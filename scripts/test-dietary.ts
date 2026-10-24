import assert from "node:assert/strict";
import { splitDietary } from "@/lib/planner";
import type { OrderLine } from "@/lib/types";

/* Dietary splits: every need rounds half up, standard takes the rest, lines add up to the headcount. */

const asMap = (lines: OrderLine[]) => Object.fromEntries(lines.map((l) => [l.dietary, l.quantity]));
const sum = (lines: OrderLine[]) => lines.reduce((n, l) => n + l.quantity, 0);

const MIX = { veg: 0.15, vegan: 0.08, halal: 0.04, gf: 0.03 };

// OxHack defaults: 22.5 → 23 veg, 12 vegan, 6 halal, 4.5 → 5 GF, 104 standard (matches the seeded attendees).
const ox = splitDietary(150, MIX);
assert.deepEqual(asMap(ox), { veg: 23, vegan: 12, halal: 6, gf: 5, standard: 104 });
assert.equal(ox.at(-1)!.dietary, "standard", "standard is listed last");

// Exact counts beat the mix: "feed 150, 20 vegan".
assert.deepEqual(asMap(splitDietary(150, { veg: 0, vegan: 0, halal: 0, gf: 0 }, { vegan: 20 })), {
  veg: 0, vegan: 20, halal: 0, gf: 0, standard: 130,
});
assert.equal(asMap(splitDietary(150, MIX, { vegan: 20 })).vegan, 20);
assert.equal(asMap(splitDietary(150, MIX, { vegan: 20 })).veg, 23, "other needs still follow the mix");

// Every headcount adds up.
for (let n = 0; n <= 400; n++) {
  const lines = splitDietary(n, MIX);
  assert.equal(sum(lines), n, `lines add up for ${n}`);
  assert.ok(lines.every((l) => l.quantity >= 0), `no negative lines for ${n}`);
}

// Asking for more special meals than people shrinks them proportionally and never goes negative.
const over = splitDietary(10, MIX, { veg: 8, vegan: 8 });
assert.equal(sum(over), 10);
assert.deepEqual(asMap(over), { veg: 5, vegan: 5, halal: 0, gf: 0, standard: 0 });

// Nonsense input is clamped.
assert.deepEqual(asMap(splitDietary(-5, MIX)), { veg: 0, vegan: 0, halal: 0, gf: 0, standard: 0 });
assert.equal(sum(splitDietary(99.6, MIX)), 100);

console.log("test-dietary: ok");
