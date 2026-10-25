/** Same field names as the shared `Venue` / `Restaurant` types. */
export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle (haversine) distance in metres. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Streets aren't straight: central Oxford routes run ~1.3× the crow-flies distance. */
export const ROAD_FACTOR = 1.3;
/** Mixed bike/moped courier speed through the centre, km/h. */
export const COURIER_KMH = 15;
/** Pickup, parking, finding the venue door. */
export const HANDOVER_MINUTES = 5;

/** Courier travel time from straight-line distance, whole minutes (rounded up). */
export function travelMinutes(distance: number): number {
  const km = (Math.max(0, distance) * ROAD_FACTOR) / 1000;
  return Math.ceil((km / COURIER_KMH) * 60 + HANDOVER_MINUTES);
}

/**
 * Kitchen time for a bulk order when nothing better is known:
 * `base` minutes for the first 20 portions, +10 per further 50, capped at two hours.
 */
export function bulkPrepMinutes(headcount: number, base = 20): number {
  const extra = Math.ceil(Math.max(0, headcount - 20) / 50) * 10;
  return Math.min(120, base + extra);
}

/** ETA = prep time + travel time computed from distance. */
export function etaMinutes(prepMinutes: number, distance: number): number {
  return Math.round(prepMinutes) + travelMinutes(distance);
}

/** Latest order time for food to land at `slot`. */
export function orderByTime(slot: Date, eta: number): Date {
  return new Date(slot.getTime() - eta * 60_000);
}

/** Google Maps directions from the restaurant to the venue. Cycling is the closest public stand-in for a courier. */
export function directionsUrl(restaurant: LatLon, venue: LatLon, mode: "bicycling" | "driving" = "bicycling") {
  return `https://www.google.com/maps/dir/?api=1&origin=${restaurant.lat},${restaurant.lon}&destination=${venue.lat},${venue.lon}&travelmode=${mode}`;
}

/* ---------- Routes API ---------- */

/** "633s" → 633. Anything else → undefined. */
export function durationSeconds(value: unknown): number | undefined {
  const m = typeof value === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return m ? Number(m[1]) : undefined;
}

/** Courier minutes from a Routes driving time: the drive (rounded up) plus the handover. */
export const routeTravelMinutes = (seconds: number) => Math.ceil(seconds / 60) + HANDOVER_MINUTES;

/**
 * Driving seconds per origin from a `computeRouteMatrix` response (many origins → one venue).
 * Index i is origin i; undefined where Google found no route or the element failed.
 */
export function parseRouteMatrix(body: unknown, origins: number): (number | undefined)[] {
  const out: (number | undefined)[] = Array.from({ length: origins }, () => undefined);
  for (const el of Array.isArray(body) ? body : []) {
    const e = el as { originIndex?: number; condition?: string; status?: { code?: number }; duration?: unknown };
    const i = e.originIndex ?? 0; // proto3 drops zero values, so a missing index is origin 0
    if (!Number.isInteger(i) || i < 0 || i >= origins || e.condition !== "ROUTE_EXISTS" || e.status?.code) continue;
    out[i] = durationSeconds(e.duration);
  }
  return out;
}
