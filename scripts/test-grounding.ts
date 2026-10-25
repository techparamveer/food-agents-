import assert from "node:assert/strict";
import {
  GEMINI_SOURCE_LABEL,
  GEMINI_UNGROUNDED_LABEL,
  groundingByRestaurant,
  heuristicEstimates,
  isGroundedEstimate,
  matchChunk,
  parseGeminiEstimates,
} from "@/lib/restaurants/estimate-parse";
import { seedPlaces } from "@/lib/restaurants/seed";

/* Grounding URLs are attributed per restaurant: a value is only "sourced" by a page Google's
   grounding metadata ties to that restaurant. Nothing borrows another restaurant's link. */

const [a, b, c] = seedPlaces().slice(0, 3);
const redirect = (n: number) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${n}`;

// "Côte"-style multi-byte text before the rows, so byte and character offsets differ.
const text =
  "Prix café → ok\n[" +
  `{"id":"${a.id}","costPerHead":{"value":12,"sourceUrl":"https://a-menu.example/menu"},"catering":{"value":true,"sourceUrl":null},` +
  `"prepMinutes":{"value":40,"sourceUrl":"https://elsewhere.example/page"},"platforms":[{"platform":"deliveroo","available":true,"deliveryFee":2.49,"url":"https://deliveroo.co.uk/menu/oxford/a","sourceUrl":"https://deliveroo.co.uk/menu/oxford/a"}]},` +
  `{"id":"${b.id}","costPerHead":{"value":9,"sourceUrl":null},"catering":{"value":false,"sourceUrl":"https://a-menu.example/menu"}},` +
  `{"id":"${c.id}","costPerHead":{"value":15,"sourceUrl":null}}` +
  "]";

const bytes = (s: string) => new TextEncoder().encode(s).length;
/** A support covering `needle` (the first match after `after`), with byte offsets like Gemini's. */
const support = (needle: string, chunks: number[], after = "") => {
  const at = text.indexOf(needle, after ? text.indexOf(after) : 0);
  assert.ok(at >= 0, needle);
  return {
    segment: { partIndex: 1, startIndex: bytes(text.slice(0, at)), endIndex: bytes(text.slice(0, at + needle.length)), text: needle },
    groundingChunkIndices: chunks,
  };
};

const body = {
  candidates: [
    {
      content: { parts: [{ text: "thinking", thought: true }, { text }] },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: redirect(0), title: "a-menu.example" } },
          { web: { uri: redirect(1), title: "deliveroo.co.uk" } },
          { web: { uri: redirect(2), title: "b-bistro.example" } },
        ],
        groundingSupports: [
          support('"costPerHead":{"value":12', [0]),
          support('"platforms":[{"platform":"deliveroo"', [1]),
          support('"costPerHead":{"value":9', [2], b.id),
        ],
      },
    },
  ],
};

/* ---------- attribution ---------- */

const owned = groundingByRestaurant(body, [a.id, b.id, c.id]);
assert.deepEqual(owned.get(a.id)?.map((x) => x.uri), [redirect(0), redirect(1)], "A owns its menu and Deliveroo chunks");
assert.deepEqual(owned.get(b.id)?.map((x) => x.uri), [redirect(2)], "B owns only its own chunk");
assert.equal(owned.get(c.id), undefined, "C has no supports, so no chunks");
assert.equal(owned.get(a.id)![1].host, "deliveroo.co.uk");

assert.equal(matchChunk("https://www.deliveroo.co.uk/menu/x", owned.get(a.id)!)?.uri, redirect(1), "www and paths match by site");
assert.equal(matchChunk(redirect(0), owned.get(a.id)!)?.uri, redirect(0), "an exact chunk URI matches");
assert.equal(matchChunk("https://notdeliveroo.co.uk/x", owned.get(a.id)!), undefined, "lookalike hosts don't match");
assert.equal(matchChunk("not a url", owned.get(a.id)!), undefined);

/* ---------- parsing ---------- */

const { estimates, grounded } = parseGeminiEstimates(body, [a, b, c], 150);
const ea = estimates.get(a.id)!;
assert.deepEqual(ea.costPerHead, { value: 12, source: { label: GEMINI_SOURCE_LABEL, url: redirect(0) }, isEstimate: true }, "A's URL is on a site Google returned for A");
assert.deepEqual(ea.catering.source, { label: GEMINI_SOURCE_LABEL, url: redirect(0) }, "no URL → A's own first chunk");
assert.deepEqual(ea.prepMinutes, { value: 40, source: { label: GEMINI_UNGROUNDED_LABEL }, isEstimate: true }, "a site Google never returned → ungrounded, no link");
const roo = ea.platforms.find((p) => p.platform === "deliveroo")!;
assert.equal(roo.fee.source.url, redirect(1));
assert.equal(roo.url, "https://deliveroo.co.uk/menu/oxford/a", "a listing on a grounded site is kept");

const eb = estimates.get(b.id)!;
assert.deepEqual(eb.costPerHead.source, { label: GEMINI_SOURCE_LABEL, url: redirect(2) });
assert.deepEqual(eb.catering.source, { label: GEMINI_UNGROUNDED_LABEL }, "B can't cite A's page, even though Google returned it");

const ec = estimates.get(c.id)!;
assert.deepEqual(ec.costPerHead.source, { label: GEMINI_UNGROUNDED_LABEL }, "C doesn't borrow the batch's first link");
assert.equal(ec.costPerHead.value, 15, "the value is kept, labelled ungrounded");
assert.deepEqual(ec.catering, heuristicEstimates(c, 150).catering, "fields Gemini skipped fall back to the heuristic");

assert.equal(grounded, 2, "A and B are grounded; C isn't");
assert.deepEqual([ea, eb, ec].map(isGroundedEstimate), [true, true, false]);

// No metadata at all (what live Gemini sometimes returns): nothing is grounded, no URL is invented.
const bare = parseGeminiEstimates({ candidates: [{ content: { parts: [{ text }] } }] }, [a, b, c], 150);
assert.equal(bare.grounded, 0);
for (const e of bare.estimates.values()) {
  for (const v of [e.costPerHead, e.catering, e.prepMinutes, ...e.platforms.flatMap((p) => [p.available, p.fee])]) {
    if (v.source.label === GEMINI_UNGROUNDED_LABEL) assert.equal(v.source.url, undefined);
    else assert.ok(!v.source.url?.includes("example"), "only heuristic links (Maps, platform search)");
  }
}

// Supports given only as segment text (no byte offsets) still attribute.
const textOnly = structuredClone(body);
for (const s of textOnly.candidates[0].groundingMetadata.groundingSupports) {
  delete (s.segment as { startIndex?: number }).startIndex;
  delete (s.segment as { endIndex?: number }).endIndex;
}
assert.deepEqual(groundingByRestaurant(textOnly, [a.id, b.id]).get(a.id)?.map((x) => x.uri), [redirect(0), redirect(1)]);

console.log("test-grounding: ok");
