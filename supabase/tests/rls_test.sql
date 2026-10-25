-- RLS and RPC checks for Comeda. Runs in one transaction and rolls back, so it leaves nothing behind:
--   npm run test:db        (supabase db query --linked -f supabase/tests/rls_test.sql)
-- Any failed check raises an exception naming it; success ends with a single row: result = 'ALL PASSED'.
-- Users are simulated the way PostgREST does it: `set local role authenticated` plus request.jwt.claims.

begin;

create temporary table _ids (k text primary key, v uuid) on commit drop;
grant all on _ids to authenticated, anon;

-- Three throwaway users: organiser A, organiser B, staff S (invited to A's event by email).
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'rls-a@comeda.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'rls-b@comeda.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'rls-staff@comeda.test', now(), '{}', '{}', now(), now());

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.expect(p_ok boolean, p_name text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_name;
  end if;
end;
$$;

/* ---------- A and B each create an event ---------- */

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');
with e as (
  insert into public.events (name, venue_name, venue_lat, venue_lng, starts_at, ends_at, headcount, budget)
  values ('A event', 'Venue A', 51.76, -1.26, now() - interval '1 hour', now() + interval '1 day', 100, 1000)
  returning id
)
insert into _ids select 'ea', id from e;

select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b');
with e as (
  insert into public.events (name, venue_name, venue_lat, venue_lng, starts_at, ends_at, headcount, budget)
  values ('B event', 'Venue B', 51.5, -0.12, now(), now() + interval '1 day', 50, 500)
  returning id
)
insert into _ids select 'eb', id from e;

/* ---------- Isolation between organisers ---------- */

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');
select pg_temp.expect((select count(*) from public.events) = 1, 'A sees only their own event');
select pg_temp.expect(not exists (select 1 from public.events where id = (select v from _ids where k = 'eb')), 'A cannot read B''s event');
select pg_temp.expect(
  (select role from public.event_members where event_id = (select v from _ids where k = 'ea') and user_id = 'a0000000-0000-4000-8000-00000000000a') = 'organiser',
  'creator becomes organiser'
);

do $$
begin
  update public.events set name = 'hijacked' where id = (select v from _ids where k = 'eb');
  perform pg_temp.expect(not found, 'A cannot update B''s event');
  begin
    insert into public.event_members (event_id, invited_email) values ((select v from _ids where k = 'eb'), 'x@comeda.test');
    raise exception 'FAIL: A invited into B''s event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events (name, venue_name, venue_lat, venue_lng, starts_at, ends_at, headcount, created_by)
    values ('spoof', 'v', 0, 0, now(), now() + interval '1 hour', 1, 'b0000000-0000-4000-8000-00000000000b');
    raise exception 'FAIL: A created an event as B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events (name, venue_name, venue_lat, venue_lng, timezone, starts_at, ends_at, headcount)
    values ('tz', 'v', 0, 0, 'Mars/Olympus', now(), now() + interval '1 hour', 1);
    raise exception 'FAIL: accepted an unknown timezone';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- A sets up slots, attendees and an order; invites S as staff.
insert into public.event_members (event_id, invited_email, role) select v, 'rls-staff@comeda.test', 'staff' from _ids where k = 'ea';
with s as (
  insert into public.meal_slots (event_id, label, kind, serves_at, headcount)
  select v, 'Lunch', 'lunch', now(), 100 from _ids where k = 'ea' returning id
) insert into _ids select 'slot', id from s;
with s as (
  insert into public.meal_slots (event_id, label, kind, serves_at, headcount)
  select v, 'Dinner', 'dinner', now() + interval '6 hours', 100 from _ids where k = 'ea' returning id
) insert into _ids select 'later', id from s;
with a as (
  insert into public.attendees (event_id, name, email) select v, 'Ada', 'ada@comeda.test' from _ids where k = 'ea' returning id
) insert into _ids select 'ada', id from a;
with o as (
  insert into public.orders (event_id, slot_id, restaurant_id, restaurant, total)
  select (select v from _ids where k = 'ea'), (select v from _ids where k = 'slot'), 'r1', '{"name": "Pizza"}', 120 returning id
) insert into _ids select 'order', id from o;

select pg_temp.expect(
  (select qr_hash from public.attendees where id = (select v from _ids where k = 'ada')) ~ '^q_[0-9a-f]{32}$',
  'attendees get a random QR hash'
);

select pg_temp.expect(
  (select count(*) from public.import_attendees((select v from _ids where k = 'ea'), '[
    {"name": "Bo", "email": "BO@comeda.test", "dietary": "vegan"},
    {"name": "Bo again", "email": "bo@comeda.test"},
    {"name": "", "email": "c@comeda.test"},
    {"name": "Dee", "dietary": "keto"},
    {"name": "Eve", "email": "not-an-email"},
    {"name": "Fin", "qr_hash": "ph_0000abcd"}
  ]') where error is null) = 2,
  'CSV import keeps good rows'
);
select pg_temp.expect(
  (select array_agg(error order by row_index) from public.import_attendees((select v from _ids where k = 'ea'), '[
    {"name": "Bo", "email": "bo@comeda.test"}, {"name": "Dee", "dietary": "keto"}, {"name": "Gil", "email": "x"}, {"email": "y@comeda.test"}
  ]')) = array['Duplicate email', 'Unknown dietary need (use veg, vegan, halal or gf)', 'Invalid email', 'Name is required'],
  'CSV import reports per-row errors'
);

/* ---------- B sees none of A's data ---------- */

select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b');
select pg_temp.expect((select count(*) from public.meal_slots) = 0, 'B cannot read A''s slots');
select pg_temp.expect((select count(*) from public.attendees) = 0, 'B cannot read A''s attendees');
select pg_temp.expect((select count(*) from public.orders) = 0, 'B cannot read A''s orders');
select pg_temp.expect((select count(*) from public.event_members where event_id = (select v from _ids where k = 'ea')) = 0, 'B cannot read A''s team');
do $$
begin
  perform public.serve_meal((select v from _ids where k = 'slot'), (select v from _ids where k = 'ada'));
  raise exception 'FAIL: B served a meal at A''s event';
exception when no_data_found then null;
end $$;
do $$
begin
  perform public.import_attendees((select v from _ids where k = 'ea'), '[{"name": "x"}]');
  raise exception 'FAIL: B imported into A''s event';
exception when insufficient_privilege then null;
end $$;

/* ---------- Staff: accept the invite, read, serve and undo; never edit ---------- */

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c');
select pg_temp.expect((select count(*) from public.events) = 0, 'invitee sees nothing before accepting');
select pg_temp.expect(public.accept_invites() = 1, 'staff accepts the invite');
select pg_temp.expect((select count(*) from public.events) = 1, 'staff reads the event');
select pg_temp.expect((select count(*) from public.orders) = 1, 'staff reads orders');

do $$
declare
  r jsonb;
  log_id uuid;
begin
  update public.orders set status = 'ordered' where id = (select v from _ids where k = 'order');
  perform pg_temp.expect(not found, 'staff cannot edit orders');
  update public.events set budget = 1 where id = (select v from _ids where k = 'ea');
  perform pg_temp.expect(not found, 'staff cannot edit the event');
  update public.attendees set name = 'x' where id = (select v from _ids where k = 'ada');
  perform pg_temp.expect(not found, 'staff cannot edit attendees');
  begin
    insert into public.orders (event_id, slot_id, restaurant_id) values ((select v from _ids where k = 'ea'), (select v from _ids where k = 'later'), 'r2');
    raise exception 'FAIL: staff created an order';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.event_members (event_id, invited_email) values ((select v from _ids where k = 'ea'), 'friend@comeda.test');
    raise exception 'FAIL: staff invited someone';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.event_members set role = 'organiser' where user_id = 'c0000000-0000-4000-8000-00000000000c';
    perform pg_temp.expect(not found, 'staff cannot promote themselves');
  end;

  -- Serve, refuse the second serving, undo, serve again.
  r := public.serve_meal((select v from _ids where k = 'slot'), (select v from _ids where k = 'ada'), 'qr');
  perform pg_temp.expect((r ->> 'ok')::boolean and (r ->> 'eaten')::int = 1, 'staff serves a meal');
  log_id := (r -> 'log' ->> 'id')::uuid;
  perform pg_temp.expect((r -> 'log' ->> 'served_by')::uuid = 'c0000000-0000-4000-8000-00000000000c', 'served_by is the server');
  r := public.serve_meal((select v from _ids where k = 'slot'), (select v from _ids where k = 'ada'), 'search');
  perform pg_temp.expect(not (r ->> 'ok')::boolean and r ->> 'code' = 'seconds-later', 'no second serving before seconds open');
  begin
    insert into public.meal_logs (event_id, slot_id, attendee_id) select (select v from _ids where k = 'ea'), (select v from _ids where k = 'slot'), (select v from _ids where k = 'ada');
    raise exception 'FAIL: a direct insert skipped the allowance';
  exception when raise_exception then
    if sqlerrm not like 'meal_not_allowed:%' then raise; end if;
  end;
  r := public.serve_meal((select v from _ids where k = 'later'), (select v from _ids where k = 'ada'));
  perform pg_temp.expect(not (r ->> 'ok')::boolean and r ->> 'code' = 'not-open', 'a later slot is not open yet');

  perform public.undo_meal(log_id);
  perform pg_temp.expect((select undone_by from public.meal_logs where id = log_id) = 'c0000000-0000-4000-8000-00000000000c', 'undo is stamped');
  begin
    perform public.undo_meal(log_id);
    raise exception 'FAIL: undid twice';
  exception when no_data_found then null;
  end;
  begin
    update public.meal_logs set served_at = now() - interval '1 day' where id = log_id;
    raise exception 'FAIL: staff rewrote a meal log';
  exception when insufficient_privilege then null;
  end;
  r := public.serve_meal((select v from _ids where k = 'slot'), (select v from _ids where k = 'ada'));
  perform pg_temp.expect((r ->> 'ok')::boolean, 'serve again after undo');
  begin
    delete from public.meal_logs where id = log_id;
    raise exception 'FAIL: staff deleted a meal log';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ---------- Organiser: plans, orders, the last organiser ---------- */

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');
do $$
declare
  r jsonb;
  slot uuid := (select v from _ids where k = 'slot');
begin
  r := public.save_plan((select v from _ids where k = 'ea'), jsonb_build_object(
    'event', jsonb_build_object('headcount', 120),
    'slots', jsonb_build_array(
      jsonb_build_object('id', slot, 'label', 'Lunch', 'kind', 'lunch', 'servesAt', now(), 'headcount', 120),
      jsonb_build_object('id', 'new-breakfast', 'label', 'Breakfast', 'kind', 'breakfast', 'servesAt', now() + interval '20 hours', 'headcount', 120)
    ),
    'orders', jsonb_build_array(
      jsonb_build_object('slotId', slot, 'restaurantId', 'r9', 'restaurant', '{"name": "Noodles"}'::jsonb, 'platform', 'direct',
        'lines', '[{"dietary": "standard", "quantity": 120}]'::jsonb, 'orderBy', now(), 'total', '{"value": 600, "source": {"label": "test"}, "isEstimate": true}'::jsonb),
      jsonb_build_object('slotId', 'new-breakfast', 'restaurantId', 'r3', 'restaurant', '{}'::jsonb, 'lines', '[]'::jsonb, 'total', '{"value": 300}'::jsonb)
    ),
    'plan', jsonb_build_object('source', 'planner', 'slots', jsonb_build_array(
      jsonb_build_object('slotId', 'new-breakfast', 'restaurantId', 'r3', 'status', 'approved')), 'total', '{"value": 900}'::jsonb),
    'approve', true
  ));
  perform pg_temp.expect((r -> 'slotIds' ->> slot::text)::uuid = slot, 'existing slot keeps its id');
  perform pg_temp.expect((select count(*) from public.meal_slots where event_id = (select v from _ids where k = 'ea')) = 2, 'plan dropped the unordered dinner slot and added breakfast');
  perform pg_temp.expect((select restaurant_id from public.orders where slot_id = slot) = 'r9', 'planned order rewritten');
  perform pg_temp.expect((select slots -> 0 ->> 'slotId' from public.plans where id = (r ->> 'planId')::uuid) = r -> 'slotIds' ->> 'new-breakfast', 'plan slot ids remapped');
  perform pg_temp.expect((select status from public.plans where id = (r ->> 'planId')::uuid) = 'approved', 'plan approved');
  perform pg_temp.expect((select headcount from public.events where id = (select v from _ids where k = 'ea')) = 120, 'event headcount saved');

  update public.orders set status = 'ordered', lines = '[{"dietary": "vegan", "quantity": 10}]' where slot_id = slot;
  perform pg_temp.expect((select ordered_at is not null from public.orders where slot_id = slot), 'organiser places an order');

  begin
    delete from public.event_members where user_id = 'a0000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: removed the last organiser';
  exception when check_violation then null;
  end;
end $$;

/* ---------- Signed out: nothing ---------- */

select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
begin
  perform 1 from public.events;
  raise exception 'FAIL: anon read events';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.serve_meal(gen_random_uuid(), gen_random_uuid());
  raise exception 'FAIL: anon called serve_meal';
exception when insufficient_privilege then null;
end $$;

reset role;
select 'ALL PASSED' as result;

rollback;
