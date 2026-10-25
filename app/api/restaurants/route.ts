import { findRestaurants } from "@/lib/restaurants/find";
import type { SortKey } from "@/lib/restaurants/rank";
import { OXHACK_EVENT } from "@/lib/seed/oxhack";
import type { Dietary } from "@/lib/types";

/** Gemini grounding on a cold cache can take a while; everything after that is cached. */
export const maxDuration = 60;

const SORTS: SortKey[] = ["best", "cost", "eta", "rating"];

/**
 * GET /api/restaurants?slot=2026-11-14T18:30:00Z&headcount=150&maxPerHead=8&dietary=vegan&cuisine=Pizza&open=0&sort=cost
 *
 * All parameters are optional. Defaults: the OxHack venue and headcount, slot = now,
 * open-at-slot filter on. Always 200 with a result (seeded fallback if APIs fail), except
 * 400 for an unparseable `slot`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sort = params.get("sort") as SortKey | null;
  const maxPerHead = Number(params.get("maxPerHead"));
  try {
    const result = await findRestaurants({
      slotTime: params.get("slot") ?? new Date(),
      headcount: Number(params.get("headcount")) || OXHACK_EVENT.headcount,
      maxPerHead: maxPerHead > 0 ? maxPerHead : undefined,
      dietary: params.getAll("dietary") as Dietary[],
      dietaryMix: params.get("mix") === "0" ? undefined : OXHACK_EVENT.dietaryMix,
      cuisines: params.getAll("cuisine").map((c) => c.slice(0, 40)).slice(0, 10),
      openAtSlot: params.get("open") !== "0",
      sort: sort && SORTS.includes(sort) ? sort : "best",
    });
    return Response.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bad request" }, { status: 400 });
  }
}
