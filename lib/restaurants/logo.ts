/* Picking a restaurant's logo from its website. Pure: no fetch, no env, safe for scripts/test-*.ts.
   Places has no logo field, so the logo is the site's own large icon (apple-touch-icon or a
   ≥64 px icon), falling back to Google's favicon service. */

/** Smaller icons look blurry in a tile; below this the tile shows the photo instead. */
export const MIN_LOGO_PX = 64;

/** Only public web hosts: no IP literals, localhost or internal names. Websites come from Places,
    but the server fetches them, so don't let one point it at the private network. */
export function publicUrl(raw: string, base?: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.includes(":") || host.startsWith("[")) return null;
  if (/^\d+(\.\d+){3}$/.test(host) || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
  if (url.username || url.password) return null;
  return url;
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined);

/** Largest side declared in `sizes` ("180x180", "32x32 64x64", "any"). "any" means scalable only for
    an SVG; on a .ico it's usually a bundle of 16–48 px favicons. */
function declaredSize(sizes: string | undefined, fallback: number, svg: boolean) {
  if (!sizes) return fallback;
  if (/\bany\b/i.test(sizes)) return svg ? 256 : fallback;
  const sides = [...sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)].map((m) => Math.min(Number(m[1]), Number(m[2])));
  return sides.length ? Math.max(...sides) : fallback;
}

/**
 * The best logo a page declares: the largest apple-touch-icon or sized icon of at least
 * MIN_LOGO_PX, as an absolute https URL. Mask icons (one-colour SVG outlines) don't count.
 */
export function pickIcon(html: string, pageUrl: string): string | null {
  let best: { url: string; size: number } | null = null;
  for (const [tag] of html.slice(0, 500_000).matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || rel.includes("mask-icon") || !/(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut icon)(\s|$)/.test(rel)) continue;
    const touch = rel.includes("apple-touch-icon");
    // Unsized apple-touch-icons are 180 px by convention; unsized plain icons are usually 16–32 px.
    const svg = /svg/i.test(attr(tag, "type") ?? "") || /\.svg(\?|#|$)/i.test(href);
    const size = declaredSize(attr(tag, "sizes"), touch ? 180 : 32, svg) + (touch ? 1 : 0);
    const url = publicUrl(href.replace(/&amp;/g, "&"), pageUrl);
    if (!url || url.protocol !== "https:" || size < MIN_LOGO_PX) continue;
    if (!best || size > best.size) best = { url: url.href, size };
  }
  return best?.url ?? null;
}

/** Google's favicon service for a host, sized for tiles. It answers 404 when it has nothing. */
export const faviconServiceUrl = (host: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;

/** Width × height of a PNG, or null for anything else. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
