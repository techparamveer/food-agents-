# Restaurants

Places near the venue, ranked by estimated cost per head, ETA and rating. Owned by the Restaurants part;
the Planner calls `findRestaurants`.

## `findRestaurants` (stable contract)

```ts
import { findRestaurants } from "@/lib/restaurants/find"; // server only

const { restaurants, source, warnings } = await findRestaurants({
  slotTime: "2026-11-14T18:30:00Z", // required: when food must be on the table
  headcount: 150,                   // required
  maxPerHead: 8,                    // optional, GBP
  dietary: ["vegan"],               // optional hard filter: must cover every need
  dietaryMix: event.dietaryMix,     // optional soft ranking boost
  venue: event.venue,               // optional, defaults to the OxHack venue
  // cuisines, openAtSlot (default true), sort ("best" | "cost" | "eta" | "rating"), radiusMeters
});
```

- `restaurants` are shared `Restaurant`s (`lib/types.ts`) plus `etaMinutes`, `orderBy` (ISO, slot − ETA),
  `totalCost`, `openAtSlot`, `catering`, `platforms` (all three platforms, listed or not) and `score`,
  sorted best first. `delivery` holds only the platforms we think list it, plus `direct` when it caters.
- `source` is `live`, `cache` or `fallback`. It never throws for upstream failures: without keys, or if
  Places fails, it returns the seeded Oxford list (`lib/restaurants/seed.ts`) and explains in `warnings`.
  It throws only for an unparseable `slotTime`.
- HTTP: `GET /api/restaurants?slot=&headcount=&maxPerHead=&dietary=&cuisine=&open=0&sort=`.

## How the numbers are made

| Value | Source |
| --- | --- |
| Name, address, distance, rating, hours, price level, maps URL | Places API (New) Nearby Search, field-masked (`lib/places.ts`) |
| Cost per head, catering, prep time, platform listing and fees | Gemini with Google Search grounding (`lib/estimates.ts`), each with a source URL |
| Anything Gemini can't ground | Labelled heuristics (`lib/restaurants/estimate-parse.ts`) linking the Maps listing or a platform search |
| Travel | Distance × 1.3 road factor at 15 km/h + 5 min handover (`lib/restaurants/geo.ts`) |
| ETA | prep + travel; platform ETAs add a few minutes' dispatch |

Ranking (`lib/restaurants/rank.ts`): 45% cost per head, 30% ETA, 25% rating (shrunk toward neutral when
there are few reviews), plus an optional dietary-coverage boost. Places closed at the slot are halved, so they
sink rather than vanish when the "Open at" filter is off.

## Caching

`lib/restaurants/cache.ts`: memory first, then the Supabase `api_cache` table when `NEXT_PUBLIC_SUPABASE_URL`
and `SUPABASE_SECRET_KEY` are set (migration in `supabase/migrations/`), otherwise JSON files in the OS temp
dir. Places results are kept for 24 h. Grounded estimates are kept for 72 h per restaurant and headcount band of 25.

## Env

`GOOGLE_PLACES_API_KEY`, `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-3.8-flash`),
optional `COMEDA_CACHE=file` to skip Supabase.

## Tests

`npm test` runs every `scripts/test-*.ts` with tsx; `scripts/test-restaurants.ts` covers ETA maths,
opening hours across midnight and the clock change, Places and Gemini response parsing, ranking, filters and the fallback.
