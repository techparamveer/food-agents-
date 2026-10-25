import { clientIp, createRateLimiter, tooManyRequests } from "@/lib/rate-limit";
import { findRestaurants } from "@/lib/restaurants/find";
import { clampHeadcount } from "@/lib/restaurants/find-core";
import type { SortKey } from "@/lib/restaurants/rank";
import { OXHACK_EVENT } from "@/lib/seed/oxhack";
import type { Dietary } from "@/lib/types";

/** Gemini grounding on a cold cache can take a while; everything after that is cached. */
export const maxDuration = 60;

const SORTS: SortKey[] = ["best", "cost", "eta", "rating"];

/* Public route: generous enough to click around the Restaurants view and re-plan freely, tight
   enough that a script can't hammer it. Upstream cost is bounded separately by the cache
   (one Places call a day, estimates per headcount band). */
const perIp = createRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * GET /api/restaurants?slot=2026-11-14T18:30:00Z&headcount=150&maxPerHead=8&dietary=vegan&cuisine=Pizza&open=0&sort=cost
 *
 * All parameters are optional. Defaults: the OxHack venue and headcount, slot = now,
 * open-at-slot filter on. Headcount is clamped to 1–1,000. Always 200 with a result (seeded
 * fallback if APIs fail), except 400 for an unparseable `slot` and 429 when rate limited.
 */
export async function GET(request: Request) {
  const limit = perIp.hit(clientIp(request.headers));
  if (!limit.ok) return tooManyRequests(limit, "Too many restaurant searches. Try again in a minute.");
  const params = new URL(request.url).searchParams;
  const sort = params.get("sort") as SortKey | null;
  const maxPerHead = Number(params.get("maxPerHead"));
  try {
    const result = await findRestaurants({
      slotTime: params.get("slot") ?? new Date(),
      headcount: clampHeadcount(Number(params.get("headcount")) || OXHACK_EVENT.headcount),
      maxPerHead: maxPerHead > 0 ? maxPerHead : undefined,
      dietary: params.getAll("dietary") as Dietary[],
      dietaryMix: params.get("mix") === "0" ? undefined : OXHACK_EVENT.dietaryMix,
      cuisines: params.getAll("cuisine").map((c) => c.slice(0, 40)).slice(0, 10),
      openAtSlot: params.get("open") !== "0",
      sort: sort && SORTS.includes(sort) ? sort : "best",
    });
    return Response.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error("[restaurants] bad request:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Couldn't read that search. Check the slot time." }, { status: 400 });
  }
}
