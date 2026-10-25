/* Loads the OxHack demo event into the database for an organiser.

     npx tsx scripts/seed-oxhack.ts organiser@example.com            print the SQL
     npx tsx scripts/seed-oxhack.ts organiser@example.com --apply    run it on the linked project
     … --replace                                                     delete that organiser's existing OxHack first

   The organiser must have signed in once (magic link) so their account exists. Loads the event,
   its 5 meal slots, 150 attendees (with the demo's placeholder QR hashes, so /demo/qr-sheet scans),
   the 3 seeded orders, the plan and the 138 Saturday-lunch meal logs: the same data /demo shows.
   Runs through the Supabase CLI (`supabase db query --linked`), so no service-role key is involved.
   /demo itself never reads the database and is unaffected. */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { savePlanPayload } from "@/lib/db/mappers";
import { OXHACK } from "@/lib/seed/oxhack";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: npx tsx scripts/seed-oxhack.ts organiser@example.com [--apply] [--replace]");
  process.exit(1);
}

const q = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

const { event, slots, attendees, orders, mealLogs, plan, restaurants } = OXHACK;
const eventId = randomUUID();
const slotIds = new Map(slots.map((s) => [s.id, randomUUID()]));
const attendeeIds = new Map(attendees.map((a) => [a.id, randomUUID()]));
const planId = randomUUID();
const user = `(select id from auth.users where lower(email) = ${q(email)})`;
const payload = savePlanPayload(OXHACK);

const sql = `-- OxHack seed for ${email}
begin;

do $$
begin
  if not exists (select 1 from auth.users where lower(email) = ${q(email)}) then
    raise exception 'No Comeda account for ${email.replace(/'/g, "''")}: sign in once with a magic link, then run this again';
  end if;
  ${
    args.includes("--replace")
      ? `delete from public.events where name = ${q(event.name)} and created_by = ${user};`
      : `if exists (select 1 from public.events where name = ${q(event.name)} and created_by = ${user}) then
    raise exception '${email.replace(/'/g, "''")} already has ${event.name}: pass --replace to load it again';
  end if;`
  }
end $$;

insert into public.events (id, created_by, name, venue_name, venue_address, venue_postcode, venue_lat, venue_lng, timezone, starts_at, ends_at, headcount, budget, currency, dietary_mix)
values (${q(eventId)}, ${user}, ${q(event.name)}, ${q(event.venue.name)}, ${q(event.venue.address)}, ${q(event.venue.postcode)}, ${event.venue.lat}, ${event.venue.lon}, 'Europe/London', ${q(event.startsAt)}, ${q(event.endsAt)}, ${event.headcount}, ${event.budget}, 'GBP', ${j(event.dietaryMix)});

insert into public.meal_slots (id, event_id, label, kind, serves_at, headcount, allowance) values
${slots.map((s) => `  (${q(slotIds.get(s.id)!)}, ${q(eventId)}, ${q(s.label)}, ${q(s.kind)}, ${q(s.servesAt)}, ${s.headcount}, ${s.allowance})`).join(",\n")};

insert into public.attendees (id, event_id, name, discord_handle, qr_hash, dietary) values
${attendees.map((a) => `  (${q(attendeeIds.get(a.id)!)}, ${q(eventId)}, ${q(a.name)}, ${q(a.discordHandle)}, ${q(a.qrHash)}, ${q(a.dietary ?? null)})`).join(",\n")};

insert into public.plans (id, event_id, source, status, slots, total, total_source, generated_at, approved_at) values
  (${q(planId)}, ${q(eventId)}, ${q(plan.source)}, 'approved', ${j(plan.slots.map((s) => ({ ...s, slotId: slotIds.get(s.slotId) })))}, ${plan.total.value}, ${j(plan.total.source)}, ${q(plan.generatedAt)}, ${q(plan.generatedAt)});

insert into public.orders (event_id, slot_id, plan_id, restaurant_id, restaurant, platform, status, lines, total, total_source, total_is_estimate, order_by) values
${orders
  .map((o) => {
    const restaurant = restaurants.find((r) => r.id === o.restaurantId) ?? payload.orders.find((p) => p.slotId === o.slotId)?.restaurant;
    return `  (${q(eventId)}, ${q(slotIds.get(o.slotId)!)}, ${q(planId)}, ${q(o.restaurantId)}, ${j(restaurant)}, ${q(o.platform)}, ${q(o.status)}, ${j(o.lines)}, ${o.total.value}, ${j(o.total.source)}, ${o.total.isEstimate}, ${q(o.orderBy)})`;
  })
  .join(",\n")};

-- Historical serves keep their times (the allowance trigger checks each at its served_at).
insert into public.meal_logs (event_id, slot_id, attendee_id, method, served_at) values
${mealLogs.map((l) => `  (${q(eventId)}, ${q(slotIds.get(l.slotId)!)}, ${q(attendeeIds.get(l.attendeeId)!)}, ${q(l.method)}, ${q(l.at)})`).join(",\n")};

select ${q(eventId)} as event_id, (select count(*) from public.attendees where event_id = ${q(eventId)}) as attendees;
commit;
`;

if (!args.includes("--apply")) {
  process.stdout.write(sql);
  process.exit(0);
}

const file = path.join(mkdtempSync(path.join(tmpdir(), "comeda-seed-")), "seed.sql");
writeFileSync(file, sql);
const run = spawnSync("supabase", ["db", "query", "--linked", "-f", file], { encoding: "utf8" });
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
if (run.status !== 0 || /"_tag":"Error"|ERROR:/.test(out)) {
  console.error(out.trim());
  process.exit(1);
}
console.log(`Loaded ${event.name} for ${email}: event ${eventId}, ${slots.length} slots, ${attendees.length} attendees, ${orders.length} orders, ${mealLogs.length} meal logs.`);
