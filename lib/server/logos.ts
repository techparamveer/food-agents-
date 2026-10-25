import "server-only";
import { HOUR, cacheGet, cacheSet } from "@/lib/restaurants/cache";
import { cachedPlace } from "@/lib/restaurants/find";
import { MIN_LOGO_PX, faviconServiceUrl, pickIcon, pngSize, publicUrl } from "@/lib/restaurants/logo";

/* Resolves a restaurant's logo URL from its website: the site's own large icon, else Google's
   favicon service when it has one at least MIN_LOGO_PX wide. Only places in the cached search
   qualify, results are cached for a week, and nothing here uses an API key. */

const LOGO_TTL = 7 * 24 * HOUR;
const NO_LOGO_TTL = 24 * HOUR;
const UA = "Mozilla/5.0 (compatible; ComedaBot/1.0; +https://comeda.app)";
const inflight = new Map<string, Promise<string | null>>();

/** GET with redirects followed by hand, so every hop is checked against `publicUrl`. */
async function getPublic(start: string, accept: string): Promise<Response | null> {
  let url = publicUrl(start);
  for (let hop = 0; url && hop < 4; hop++) {
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(6_000), cache: "no-store" });
    if (res.status < 300 || res.status >= 400) return res.ok ? res : null;
    const next = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    url = next ? publicUrl(next, url.href) : null;
  }
  return null;
}

/** Up to `max` bytes of a body. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, max);
}

async function isImage(url: string) {
  const res = await getPublic(url, "image/*");
  const ok = Boolean(res && (res.headers.get("content-type") ?? "").startsWith("image/"));
  await res?.body?.cancel().catch(() => {});
  return ok;
}

async function resolveLogo(website: string): Promise<string | null> {
  const site = publicUrl(website);
  if (!site) return null;
  // 1. The homepage's own icon: usually the real logo, at 180 px or more.
  const page = await getPublic(`${site.origin}/`, "text/html").catch(() => null);
  if (page && (page.headers.get("content-type") ?? "").includes("html")) {
    const html = new TextDecoder().decode(await readCapped(page, 512_000));
    const icon = pickIcon(html, page.url || `${site.origin}/`);
    if (icon && (await isImage(icon).catch(() => false))) return icon;
  } else await page?.body?.cancel().catch(() => {});
  // 2. Google's favicon service, if it has something big enough (it 404s when it has nothing).
  const fallback = faviconServiceUrl(site.hostname);
  const res = await fetch(fallback, { signal: AbortSignal.timeout(6_000), cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  const bytes = await readCapped(res, 200_000);
  const png = pngSize(bytes);
  const big = png ? Math.min(png.width, png.height) >= MIN_LOGO_PX : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.length > 1_000;
  return big ? fallback : null;
}

/** Logo URL for a cached place, or null when it has no website or no usable logo. */
export async function placeLogoUrl(placeId: string): Promise<string | null> {
  const cacheKey = `logo:v2:${placeId}`;
  const hit = await cacheGet<{ url: string | null }>(cacheKey);
  if (hit) return hit.url;
  const website = (await cachedPlace(placeId))?.websiteUrl;
  if (!website) return null;
  let p = inflight.get(placeId);
  if (!p) {
    p = (async () => {
      let url: string | null = null;
      try {
        url = await resolveLogo(website);
      } catch (error) {
        console.error("[restaurants] logo failed:", error instanceof Error ? error.message.slice(0, 200) : error);
      }
      await cacheSet(cacheKey, { url }, url ? LOGO_TTL : NO_LOGO_TTL);
      return url;
    })().finally(() => inflight.delete(placeId));
    inflight.set(placeId, p);
  }
  return p;
}
