import { clientIp, createRateLimiter, tooManyRequests } from "@/lib/rate-limit";
import { placePhotoUrl } from "@/lib/restaurants/find";

/* A page of restaurants loads ~20 photos, so the limit is looser than search. Upstream cost is
   bounded by the photo cache and the allow-list of cached places, not by this. */
const perIp = createRateLimiter({ limit: 120, windowMs: 60_000 });

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/**
 * GET /api/restaurants/photo?place=<Google place id>
 *
 * Redirects to the place's photo (a key-free googleusercontent.com URL), or 404 when there is
 * none, so the tile shows its letter instead. The Places key never reaches the browser.
 */
export async function GET(request: Request) {
  const limit = perIp.hit(clientIp(request.headers));
  if (!limit.ok) return tooManyRequests(limit);
  const place = new URL(request.url).searchParams.get("place") ?? "";
  if (!PLACE_ID.test(place)) return new Response(null, { status: 400 });
  const uri = await placePhotoUrl(place);
  if (!uri) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=600" } });
  return new Response(null, { status: 302, headers: { Location: uri, "Cache-Control": "public, max-age=3600" } });
}
