-- Comeda's data model: events, who runs them, meal slots, plans, orders, attendees and meal logs.
-- Policies live in the next migration; RPCs (serve, undo, invites, plan save, CSV import) in the one after.
-- Money is numeric in the event's currency; instants are timestamptz; the event's IANA timezone says how to show them.

create schema if not exists private;
comment on schema private is 'Comeda helpers (RLS checks, triggers). Not exposed through the Data API.';

/* ---------- Types ---------- */

create type public.event_role as enum ('organiser', 'staff');
create type public.meal_kind as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type public.dietary as enum ('veg', 'vegan', 'halal', 'gf');
create type public.order_status as enum ('planned', 'ordered', 'out_for_delivery', 'arrived');
create type public.delivery_platform as enum ('deliveroo', 'ubereats', 'justeat', 'direct');
create type public.serve_method as enum ('qr', 'search');
create type public.plan_status as enum ('draft', 'approved');

/* ---------- Tables ---------- */

create table public.events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  venue_name text not null check (char_length(venue_name) between 1 and 200),
  venue_address text not null default '' check (char_length(venue_address) <= 300),
  venue_postcode text not null default '' check (char_length(venue_postcode) <= 20),
  venue_lat double precision not null check (venue_lat between -90 and 90),
  venue_lng double precision not null check (venue_lng between -180 and 180),
  timezone text not null default 'Europe/London',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  headcount integer not null check (headcount between 1 and 10000),
  budget numeric(12, 2) not null default 0 check (budget >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  -- Share of attendees per need, 0–1: {"veg": 0.15, "vegan": 0.08, "halal": 0.04, "gf": 0.03}.
  dietary_mix jsonb not null default '{}' check (jsonb_typeof(dietary_mix) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_dates check (ends_at > starts_at)
);
create index events_created_by_idx on public.events (created_by);

-- Organisers and staff. A pending invite has an email and no user; accept_invites() claims it at sign-in.
create table public.event_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  invited_email text check (
    invited_email = lower(invited_email) and char_length(invited_email) <= 320 and invited_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  role public.event_role not null default 'staff',
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_members_who check (user_id is not null or invited_email is not null),
  constraint event_members_event_user_key unique (event_id, user_id),
  constraint event_members_event_email_key unique (event_id, invited_email)
);
-- The RLS helper looks members up by (event_id, user_id): the unique constraint's index serves it.
create index event_members_user_id_idx on public.event_members (user_id);
create index event_members_invited_email_idx on public.event_members (invited_email) where user_id is null;
create index event_members_invited_by_idx on public.event_members (invited_by);

create table public.meal_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  kind public.meal_kind not null,
  -- When food should be on the table.
  serves_at timestamptz not null,
  headcount integer not null check (headcount between 0 and 10000),
  -- Meal check rules (lib/allowance.ts): servings per attendee, optional seconds, table window.
  allowance integer not null default 1 check (allowance between 0 and 20),
  seconds_after_minutes integer default 30 check (seconds_after_minutes between 0 and 1440),
  seconds integer not null default 1 check (seconds between 0 and 20),
  opens_before_minutes integer not null default 15 check (opens_before_minutes between 0 and 1440),
  closes_after_minutes integer not null default 90 check (closes_after_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for composite foreign keys, so orders and logs can't point at another event's slot.
  constraint meal_slots_event_id_id_key unique (event_id, id)
);
create index meal_slots_event_serves_at_idx on public.meal_slots (event_id, serves_at);

-- The planner's proposals, newest last. `slots` holds PlanSlot[] from lib/types.ts.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  source text not null default 'planner' check (source in ('seed', 'planner', 'gemini')),
  status public.plan_status not null default 'draft',
  slots jsonb not null default '[]' check (jsonb_typeof(slots) = 'array'),
  total numeric(12, 2) not null default 0 check (total >= 0),
  total_source jsonb not null default '{"label": "Comeda planner"}' check (jsonb_typeof(total_source) = 'object'),
  generated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plans_event_created_at_idx on public.plans (event_id, created_at desc);
create index plans_created_by_idx on public.plans (created_by);
create index plans_approved_by_idx on public.plans (approved_by);

-- One bulk order per meal slot. `restaurant` snapshots the Restaurant as it was planned, so a
-- later search can't change what was ordered. `lines` holds OrderLine[] (quantities per need).
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  slot_id uuid not null,
  plan_id uuid references public.plans (id) on delete set null,
  restaurant_id text not null check (char_length(restaurant_id) between 1 and 300),
  restaurant jsonb not null default '{}' check (jsonb_typeof(restaurant) = 'object'),
  platform public.delivery_platform not null default 'direct',
  status public.order_status not null default 'planned',
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  total numeric(12, 2) not null default 0 check (total >= 0),
  total_source jsonb not null default '{"label": "Comeda planner"}' check (jsonb_typeof(total_source) = 'object'),
  total_is_estimate boolean not null default true,
  -- Latest time to place it: slot time − prep − delivery.
  order_by timestamptz,
  ordered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_slot_id_key unique (slot_id),
  constraint orders_slot_fkey foreign key (event_id, slot_id) references public.meal_slots (event_id, id) on delete cascade
);
create index orders_event_slot_idx on public.orders (event_id, slot_id);
create index orders_plan_id_idx on public.orders (plan_id);

create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text check (email = lower(email) and char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  discord_handle text check (char_length(discord_handle) <= 40),
  avatar_url text check (char_length(avatar_url) <= 8192),
  -- What the attendee's QR code encodes (lib/qr.ts). Random unless supplied (the seed keeps its placeholders).
  qr_hash text not null default ('q_' || replace(gen_random_uuid()::text, '-', '')) check (qr_hash ~ '^[a-z0-9_]{6,64}$'),
  dietary public.dietary,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendees_event_qr_hash_key unique (event_id, qr_hash),
  constraint attendees_event_email_key unique (event_id, email),
  constraint attendees_event_id_id_key unique (event_id, id)
);
create index attendees_event_name_idx on public.attendees (event_id, name);

-- One meal collected at the food table. Never deleted: undo stamps undone_at, so counts and audit agree.
create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  slot_id uuid not null,
  attendee_id uuid not null,
  method public.serve_method not null default 'qr',
  served_at timestamptz not null default now(),
  served_by uuid default auth.uid() references auth.users (id) on delete set null,
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint meal_logs_slot_fkey foreign key (event_id, slot_id) references public.meal_slots (event_id, id) on delete cascade,
  constraint meal_logs_attendee_fkey foreign key (event_id, attendee_id) references public.attendees (event_id, id) on delete cascade
);
-- Allowance count (event, slot, attendee, not undone) and the slot foreign key.
create index meal_logs_event_slot_attendee_idx on public.meal_logs (event_id, slot_id, attendee_id) where undone_at is null;
create index meal_logs_event_slot_idx on public.meal_logs (event_id, slot_id);
create index meal_logs_event_attendee_idx on public.meal_logs (event_id, attendee_id);
create index meal_logs_event_served_at_idx on public.meal_logs (event_id, served_at desc);
create index meal_logs_served_by_idx on public.meal_logs (served_by);
create index meal_logs_undone_by_idx on public.meal_logs (undone_by);

/* ---------- Membership helper (used by every policy) ---------- */

-- Security definer so policies on event_members can call it without recursing into their own RLS.
-- Only ever answers for the calling user.
create function private.is_event_member(p_event_id uuid, p_role public.event_role default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_members m
    where m.event_id = p_event_id
      and m.user_id = (select auth.uid())
      and (p_role is null or m.role = p_role)
  );
$$;

/* ---------- Triggers ---------- */

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger events_updated_at before update on public.events for each row execute function private.set_updated_at();
create trigger event_members_updated_at before update on public.event_members for each row execute function private.set_updated_at();
create trigger meal_slots_updated_at before update on public.meal_slots for each row execute function private.set_updated_at();
create trigger plans_updated_at before update on public.plans for each row execute function private.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function private.set_updated_at();
create trigger attendees_updated_at before update on public.attendees for each row execute function private.set_updated_at();

-- An IANA zone Postgres knows, so the app can format times with it.
create function private.check_event_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger events_timezone before insert or update of timezone on public.events
  for each row execute function private.check_event_timezone();

-- Whoever creates an event organises it.
create function private.add_event_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.event_members (event_id, user_id, role, invited_by, accepted_at)
    values (new.id, new.created_by, 'organiser', new.created_by, now())
    on conflict (event_id, user_id) do update set role = 'organiser';
  end if;
  return new;
end;
$$;

create trigger events_add_creator after insert on public.events
  for each row execute function private.add_event_creator();

-- An event always keeps at least one signed-up organiser (unless the event itself is going).
create function private.keep_an_organiser()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'organiser' or old.user_id is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'organiser' and new.user_id is not distinct from old.user_id then
    return new;
  end if;
  -- Cascades: the event is being deleted, or the user's account is.
  if not exists (select 1 from public.events e where e.id = old.event_id)
    or not exists (select 1 from auth.users u where u.id = old.user_id) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.event_members m
    where m.event_id = old.event_id and m.role = 'organiser' and m.user_id is not null and m.id <> old.id
  ) then
    raise exception 'An event needs at least one organiser' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger event_members_keep_organiser before update or delete on public.event_members
  for each row execute function private.keep_an_organiser();

-- ordered_at follows the status: set when an order leaves "planned", cleared if it goes back.
create function private.stamp_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'planned' then
    new.ordered_at := null;
  elsif old.status = 'planned' or old.ordered_at is null then
    new.ordered_at := coalesce(new.ordered_at, now());
  end if;
  return new;
end;
$$;

create trigger orders_status before update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function private.stamp_order_status();

/* ---------- Meal allowance (mirrors lib/allowance.ts) ---------- */

-- Can this attendee collect another serving from this slot at p_at? Takes a transaction-scoped lock
-- on (slot, attendee) first, so two devices serving the same person queue up instead of both passing.
-- Security invoker: it reads only what the caller's RLS lets them read.
create function private.check_allowance(p_slot_id uuid, p_attendee_id uuid, p_at timestamptz)
returns table (ok boolean, code text, eaten integer, max_now integer, max_total integer, seconds_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  s public.meal_slots;
  v_eaten integer;
  v_start timestamptz;
  v_seconds_at timestamptz;
  v_seconds_open boolean;
  v_max integer;
  v_limit integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_slot_id::text || ':' || p_attendee_id::text, 0));

  select * into s from public.meal_slots where id = p_slot_id;
  if not found then
    raise exception 'Meal slot not found' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_eaten
  from public.meal_logs l
  where l.event_id = s.event_id and l.slot_id = p_slot_id and l.attendee_id = p_attendee_id and l.undone_at is null;

  v_start := s.serves_at;
  v_seconds_at := case
    when s.seconds_after_minutes is null or s.seconds <= 0 then null
    else v_start + make_interval(mins => s.seconds_after_minutes)
  end;
  v_seconds_open := v_seconds_at is not null and p_at >= v_seconds_at;
  v_max := s.allowance + case when v_seconds_at is null then 0 else s.seconds end;
  v_limit := case when v_seconds_open then v_max else s.allowance end;

  eaten := v_eaten;
  max_now := v_limit;
  max_total := v_max;
  seconds_at := v_seconds_at;
  ok := false;

  if p_at < v_start - make_interval(mins => s.opens_before_minutes) then
    code := 'not-open';
  elsif p_at >= v_start + make_interval(mins => s.closes_after_minutes) then
    code := 'closed';
  elsif v_eaten < v_limit then
    ok := true;
    code := null;
  elsif v_seconds_at is not null and not v_seconds_open then
    code := 'seconds-later';
  else
    code := 'used';
  end if;
  return next;
end;
$$;

-- Every insert goes through the allowance, whether it came from serve_meal() or straight from the API.
-- Signed-in callers can't backdate a serve or log it under someone else.
create function private.guard_meal_log_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v record;
begin
  if (select auth.uid()) is not null then
    new.served_at := now();
    new.served_by := (select auth.uid());
  end if;
  new.undone_at := null;
  new.undone_by := null;
  select * into v from private.check_allowance(new.slot_id, new.attendee_id, new.served_at);
  if not v.ok then
    raise exception 'meal_not_allowed:%', v.code using errcode = 'P0001', detail = v.code;
  end if;
  return new;
end;
$$;

create trigger meal_logs_guard_insert before insert on public.meal_logs
  for each row execute function private.guard_meal_log_insert();

-- The only update a log takes is its undo, once.
create function private.guard_meal_log_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.undone_at is not null then
    raise exception 'This meal was already undone' using errcode = 'P0001';
  end if;
  if new.undone_at is null
    or (new.event_id, new.slot_id, new.attendee_id, new.method, new.served_at, new.served_by)
       is distinct from (old.event_id, old.slot_id, old.attendee_id, old.method, old.served_at, old.served_by) then
    raise exception 'A meal log can only be undone' using errcode = 'P0001';
  end if;
  if (select auth.uid()) is not null then
    new.undone_at := now();
    new.undone_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger meal_logs_guard_update before update on public.meal_logs
  for each row execute function private.guard_meal_log_update();

/* ---------- Privileges ---------- */

-- Nothing is reachable without signing in. Signed-in users get exactly the verbs below; RLS picks the rows.
revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on public.events, public.meal_slots, public.plans, public.orders, public.attendees to authenticated;
grant select, insert, delete on public.event_members to authenticated;
grant update (role) on public.event_members to authenticated;
grant select, insert on public.meal_logs to authenticated;
grant update (undone_at) on public.meal_logs to authenticated;

grant all on all tables in schema public to service_role;

-- Policies call the helpers as the signed-in user.
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on function private.is_event_member(uuid, public.event_role) to authenticated, service_role;
grant execute on function private.check_allowance(uuid, uuid, timestamptz) to authenticated, service_role;
