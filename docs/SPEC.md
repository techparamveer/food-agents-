# Comeda 🍕 — spec

Food planning web app for hackathon organisers. Demo target: an OxHack mockup.
UI is a 1:1 copy of `/Volumes/DeveloperStorage/GitHub/sprout-careers-better` (Next.js 16 + Supabase,
same CSS files/approach, same logo animations), rebranded to Comeda with a 🍕 logo and food icons.
Web app only (responsive, phone-browser friendly for scanning). Not a mobile app.

## Users
- **Organisers only** log in. They also run the QR meal check at the food table.
- Students are records (seeded attendees), never log in.
- Discord: out of scope. Attendees carry a mock Discord handle + avatar; a disabled
  "Coming soon: notify on Discord" toggle in settings is the only Discord UI.

## Demo scope
- `/demo` with no auth (like Sprout's `/demo`), seeded OxHack event. Landing page copied + rebranded.
  Login page kept as a copied screen that leads to the demo.
- Live APIs when keys exist, cached, always with a seeded fallback so the demo never breaks.

## Env (never commit; keys live at `~/.config/comeda/env`, copy to `.env.local`)
- `GOOGLE_PLACES_API_KEY` — Places API (New): nearby restaurants, distance, rating, hours, price level.
- `GEMINI_API_KEY` — Gemini with Google Search grounding: per-head cost estimates, catering menus,
  delivery fee estimates; also powers the planner chat pane.

## Core flow ("get it done")
Organiser enters headcount, budget, event dates, rough dietary mix (defaults prefilled: 150 people,
£5,000, OxHack weekend, ~15% veg / 8% vegan / 4% halal / 3% GF). Comeda proposes meal slots from the
dates, picks a restaurant per slot, sets quantities by dietary split, keeps the total under budget.
Organiser approves or swaps per slot. Comeda never places orders: Order builder links out to the
restaurant/platform.

## Dashboard (Sprout view → Comeda view), each its own minimal section like Sprout
- Home → **Overview**: next meal slot, order-deadline countdowns, budget spent vs total.
- Roles → **Restaurants**: Places results ranked by est. cost/head, ETA, rating; filters.
  All numbers labelled "estimate" with a source link. ETA = prep time + travel time from distance.
  Compare delivery fees + ETAs across platforms (estimates).
- Applications → **Orders**: bulk order per meal slot, status, deadline countdown
  ("order by 17:40 for 18:30 dinner" = slot time − prep − delivery), cost.
- Prep → **Meal check**: QR scanner (browser camera) + name-search fallback; attendee list;
  meals eaten / remaining; per-slot allowance; big ✅ / ⛔ result showing mock Discord name + avatar.
  QR payload is a hash; real hashes come later — use placeholder hashes in a swappable format
  (one module owns hash → attendee resolution).
- Chat pane → **Gemini food planner** ("feed 150, 20 vegan, by 7pm, under £600").
- Apply pane → **Order builder**: quantities by dietary need + ordering link.

## Out of scope
Discord bot/webhooks, real ordering, student pre-orders, payments, multi-tenant signup.
