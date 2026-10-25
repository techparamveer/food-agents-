import { bulkPrepMinutes } from "@/lib/restaurants/geo";
import { PLATFORMS, type Flag, type PlaceResult, type Platform, type RestaurantEstimates } from "@/lib/restaurants/types";
import type { Estimate, EstimateSource } from "@/lib/types";

/** Pure estimate logic: heuristics, the Gemini prompt and its response parser. No fetch, no env. */

export const GEMINI_SOURCE_LABEL = "Gemini · Google Search";

const round2 = (n: number) => Math.round(n * 100) / 100;
/** UK menu-style prices to the nearest 50p: 0.49, 1.99, 2.49. */
const menuPrice = (n: number) => Math.max(0.49, Math.round(n * 2) / 2 - 0.01);

const est = (value: number, source: EstimateSource): Estimate => ({ value, source, isEstimate: true });
const flag = (value: boolean, source: EstimateSource): Flag => ({ value, source, isEstimate: true });

export function platformLabel(id: Platform) {
  return PLATFORMS.find((p) => p.id === id)!.label;
}

/** Search for the restaurant on a platform: honest when we don't know the listing URL. */
export function platformSearchUrl(id: Platform, name: string) {
  const site = PLATFORMS.find((p) => p.id === id)!.site;
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} Oxford site:${site}`)}`;
}

const isFastCasual = (p: PlaceResult) => /pizza|burger|chicken|fast food|sandwich|noodle/i.test(`${p.cuisine} ${p.name}`);
const isChain = (p: PlaceResult) =>
  /pizzaexpress|nando|wagamama|côte|franco manca|leon|itsu|five guys|pret|subway|domino|pizza hut|honest burgers/i.test(p.name);

/** Per-head bulk cost from price range / level when Gemini has nothing better. */
function heuristicCostPerHead(p: PlaceResult): number {
  if (p.priceRange) return round2(((p.priceRange.low + p.priceRange.high) / 2) * 0.8);
  const byLevel = { 1: 8, 2: 12, 3: 19, 4: 28 } as const;
  const cost = byLevel[p.priceLevel ?? 2];
  return isFastCasual(p) ? Math.min(cost, 9) : cost;
}

const PLATFORM_FEE: Record<Platform, { base: number; perKm: number }> = {
  ubereats: { base: 0.49, perKm: 0.79 },
  deliveroo: { base: 1.99, perKm: 0.39 },
  justeat: { base: 2.49, perKm: 0.29 },
};

/** Distance-based delivery fee, GBP, rounded to menu-style pence. */
export function heuristicDeliveryFee(platform: Platform, distance: number): number {
  const { base, perKm } = PLATFORM_FEE[platform];
  return round2(menuPrice(base + perKm * (distance / 1000)));
}

/** Deterministic estimates for one place: the seeded fallback, and gaps in Gemini's answer. */
export function heuristicEstimates(p: PlaceResult, headcount: number): RestaurantEstimates {
  const fromListing: EstimateSource = { label: "Comeda estimate from the Google Maps listing", url: p.mapsUrl };
  const cost = heuristicCostPerHead(p);
  const caters = isChain(p) || isFastCasual(p) || (p.priceLevel ?? 2) <= 2;
  return {
    costPerHead: est(cost, { ...fromListing, label: p.priceRange ? "Comeda estimate from Places price range" : "Comeda estimate from price level" }),
    catering: flag(caters, fromListing),
    prepMinutes: est(bulkPrepMinutes(headcount, isFastCasual(p) ? 15 : 25), { ...fromListing, label: `Comeda estimate for ${headcount} portions` }),
    platforms: PLATFORMS.map(({ id, label }) => {
      const url = platformSearchUrl(id, p.name);
      const listed = isChain(p) || isFastCasual(p) || id !== "justeat" || (p.priceLevel ?? 2) <= 1;
      return {
        platform: id,
        available: flag(listed, { label: `Comeda guess: search ${label}`, url }),
        fee: est(heuristicDeliveryFee(id, p.distanceMeters), { label: `Typical ${label} fee for the distance`, url }),
        url,
      };
    }),
  };
}

/* ---------- Gemini ---------- */

export function buildEstimatePrompt(places: PlaceResult[], headcount: number, city = "Oxford, UK") {
  const list = places.map((p) => ({ id: p.id, name: p.name, address: p.address, cuisine: p.cuisine, priceLevel: p.priceLevel, website: p.websiteUrl }));
  return `You are pricing a bulk food order for a student hackathon in ${city} feeding ${headcount} people.
Use Google Search to look up each restaurant's real menu prices, catering or group-order offers, and its listings on Uber Eats, Deliveroo and Just Eat.

For EACH restaurant below, estimate:
- costPerHead: GBP per person for a simple filling main (bulk/catering price if they have one), with low/high range.
- catering: true if they offer catering, party platters, or clearly accept large group orders.
- prepMinutes: kitchen time to prepare ${headcount} portions.
- platforms: for "ubereats", "deliveroo", "justeat": whether the restaurant is listed, the typical delivery fee in GBP, and the listing URL if found.
Each value needs a sourceUrl: a real page you used (menu, listing or catering page). Use null when unknown; never invent URLs.

Restaurants:
${JSON.stringify(list)}

Reply with ONLY a JSON array, no prose, matching:
[{"id":"<id>","costPerHead":{"value":9.5,"low":8,"high":12,"sourceUrl":"https://..."},"catering":{"value":true,"sourceUrl":"https://..."},"prepMinutes":{"value":45,"sourceUrl":"https://..."},"platforms":[{"platform":"deliveroo","available":true,"deliveryFee":2.49,"url":"https://...","sourceUrl":"https://..."}]}]`;
}

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
};

/** Answer text from a generateContent response, skipping thought parts. */
export function responseText(body: unknown): string {
  const parts = (body as GeminiResponse | null)?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/** Grounding sources Google attached to the answer (redirect URLs to the real pages). */
export function groundingSources(body: unknown): { uri: string; title?: string }[] {
  const chunks = (body as GeminiResponse | null)?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return chunks.flatMap((c) => (c.web?.uri && isHttpUrl(c.web.uri) ? [{ uri: c.web.uri, title: c.web.title }] : []));
}

/** Pull the first JSON array out of model text (handles ```json fences and stray prose). */
export function extractJsonArray(text: string): unknown[] | null {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/[£,\s]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const asPlatform = (v: unknown): Platform | undefined =>
  typeof v === "string" ? PLATFORMS.find((p) => squash(p.id) === squash(v) || squash(p.label) === squash(v))?.id : undefined;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : undefined);

/**
 * Turn a Gemini generateContent response into per-restaurant estimates.
 * Anything missing, unsourced or out of range falls back to the heuristic for that field,
 * so every place always has a full set of estimates, each with a source URL.
 */
export function parseGeminiEstimates(
  body: unknown,
  places: PlaceResult[],
  headcount: number,
): { estimates: Map<string, RestaurantEstimates>; grounded: number } {
  const fallbackSource = groundingSources(body)[0];
  const rows = extractJsonArray(responseText(body)) ?? [];
  const byId = new Map(rows.map(obj).filter((r): r is Raw => typeof r?.id === "string").map((r) => [r.id as string, r]));
  const estimates = new Map<string, RestaurantEstimates>();
  let grounded = 0;

  const sourced = (field: Raw | undefined): EstimateSource | null => {
    if (isHttpUrl(field?.sourceUrl)) return { label: GEMINI_SOURCE_LABEL, url: field.sourceUrl };
    if (fallbackSource) return { label: GEMINI_SOURCE_LABEL, url: fallbackSource.uri };
    return null;
  };
  const numeric = (field: Raw | undefined, min: number, max: number, fallback: Estimate): Estimate => {
    const value = num(field?.value, min, max);
    const source = sourced(field);
    return value !== undefined && source ? est(value, source) : fallback;
  };
  const yesNo = (value: unknown, field: Raw | undefined, fallback: Flag): Flag => {
    const v = bool(value);
    const source = sourced(field);
    return v !== undefined && source ? flag(v, source) : fallback;
  };

  for (const place of places) {
    const base = heuristicEstimates(place, headcount);
    const row = byId.get(place.id);
    if (!row) {
      estimates.set(place.id, base);
      continue;
    }
    const rawPlatforms = Array.isArray(row.platforms) ? row.platforms.map(obj) : [];
    const catering = obj(row.catering);
    const merged: RestaurantEstimates = {
      costPerHead: numeric(obj(row.costPerHead), 2, 80, base.costPerHead),
      catering: yesNo(catering?.value, catering, base.catering),
      prepMinutes: numeric(obj(row.prepMinutes), 5, 240, base.prepMinutes),
      platforms: base.platforms.map((fallback) => {
        const raw = rawPlatforms.find((r) => asPlatform(r?.platform) === fallback.platform);
        if (!raw) return fallback;
        return {
          platform: fallback.platform,
          available: yesNo(raw.available, raw, fallback.available),
          fee: numeric({ value: raw.deliveryFee, sourceUrl: raw.sourceUrl }, 0, 30, fallback.fee),
          url: isHttpUrl(raw.url) ? raw.url : fallback.url,
        };
      }),
    };
    if (merged.costPerHead !== base.costPerHead) grounded++;
    estimates.set(place.id, merged);
  }
  return { estimates, grounded };
}
