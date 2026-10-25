# Comeda backend

Supabase (Postgres + Auth + Realtime) behind typed repositories and signed-in API routes.
`/demo` doesn't use any of it: it keeps rendering the seeded OxHack data from `lib/seed/oxhack.ts`.

## Schema (`supabase/migrations/`)

| Table | What | Notes |
| --- | --- | --- |
| `events` | Name, venue (name, address, postcode, lat/lng), IANA `timezone`, `starts_at`/`ends_at`, headcount, budget, `currency`, `dietary_mix` (jsonb shares 0–1) | `created_by` defaults to `auth.uid()`; a trigger makes the creator its organiser. The timezone is checked against `pg_timezone_names`. |
| `event_members` | `role` `organiser` \| `staff` per event; pending invites have `invited_email` and no `user_id` | Unique per (event, user) and (event, email). An event always keeps one organiser. |
| `meal_slots` | Label, kind, `serves_at`, headcount, meal check rules (`allowance` servings, `seconds_after_minutes`, `seconds`, `opens_before_minutes`, `closes_after_minutes`) | Same rules as `lib/allowance.ts`. |
| `plans` | The planner's proposals: `slots` (PlanSlot[] jsonb), total, source, `draft` \| `approved` | Newest is current. |
| `orders` | One per slot: restaurant snapshot (jsonb `Restaurant`), platform, status, `lines` (OrderLine[] jsonb), total, `order_by` deadline, `ordered_at` | `ordered_at` follows the status (trigger). |
| `attendees` | Name, email, Discord handle, `qr_hash` (unique per event; random `q_…` by default), dietary | Students are records, never users. |
| `meal_logs` | Attendee, slot, `method`, `served_at`, `served_by`, `undone_at`, `undone_by` | Never deleted; undo stamps `undone_at`. Every insert passes the allowance check. |
| `api_cache` | Places/Gemini TTL cache | Server-only (secret key); no client access. |

Orders and meal logs reference slots and attendees through composite foreign keys on `(event_id, id)`,
so a row can never point at another event's slot or attendee. Every foreign key is indexed;
`updated_at` triggers run on every mutable table.

## Access (RLS on every table)

One membership check, `private.is_event_member(event_id, role?)`: a `security definer` function in the
unexposed `private` schema that only ever answers for `auth.uid()`.

| | organiser | staff | anyone else |
| --- | --- | --- | --- |
| event | read, update, delete | read | nothing (looks like 404) |
| team | read, invite by email, change roles, remove | read, leave | nothing |
| slots, plans, orders, attendees | everything | read | nothing |
| meal logs | read, serve, undo | read, serve, undo | nothing |

- `anon` has no table grants at all; `authenticated` gets only the verbs above (column grants limit
  member updates to `role` and log updates to `undone_at`).
- Anonymous sign-ins are off; sign-in is email magic link only.
- Realtime is on for `meal_logs` and `orders`, and applies the same select policies.

## RPCs (`supabase.rpc`, all security invoker)

| Function | Does |
| --- | --- |
| `serve_meal(p_slot_id, p_attendee_id, p_method)` | Checks the slot's allowance under a per-(slot, attendee) advisory lock and serves, or returns `{ ok: false, code }` (`not-open`, `closed`, `used`, `seconds-later`). Two devices can't double-serve. |
| `undo_meal(p_log_id)` | Stamps `undone_at`/`undone_by` once. |
| `accept_invites()` | Claims pending invites for the caller's confirmed email (called by `/auth/confirm`). |
| `import_attendees(p_event_id, p_rows)` | Bulk insert; one result per row (`attendee_id` or `error`), bad rows never block good ones. |
| `save_plan(p_event_id, p_plan)` | One transaction: event numbers, slots reconciled (new client ids → uuids), plan stored, planned orders rewritten, placed orders untouched. |

## Data layer (`lib/db/`)

Repositories take a typed client (`Db`) and run as its user, so RLS applies:
`events.ts` (list, get, create, update, delete, `loadEventData` → `EventData`), `members.ts`, `slots.ts`,
`plans.ts`, `orders.ts`, `attendees.ts` (CSV import), `meal-logs.ts` (serve, undo, list,
`subscribeToMealLogs`, `subscribeToOrders`). `mappers.ts` converts rows to and from `lib/types.ts`;
`csv.ts` parses attendee CSVs; `validate.ts` checks API bodies. Types: `lib/supabase/database.types.ts`
(`npm run db:types`).

Server code: `const db = await createClient()` from `lib/supabase/server.ts`.
Browser (Realtime): `createClient()` from `lib/supabase/client.ts`.

## API (all JSON, signed in, 401 otherwise)

| Route | |
| --- | --- |
| `GET /api/events` · `POST /api/events` | My events · create (caller becomes organiser) |
| `GET/PATCH/DELETE /api/events/:id` | Full `EventData` · update · delete |
| `GET/POST /api/events/:id/members` · `PATCH/DELETE …/members/:memberId` | Team · invite `{ email, role }` · change role · remove |
| `GET/POST /api/events/:id/plan` | Latest plan · save `savePlanPayload(…, { approve })` |
| `PATCH /api/events/:id/orders/:orderId` | `{ status?, lines?, platform? }` |
| `PATCH /api/events/:id/slots/:slotId` | Meal check rules |
| `GET/POST /api/events/:id/attendees` | List · import (`text/csv` body, or `{ rows }`) → per-line results |
| `GET/POST /api/events/:id/meals` · `DELETE …/meals/:logId` | Logs · serve `{ slotId, attendeeId, method }` · undo |

`/api/restaurants?eventId=…` and `/api/chat` `{ eventId }` plan for that event's venue, timezone,
headcount and dietary mix (members only, else 404). Without `eventId` they plan the OxHack demo.

## Auth

- `signInWithMagicLink` (server action, `app/auth/actions.ts`) sends the link; `signOut` ends the session.
- `/auth/confirm` accepts both `?code=` (Supabase's default email, same browser) and
  `?token_hash=&type=` (the custom template in `supabase/templates/`, any device; needs custom SMTP on
  the free tier). It then claims staff invites and redirects to `next`.
- `lib/supabase/proxy.ts`: `PROTECTED` pages (`/app`, `/events`) send signed-out visitors to `/login`.
- Auth URLs live in `supabase/config.toml` (`supabase config push`).

## Commands

```bash
npm run test:db                      # RLS + RPC checks on the linked database (rolls back)
npm run db:types                     # regenerate lib/supabase/database.types.ts
npm run seed:oxhack -- you@x.com --apply   # load OxHack for an organiser who has signed in once
supabase db push --linked            # apply new migrations
supabase db advisors --linked        # security + performance lints
```
