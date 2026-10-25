/* Per-key sliding-window rate limiting, in memory. Enough for a demo on one server: each instance
   keeps its own counts, so the real ceiling is limit × instances. Pure apart from the clock. */

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

export type RateLimiter = {
  /** Counts one hit for `key` and says whether it's allowed. Refused hits don't count. */
  hit: (key: string) => RateLimitResult;
  reset: () => void;
};

/** Keys tracked at once before old ones are swept, so a flood of fake IPs can't grow memory forever. */
const MAX_KEYS = 10_000;

export function createRateLimiter({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const hits = new Map<string, number[]>();

  const sweep = (t: number) => {
    for (const [key, times] of hits) if (!times.length || times[times.length - 1] <= t - windowMs) hits.delete(key);
    // Still full of live keys: drop the oldest tenth, so the next sweep is a while away.
    for (const key of hits.keys()) {
      if (hits.size < MAX_KEYS * 0.9) break;
      hits.delete(key);
    }
  };

  return {
    hit(key) {
      const t = now();
      if (!hits.has(key) && hits.size >= MAX_KEYS) sweep(t);
      const times = (hits.get(key) ?? []).filter((at) => at > t - windowMs);
      if (times.length >= limit) {
        hits.set(key, times);
        return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((times[0] + windowMs - t) / 1000)) };
      }
      times.push(t);
      hits.delete(key); // re-insert so Map order tracks recency for the sweep
      hits.set(key, times);
      return { ok: true, remaining: limit - times.length, retryAfterSeconds: 0 };
    },
    reset: () => hits.clear(),
  };
}

/** The caller's IP from proxy headers (Vercel and most proxies set x-forwarded-for), else "unknown". */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}

/** A 429 the client can show as-is. */
export function tooManyRequests(result: RateLimitResult, message = "Too many requests. Try again in a moment.") {
  return Response.json({ error: message }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
}
