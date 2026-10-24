# Comeda 🍕

Food planning for hackathon organisers: meal slots, restaurant picks, bulk orders with deadlines,
a Gemini food planner and a QR meal check. The demo plans OxHack (150 people, Oxford, £5,000).
See [`docs/SPEC.md`](docs/SPEC.md) for the agreed spec.

The UI is a 1:1 copy of Sprout's visual system (Next.js 16, plain CSS), rebranded.

## Run it

```bash
npm install
cp ~/.config/comeda/env .env.local   # real keys; never commit them
npm run dev                           # http://localhost:3000 and http://localhost:3000/demo
```

Keys are optional: without them every view falls back to the seeded OxHack data.
`.env.example` lists the variables (`GOOGLE_PLACES_API_KEY`, `GEMINI_API_KEY`).

Before pushing: `npm run lint && npm test && npm run build`. Tests are plain `scripts/test-*.ts` files run with tsx.

## Layout

| Path | What |
| --- | --- |
| `app/(marketing)/page.tsx` | Landing page |
| `app/(app)/login/page.tsx` | Sign-in screen; leads to the demo for now |
| `app/demo/page.tsx` | Organiser dashboard with seeded data, no auth (`?section=`, `?settings=`, `?play=1`) |
| `components/dashboard/home-screen.tsx` | Dashboard shell: sidebar, planner pane, main panel |
| `components/dashboard/overview-view.tsx` | Overview: next meal, order deadlines, budget |
| `components/dashboard/restaurants-view.tsx` | Restaurants ranked by estimated cost per head |
| `components/dashboard/orders-view.tsx` | Orders: one bulk order per meal slot |
| `components/dashboard/meal-check-view.tsx` | Meal check: name search (QR scanner to come) |
| `components/dashboard/planner-pane.tsx` | "Get it done" planner card and the Gemini food planner chat |
| `components/dashboard/planner-state.tsx` | `PlannerProvider`: the latest plan, approve/swap, order status and quantities |
| `lib/planner.ts` | Deterministic planner: meal slots, dietary split, restaurant picks, budget fitting |
| `lib/countdown.ts` | Order-by = serving time − prep − delivery, and live countdown labels |
| `lib/plan-sync.ts` | Writes a plan into the event: stable slot ids, placed orders left alone |
| `lib/restaurant-search.ts` | Adapter over `findRestaurants` (seeded until the Restaurants work merges) |
| `lib/server/food-chat.ts` | Chat turn: Gemini picks tools and narrates, the planner does the maths |
| `components/dashboard/order-builder-pane.tsx` | Order builder: quantities by dietary need, link out |
| `components/dashboard/data.tsx` | `DashboardProvider`, `useDashboard()` and formatting helpers |
| `lib/types.ts` | Shared domain types |
| `lib/seed/oxhack.ts` | Seeded OxHack event |
