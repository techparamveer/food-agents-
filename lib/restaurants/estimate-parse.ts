import { bulkPrepMinutes, etaMinutes } from "@/lib/restaurants/geo";
import { PLATFORMS, type Flag, type PlaceResult, type Platform, type RestaurantEstimates } from "@/lib/restaurants/types";
import type { Estimate, EstimateSource } from "@/lib/types";

/** Pure estimate logic: heuristics, the Gemini prompt and its response parser. No fetch, no env. */

export const GEMINI_SOURCE_LABEL = "Gemini · Google Search";
/** Gemini answered but Google returned no search source for this restaurant: the number is the model's own. */
export const GEMINI_UNGROUNDED_LABEL = "Gemini estimate, not grounded (no search source found)";

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
  const prep = bulkPrepMinutes(headcount, isFastCasual(p) ? 15 : 25);
  const eta = etaMinutes(prep, p.distanceMeters);
  const shorterBy = Math.max(5, Math.ceil(eta * 0.15));
  const longerBy = Math.max(8, Math.ceil(eta * 0.2));
  return {
    costPerHead: est(cost, { ...fromListing, label: p.priceRange ? "Comeda estimate from Places price range" : "Comeda estimate from price level" }),
    catering: flag(caters, fromListing),
    prepMinutes: est(prep, { ...fromListing, label: `Comeda estimate for ${headcount} portions` }),
    etaRange: {
      ...(p.mockEtaRange ?? { shortestMinutes: Math.max(5, eta - shorterBy), longestMinutes: eta + longerBy }),
      source: {
        ...fromListing,
        label: p.mockEtaRange ? "Seeded sample times to the Andrew Wiles Building" : "Comeda ETA range from prep and distance",
      },
    },
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
- deliveryTimeToVenue: the realistic shortestMinutes and longestMinutes from placing the order until it reaches the Andrew Wiles Building, Woodstock Road, Oxford OX2 6GG (kitchen prep plus courier travel).
- platforms: for "ubereats", "deliveroo", "justeat": whether the restaurant is listed, the typical delivery fee in GBP, and the listing URL if found.
Each value needs a sourceUrl: a real page you used (menu, listing or catering page). Use null when unknown; never invent URLs.

Restaurants:
${JSON.stringify(list)}

Reply with ONLY a JSON array, no prose, matching:
[{"id":"<id>","costPerHead":{"value":9.5,"low":8,"high":12,"sourceUrl":"https://..."},"catering":{"value":true,"sourceUrl":"https://..."},"prepMinutes":{"value":45,"sourceUrl":"https://..."},"deliveryTimeToVenue":{"shortestMinutes":35,"longestMinutes":55,"sourceUrl":"https://..."},"platforms":[{"platform":"deliveroo","available":true,"deliveryFee":2.49,"url":"https://...","sourceUrl":"https://..."}]}]`;
}

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
      groundingSupports?: {
        segment?: { partIndex?: number; startIndex?: number; endIndex?: number; text?: string };
        groundingChunkIndices?: number[];
      }[];
    };
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

export type GroundingChunk = { uri: string; title?: string; host?: string };

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");
/** Chunk titles are usually the page's domain ("deliveroo.co.uk"); the URI is a Google redirect. */
function chunkHost(title?: string, uri?: string): string | undefined {
  if (title && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(title.trim())) return bareHost(title.trim());
  try {
    const host = bareHost(new URL(uri ?? "").hostname);
    return host.endsWith("vertexaisearch.cloud.google.com") ? undefined : host;
  } catch {
    return undefined;
  }
}

/** Char offset in `text` of a UTF-8 byte offset (Gemini segments count bytes). */
function charAt(text: string, bytes: number) {
  return new TextDecoder().decode(new TextEncoder().encode(text).slice(0, bytes)).length;
}

/**
 * Which grounding chunks back which restaurant. A support's segment points into the answer text;
 * the restaurant whose `"id"` most recently precedes that span owns it. Chunks that no support
 * ties to a restaurant are attributed to none, so one place's page never sources another's numbers.
 */
export function groundingByRestaurant(body: unknown, ids: string[]): Map<string, GroundingChunk[]> {
  const candidate = (body as GeminiResponse | null)?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const out = new Map<string, GroundingChunk[]>();
  for (const support of candidate?.groundingMetadata?.groundingSupports ?? []) {
    const seg = support.segment;
    const text = parts[seg?.partIndex ?? 0]?.text;
    if (!seg || typeof text !== "string") continue;
    let end = typeof seg.endIndex === "number" ? charAt(text, seg.endIndex) : -1;
    if (end < 0 && seg.text) {
      const at = text.indexOf(seg.text);
      end = at < 0 ? -1 : at + seg.text.length;
    }
    if (end <= 0) continue;
    let owner: string | undefined;
    let ownerAt = -1;
    for (const id of ids) {
      const at = text.lastIndexOf(JSON.stringify(id), end - 1);
      if (at > ownerAt) [owner, ownerAt] = [id, at];
    }
    if (!owner) continue;
    const list = out.get(owner) ?? [];
    for (const i of support.groundingChunkIndices ?? []) {
      const web = chunks[i]?.web;
      if (!web?.uri || !isHttpUrl(web.uri) || list.some((c) => c.uri === web.uri)) continue;
      list.push({ uri: web.uri, title: web.title, host: chunkHost(web.title, web.uri) });
    }
    if (list.length) out.set(owner, list);
  }
  return out;
}

/** The chunk that backs `url`: the same URI, or a page on the same site. */
export function matchChunk(url: unknown, chunks: GroundingChunk[]): GroundingChunk | undefined {
  if (!isHttpUrl(url)) return undefined;
  const exact = chunks.find((c) => c.uri === url);
  if (exact) return exact;
  const host = bareHost(new URL(url).hostname);
  return chunks.find((c) => c.host && (host === c.host || host.endsWith(`.${c.host}`)));
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
  const rows = extractJsonArray(responseText(body)) ?? [];
  const byId = new Map(rows.map(obj).filter((r): r is Raw => typeof r?.id === "string").map((r) => [r.id as string, r]));
  const grounding = groundingByRestaurant(
    body,
    places.map((p) => p.id),
  );
  const estimates = new Map<string, RestaurantEstimates>();
  let grounded = 0;

  for (const place of places) {
    const base = heuristicEstimates(place, headcount);
    const row = byId.get(place.id);
    if (!row) {
      estimates.set(place.id, base);
      continue;
    }
    const chunks = grounding.get(place.id) ?? [];
    /* Only URLs Google returned for this restaurant count as sources. A field that names a page on
       one of those sites gets that chunk; a field with no URL gets the restaurant's first chunk;
       anything else keeps Gemini's value but is labelled ungrounded, with no link. */
    const sourced = (field: Raw | undefined): EstimateSource => {
      const chunk = field?.sourceUrl ? matchChunk(field.sourceUrl, chunks) : chunks[0];
      return chunk ? { label: GEMINI_SOURCE_LABEL, url: chunk.uri } : { label: GEMINI_UNGROUNDED_LABEL };
    };
    const numeric = (field: Raw | undefined, min: number, max: number, fallback: Estimate): Estimate => {
      const value = num(field?.value, min, max);
      return value !== undefined ? est(value, sourced(field)) : fallback;
    };
    const yesNo = (value: unknown, field: Raw | undefined, fallback: Flag): Flag => {
      const v = bool(value);
      return v !== undefined ? flag(v, sourced(field)) : fallback;
    };

    const rawPlatforms = Array.isArray(row.platforms) ? row.platforms.map(obj) : [];
    const catering = obj(row.catering);
    const deliveryTimeToVenue = obj(row.deliveryTimeToVenue);
    const shortestMinutes = num(deliveryTimeToVenue?.shortestMinutes, 5, 300);
    const longestMinutes = num(deliveryTimeToVenue?.longestMinutes, 5, 360);
    const merged: RestaurantEstimates = {
      costPerHead: numeric(obj(row.costPerHead), 2, 80, base.costPerHead),
      catering: yesNo(catering?.value, catering, base.catering),
      prepMinutes: numeric(obj(row.prepMinutes), 5, 240, base.prepMinutes),
      etaRange:
        shortestMinutes !== undefined && longestMinutes !== undefined && shortestMinutes <= longestMinutes
          ? { shortestMinutes, longestMinutes, source: sourced(deliveryTimeToVenue) }
          : base.etaRange,
      platforms: base.platforms.map((fallback) => {
        const raw = rawPlatforms.find((r) => asPlatform(r?.platform) === fallback.platform);
        if (!raw) return fallback;
        return {
          platform: fallback.platform,
          available: yesNo(raw.available, raw, fallback.available),
          fee: numeric({ value: raw.deliveryFee, sourceUrl: raw.sourceUrl }, 0, 30, fallback.fee),
          // A listing link only when Google's results for this restaurant include that site.
          url: matchChunk(raw.url, chunks) ? (raw.url as string) : fallback.url,
        };
      }),
    };
    if (merged.costPerHead.source.label === GEMINI_SOURCE_LABEL) grounded++;
    estimates.set(place.id, merged);
  }
  return { estimates, grounded };
}

/** Grounded in a Google Search result, as opposed to Gemini's own guess or a Comeda heuristic. */
export const isGroundedEstimate = (e: Pick<RestaurantEstimates, "costPerHead">) => e.costPerHead.source.label === GEMINI_SOURCE_LABEL;
