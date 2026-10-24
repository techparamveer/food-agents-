/** Same-site path only, so auth redirects cannot bounce people off Comeda. */
export function safePath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.includes("://") || next.includes("\\")) return fallback;
  return next;
}
