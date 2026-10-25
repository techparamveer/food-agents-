import { clientIp, createRateLimiter, tooManyRequests } from "@/lib/rate-limit";
import { generatePlanNarrative, type PlanNarrativeInput } from "@/lib/server/plan-narrative";
import { DIETARY, type Dietary } from "@/lib/types";

export const maxDuration = 30;

const perIp = createRateLimiter({ limit: 20, windowMs: 60_000 });
const MAX_BODY_BYTES = 32_000;
const NEEDS = new Set<Dietary>(DIETARY.map((dietary) => dietary.id));

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000 ? value : undefined);
const dietary = (value: unknown): Dietary[] =>
  Array.isArray(value) ? value.filter((item): item is Dietary => typeof item === "string" && NEEDS.has(item as Dietary)).slice(0, NEEDS.size) : [];

function parseInput(value: unknown): PlanNarrativeInput | undefined {
  const body = record(value);
  if (!body || (body.source !== "live" && body.source !== "cache" && body.source !== "fallback")) return undefined;
  const budget = number(body.budget);
  const total = number(body.total);
  const remaining = number(body.remaining);
  if (budget === undefined || total === undefined || remaining === undefined || typeof body.fits !== "boolean") return undefined;

  const meals = (Array.isArray(body.meals) ? body.meals : []).slice(0, 40).flatMap((value) => {
    const meal = record(value);
    const label = text(meal?.label, 80);
    const restaurantId = text(meal?.restaurantId, 160);
    return label && restaurantId ? [{ label, restaurantId, missing: dietary(meal?.missing) }] : [];
  });
  const restaurants = (Array.isArray(body.restaurants) ? body.restaurants : []).slice(0, 60).flatMap((value) => {
    const restaurant = record(value);
    const id = text(restaurant?.id, 160);
    const name = text(restaurant?.name, 160);
    return id && name ? [{ id, name, serves: dietary(restaurant?.serves) }] : [];
  });
  if (!meals.length || !restaurants.length) return undefined;
  return { source: body.source, budget, total, remaining, fits: body.fits, meals, restaurants };
}

export async function POST(request: Request) {
  const limit = perIp.hit(clientIp(request.headers));
  if (!limit.ok) return tooManyRequests(limit, "Too many plan summaries. Try again in a minute.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const input = parseInput(parsed);
  if (!input) return Response.json({ error: "Invalid restaurant plan" }, { status: 400 });
  try {
    return Response.json({ narrative: await generatePlanNarrative(input) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "AI plan summary is unavailable" }, { status: 503 });
  }
}
