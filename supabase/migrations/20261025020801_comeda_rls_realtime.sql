-- Row level security. Organisers have full access to their events; staff read their events and
-- serve/undo meals. One policy per table and command, all `to authenticated`; anon has no grants.
-- private.is_event_member(event_id[, role]) is the single membership check (security definer, see schema).

alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.meal_slots enable row level security;
alter table public.plans enable row level security;
alter table public.orders enable row level security;
alter table public.attendees enable row level security;
alter table public.meal_logs enable row level security;

/* ---------- events ---------- */

-- created_by keeps the row visible to its creator during insert ... returning, before the
-- membership trigger's row is visible to the policy.
create policy "Members read their events" on public.events
  for select to authenticated
  using (created_by = (select auth.uid()) or private.is_event_member(id));

create policy "Signed-in users create events as themselves" on public.events
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "Organisers update their events" on public.events
  for update to authenticated
  using (private.is_event_member(id, 'organiser'))
  with check (private.is_event_member(id, 'organiser'));

create policy "Organisers delete their events" on public.events
  for delete to authenticated
  using (private.is_event_member(id, 'organiser'));

/* ---------- event_members ---------- */

create policy "Members read the team" on public.event_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_event_member(event_id));

-- Organisers invite by email; the invitee claims the row with accept_invites().
create policy "Organisers invite by email" on public.event_members
  for insert to authenticated
  with check (private.is_event_member(event_id, 'organiser') and user_id is null and invited_email is not null);

-- Only `role` is updatable (column grant).
create policy "Organisers change roles" on public.event_members
  for update to authenticated
  using (private.is_event_member(event_id, 'organiser'))
  with check (private.is_event_member(event_id, 'organiser'));

create policy "Organisers remove members, anyone leaves" on public.event_members
  for delete to authenticated
  using (private.is_event_member(event_id, 'organiser') or user_id = (select auth.uid()));

/* ---------- meal_slots, plans, orders, attendees: members read, organisers write ---------- */

create policy "Members read slots" on public.meal_slots
  for select to authenticated using (private.is_event_member(event_id));
create policy "Organisers add slots" on public.meal_slots
  for insert to authenticated with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers edit slots" on public.meal_slots
  for update to authenticated
  using (private.is_event_member(event_id, 'organiser'))
  with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers delete slots" on public.meal_slots
  for delete to authenticated using (private.is_event_member(event_id, 'organiser'));

create policy "Members read plans" on public.plans
  for select to authenticated using (private.is_event_member(event_id));
create policy "Organisers add plans" on public.plans
  for insert to authenticated with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers edit plans" on public.plans
  for update to authenticated
  using (private.is_event_member(event_id, 'organiser'))
  with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers delete plans" on public.plans
  for delete to authenticated using (private.is_event_member(event_id, 'organiser'));

create policy "Members read orders" on public.orders
  for select to authenticated using (private.is_event_member(event_id));
create policy "Organisers add orders" on public.orders
  for insert to authenticated with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers edit orders" on public.orders
  for update to authenticated
  using (private.is_event_member(event_id, 'organiser'))
  with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers delete orders" on public.orders
  for delete to authenticated using (private.is_event_member(event_id, 'organiser'));

create policy "Members read attendees" on public.attendees
  for select to authenticated using (private.is_event_member(event_id));
create policy "Organisers add attendees" on public.attendees
  for insert to authenticated with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers edit attendees" on public.attendees
  for update to authenticated
  using (private.is_event_member(event_id, 'organiser'))
  with check (private.is_event_member(event_id, 'organiser'));
create policy "Organisers delete attendees" on public.attendees
  for delete to authenticated using (private.is_event_member(event_id, 'organiser'));

/* ---------- meal_logs: any member serves and undoes; nobody deletes ---------- */

-- Inserts also pass the allowance trigger, which stamps served_by and served_at.
create policy "Members read meal logs" on public.meal_logs
  for select to authenticated using (private.is_event_member(event_id));
create policy "Members serve meals" on public.meal_logs
  for insert to authenticated with check (private.is_event_member(event_id));
-- Only `undone_at` is updatable (column grant), once (trigger).
create policy "Members undo meals" on public.meal_logs
  for update to authenticated
  using (private.is_event_member(event_id))
  with check (private.is_event_member(event_id));

/* ---------- Realtime (shared meal check, live order status) ---------- */

-- Realtime applies the select policies above, so subscribers only receive their events' rows.
alter publication supabase_realtime add table public.meal_logs, public.orders;
