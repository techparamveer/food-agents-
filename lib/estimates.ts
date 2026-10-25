import "server-only";
import { buildEstimatePrompt, heuristicEstimates, parseGeminiEstimates } from "@/lib/restaurants/estimate-parse";
import type { PlaceResult, RestaurantEstimates } from "@/lib/restaurants/types";

/**
 * Gemini + Google Search grounding: bulk cost per head, catering availability and delivery
 * fees on Uber Eats / Deliveroo / Just Eat. Every value comes back as an `Estimate` with a
 * source URL; anything Gemini can't ground falls back to a labelled heuristic.
 * https://ai.google.dev/gemini-api/docs/google-search
 */

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** Restaurants per grounded call: keeps the prompt small and the answer within one response. */
const BATCH = 8;

export type EstimateResult = { estimates: Map<string, RestaurantEstimates>; grounded: number };

/** Live estimates for `places`. Throws on a missing key or a failed call so callers can fall back. */
export async function estimateRestaurants(
  places: PlaceResult[],
  headcount: number,
  { apiKey = process.env.GEMINI_API_KEY, signal }: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<EstimateResult> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const batches: PlaceResult[][] = [];
  for (let i = 0; i < places.length; i += BATCH) batches.push(places.slice(i, i + BATCH));

  const results = await Promise.allSettled(batches.map((batch) => estimateBatch(batch, headcount, apiKey, signal)));
  const estimates = new Map<string, RestaurantEstimates>();
  let grounded = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      result.value.estimates.forEach((v, k) => estimates.set(k, v));
      grounded += result.value.grounded;
    } else {
      for (const p of batches[i]!) estimates.set(p.id, heuristicEstimates(p, headcount));
    }
  });
  if (grounded === 0 && results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return { estimates, grounded };
}

async function estimateBatch(places: PlaceResult[], headcount: number, apiKey: string, signal?: AbortSignal) {
  const res = await fetch(ENDPOINT(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildEstimatePrompt(places, headcount) }] }],
      tools: [{ google_search: {} }],
      // Low thinking: a lookup-and-format job. Default thinking took over 45 s per batch and billed ~5k extra tokens.
      generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } },
    }),
    signal: signal ?? AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  return parseGeminiEstimates(await res.json(), places, headcount);
}
