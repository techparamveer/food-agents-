-- RPCs the app calls through supabase.rpc(). All are security invoker, so RLS still decides what each
-- caller can touch; the one privileged step (claiming an invite) is a definer function in `private`.

/* ---------- Meal check ---------- */

-- Serve one meal, or say why not. Atomic across devices: check_allowance locks (slot, attendee), and
-- the insert trigger re-checks under the same lock. Returns
--   { ok: true,  log: meal_logs row, eaten, maxNow, maxTotal, secondsAt }
--   { ok: false, code: 'not-open' | 'closed' | 'used' | 'seconds-later', eaten, maxNow, maxTotal, secondsAt }
create function public.serve_meal(p_slot_id uuid, p_attendee_id uuid, p_method public.serve_method default 'qr')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_event uuid;
  v record;
  v_log public.meal_logs;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to serve meals' using errcode = '42501';
  end if;
  select event_id into v_event from public.meal_slots where id = p_slot_id;
  if v_event is null or not private.is_event_member(v_event) then
    raise exception 'Meal slot not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.attendees a where a.id = p_attendee_id and a.event_id = v_event) then
    raise exception 'Attendee not found' using errcode = 'P0002';
  end if;

  select * into v from private.check_allowance(p_slot_id, p_attendee_id, now());
  if not v.ok then
    return jsonb_build_object('ok', false, 'code', v.code, 'eaten', v.eaten, 'maxNow', v.max_now, 'maxTotal', v.max_total, 'secondsAt', v.seconds_at);
  end if;

  insert into public.meal_logs (event_id, slot_id, attendee_id, method)
  values (v_event, p_slot_id, p_attendee_id, p_method)
  returning * into v_log;

  return jsonb_build_object('ok', true, 'log', to_jsonb(v_log), 'eaten', v.eaten + 1, 'maxNow', v.max_now, 'maxTotal', v.max_total, 'secondsAt', v.seconds_at);
end;
$$;

-- Undo a serve. Errors if the log isn't visible to the caller or was already undone.
create function public.undo_meal(p_log_id uuid)
returns public.meal_logs
language plpgsql
set search_path = ''
as $$
declare
  v_log public.meal_logs;
begin
  update public.meal_logs set undone_at = now()
  where id = p_log_id and undone_at is null
  returning * into v_log;
  if v_log.id is null then
    raise exception 'Meal log not found or already undone' using errcode = 'P0002';
  end if;
  return v_log;
end;
$$;

/* ---------- Invites ---------- */

-- Claims every pending invite for the caller's confirmed email. Definer: invitees can't see pending
-- rows (they have no user_id yet). Never touches anyone else's rows.
create function private.accept_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_count integer;
begin
  if v_uid is null then
    return 0;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;
  -- Already a member of that event? Drop the duplicate invite instead.
  delete from public.event_members m
  where m.user_id is null and m.invited_email = v_email
    and exists (select 1 from public.event_members x where x.event_id = m.event_id and x.user_id = v_uid);
  update public.event_members m
  set user_id = v_uid, accepted_at = now()
  where m.user_id is null and m.invited_email = v_email;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.accept_invites()
returns integer
language sql
set search_path = ''
as $$
  select private.accept_invites();
$$;

/* ---------- Attendee import ---------- */

-- Bulk insert from a parsed CSV. Each row is { name, email?, discord_handle?, dietary?, qr_hash?, avatar_url? }.
-- Every row gets a result: { row_index, attendee_id } on success or { row_index, error } on failure,
-- and one bad row never blocks the rest. Organisers only.
create function public.import_attendees(p_event_id uuid, p_rows jsonb)
returns table (row_index integer, attendee_id uuid, error text)
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb;
  v_i bigint;
  v_constraint text;
begin
  if not private.is_event_member(p_event_id, 'organiser') then
    raise exception 'Only organisers can import attendees' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Send an array of at most 5,000 rows' using errcode = '22023';
  end if;

  for v_row, v_i in select r.value, r.ordinality - 1 from jsonb_array_elements(p_rows) with ordinality as r loop
    row_index := v_i;
    begin
      insert into public.attendees (event_id, name, email, discord_handle, avatar_url, dietary, qr_hash)
      values (
        p_event_id,
        btrim(v_row ->> 'name'),
        nullif(lower(btrim(v_row ->> 'email')), ''),
        nullif(btrim(v_row ->> 'discord_handle'), ''),
        nullif(btrim(v_row ->> 'avatar_url'), ''),
        nullif(btrim(v_row ->> 'dietary'), '')::public.dietary,
        coalesce(nullif(lower(btrim(v_row ->> 'qr_hash')), ''), 'q_' || replace(gen_random_uuid()::text, '-', ''))
      )
      returning id into attendee_id;
      error := null;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        attendee_id := null;
        error := case v_constraint
          when 'attendees_event_email_key' then 'Duplicate email'
          when 'attendees_event_qr_hash_key' then 'Duplicate QR hash'
          else 'Duplicate attendee'
        end;
      when not_null_violation then
        attendee_id := null;
        error := 'Name is required';
      when check_violation then
        get stacked diagnostics v_constraint = constraint_name;
        attendee_id := null;
        error := case
          when v_constraint like '%name%' then 'Name must be 1–120 characters'
          when v_constraint like '%email%' then 'Invalid email'
          when v_constraint like '%discord%' then 'Discord handle is too long'
          when v_constraint like '%qr_hash%' then 'Invalid QR hash'
          else 'Invalid row'
        end;
      when invalid_text_representation then
        attendee_id := null;
        error := 'Unknown dietary need (use veg, vegan, halal or gf)';
    end;
    return next;
  end loop;
end;
$$;

/* ---------- Plans ---------- */

-- Saves what lib/plan-sync.ts applyPlan() produced, in one transaction:
--   p_plan = {
--     event?:  { headcount?, budget?, startsAt?, endsAt?, dietaryMix? },
--     slots:   [{ id, label, kind, servesAt, headcount, allowance? }]      -- id: a slot uuid, or any client id for a new slot
--     orders:  [{ slotId, restaurantId, restaurant, platform, lines, orderBy, total: { value, source, isEstimate } }],
--     plan:    { source, generatedAt, slots: PlanSlot[], total: { value, source } },
--     approve?: boolean
--   }
-- Slots are matched by id, new ones inserted. Slots the plan dropped are deleted unless they have a
-- placed order or meal logs. Placed orders (status <> 'planned') are never overwritten.
-- Returns { planId, slotIds: { <client slot id>: <uuid> } }.
create function public.save_plan(p_event_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_event jsonb := p_plan -> 'event';
  v_slot jsonb;
  v_order jsonb;
  v_id uuid;
  v_map jsonb := '{}';
  v_plan_id uuid;
  v_approve boolean := coalesce((p_plan ->> 'approve')::boolean, false);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if not private.is_event_member(p_event_id, 'organiser') then
    raise exception 'Only organisers can save plans' using errcode = '42501';
  end if;
  if jsonb_typeof(p_plan -> 'slots') <> 'array' or jsonb_typeof(p_plan -> 'orders') <> 'array' or jsonb_typeof(p_plan -> 'plan') <> 'object' then
    raise exception 'Plan needs slots, orders and plan' using errcode = '22023';
  end if;

  if jsonb_typeof(v_event) = 'object' then
    update public.events e set
      headcount = coalesce((v_event ->> 'headcount')::integer, e.headcount),
      budget = coalesce((v_event ->> 'budget')::numeric, e.budget),
      starts_at = coalesce((v_event ->> 'startsAt')::timestamptz, e.starts_at),
      ends_at = coalesce((v_event ->> 'endsAt')::timestamptz, e.ends_at),
      dietary_mix = coalesce(v_event -> 'dietaryMix', e.dietary_mix)
    where e.id = p_event_id;
  end if;

  for v_slot in select value from jsonb_array_elements(p_plan -> 'slots') loop
    v_id := null;
    if v_slot ->> 'id' ~ v_uuid then
      select s.id into v_id from public.meal_slots s where s.id = (v_slot ->> 'id')::uuid and s.event_id = p_event_id;
    end if;
    if v_id is not null then
      update public.meal_slots s set
        label = v_slot ->> 'label',
        kind = (v_slot ->> 'kind')::public.meal_kind,
        serves_at = (v_slot ->> 'servesAt')::timestamptz,
        headcount = (v_slot ->> 'headcount')::integer,
        allowance = coalesce((v_slot ->> 'allowance')::integer, s.allowance)
      where s.id = v_id;
    else
      insert into public.meal_slots (event_id, label, kind, serves_at, headcount, allowance, seconds_after_minutes, closes_after_minutes, opens_before_minutes)
      values (
        p_event_id,
        v_slot ->> 'label',
        (v_slot ->> 'kind')::public.meal_kind,
        (v_slot ->> 'servesAt')::timestamptz,
        (v_slot ->> 'headcount')::integer,
        coalesce((v_slot ->> 'allowance')::integer, 1),
        case when v_slot ->> 'kind' = 'snack' then 20 else 30 end,
        case v_slot ->> 'kind' when 'dinner' then 120 when 'snack' then 60 else 90 end,
        case when v_slot ->> 'kind' = 'snack' then 10 else 15 end
      )
      returning id into v_id;
    end if;
    v_map := v_map || jsonb_build_object(v_slot ->> 'id', v_id);
  end loop;

  delete from public.meal_slots s
  where s.event_id = p_event_id
    and not exists (select 1 from jsonb_each_text(v_map) m where m.value = s.id::text)
    and not exists (select 1 from public.orders o where o.slot_id = s.id and o.status <> 'planned')
    and not exists (select 1 from public.meal_logs l where l.event_id = p_event_id and l.slot_id = s.id);

  insert into public.plans (event_id, source, status, slots, total, total_source, generated_at, approved_at, approved_by)
  values (
    p_event_id,
    coalesce(p_plan -> 'plan' ->> 'source', 'planner'),
    case when v_approve then 'approved'::public.plan_status else 'draft'::public.plan_status end,
    coalesce((
      select jsonb_agg(ps || jsonb_build_object('slotId', coalesce(v_map ->> (ps ->> 'slotId'), ps ->> 'slotId')))
      from jsonb_array_elements(p_plan -> 'plan' -> 'slots') ps
    ), '[]'),
    coalesce((p_plan -> 'plan' -> 'total' ->> 'value')::numeric, 0),
    coalesce(p_plan -> 'plan' -> 'total' -> 'source', '{"label": "Comeda planner"}'),
    coalesce((p_plan -> 'plan' ->> 'generatedAt')::timestamptz, now()),
    case when v_approve then now() end,
    case when v_approve then (select auth.uid()) end
  )
  returning id into v_plan_id;

  for v_order in select value from jsonb_array_elements(p_plan -> 'orders') loop
    v_id := (v_map ->> (v_order ->> 'slotId'))::uuid;
    continue when v_id is null;
    insert into public.orders (event_id, slot_id, plan_id, restaurant_id, restaurant, platform, lines, total, total_source, total_is_estimate, order_by)
    values (
      p_event_id,
      v_id,
      v_plan_id,
      v_order ->> 'restaurantId',
      coalesce(v_order -> 'restaurant', '{}'),
      coalesce((v_order ->> 'platform')::public.delivery_platform, 'direct'),
      coalesce(v_order -> 'lines', '[]'),
      coalesce((v_order -> 'total' ->> 'value')::numeric, 0),
      coalesce(v_order -> 'total' -> 'source', '{"label": "Comeda planner"}'),
      coalesce((v_order -> 'total' ->> 'isEstimate')::boolean, true),
      (v_order ->> 'orderBy')::timestamptz
    )
    on conflict (slot_id) do update set
      plan_id = excluded.plan_id,
      restaurant_id = excluded.restaurant_id,
      restaurant = excluded.restaurant,
      platform = excluded.platform,
      lines = excluded.lines,
      total = excluded.total,
      total_source = excluded.total_source,
      total_is_estimate = excluded.total_is_estimate,
      order_by = excluded.order_by
    where public.orders.status = 'planned';
  end loop;

  return jsonb_build_object('planId', v_plan_id, 'slotIds', v_map);
end;
$$;

/* ---------- Privileges ---------- */

revoke all on function public.serve_meal(uuid, uuid, public.serve_method) from public, anon;
revoke all on function public.undo_meal(uuid) from public, anon;
revoke all on function public.accept_invites() from public, anon;
revoke all on function public.import_attendees(uuid, jsonb) from public, anon;
revoke all on function public.save_plan(uuid, jsonb) from public, anon;
grant execute on function public.serve_meal(uuid, uuid, public.serve_method) to authenticated, service_role;
grant execute on function public.undo_meal(uuid) to authenticated, service_role;
grant execute on function public.accept_invites() to authenticated, service_role;
grant execute on function public.import_attendees(uuid, jsonb) to authenticated, service_role;
grant execute on function public.save_plan(uuid, jsonb) to authenticated, service_role;

revoke all on function private.accept_invites() from public, anon;
grant execute on function private.accept_invites() to authenticated, service_role;
