import { clientIp, createRateLimiter, tooManyRequests } from "@/lib/rate-limit";
import { placeLogoUrl } from "@/lib/server/logos";

/* ~20 logos per page of restaurants. Results are cached for a week, so this mostly answers from cache. */
const perIp = createRateLimiter({ limit: 120, windowMs: 60_000 });

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/**
 * GET /api/restaurants/logo?place=<Google place id>
 *
 * Redirects to the restaurant's logo (from its own website, or Google's favicon service), or 404
 * when there isn't a good one, so the tile falls back to the photo, then the letter.
 */
export async function GET(request: Request) {
  const limit = perIp.hit(clientIp(request.headers));
  if (!limit.ok) return tooManyRequests(limit);
  const place = new URL(request.url).searchParams.get("place") ?? "";
  if (!PLACE_ID.test(place)) return new Response(null, { status: 400 });
  const url = await placeLogoUrl(place);
  if (!url) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "public, max-age=86400" } });
}
