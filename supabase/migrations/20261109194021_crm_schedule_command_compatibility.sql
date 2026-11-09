-- The original controls offer legacy week/month cadence. Preserve their
-- optional explicit next date and the established monthly clamp on cutover.
create function public.crm_legacy_schedule(p_anchor date,p_unit text,p_count integer,p_first date default null)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('version',1,'base',jsonb_build_object(
    'frequency','legacy','anchor_on',p_anchor,'unit',p_unit,'count',p_count))
    || case when p_first is null then '{}'::jsonb else jsonb_build_object('temporary',jsonb_build_array(
      jsonb_build_object('start',p_first,'end',p_first + 1,
        'rule',jsonb_build_object('frequency','weekly','anchor_on',p_first)))) end;
$$;

create function public.crm_write_schedule_revision(p_agreement_id uuid,p_from date,p_definition jsonb,
  p_items jsonb,p_time text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from public.recurring_agreements where id = p_agreement_id for update;
  update public.agreement_schedule_revisions set ends_before = greatest(starts_on,p_from)
    where agreement_id = p_agreement_id and (ends_before is null or ends_before > p_from);
  insert into public.agreement_schedule_revisions(agreement_id,starts_on,definition,items_template,visit_time)
    values(p_agreement_id,p_from,p_definition,p_items,p_time) returning id into v_id;
  update public.recurring_agreements set generated_through =
    least(generated_through,greatest(generation_starts_on,p_from) - 1)
    where id = p_agreement_id and generation_starts_on is not null;
  return v_id;
end $$;

create function public.crm_activate_schedule(p_agreement_id uuid,p_source_id uuid,p_legacy boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; b public.bookings; v_start date; v_first date;
  v_definition jsonb; v_review_reason text;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into a from public.recurring_agreements where id = p_agreement_id for update;
  if not found or a.status = 'ended' or a.generation_starts_on is not null
    or a.schedule_review_reason is not null then return; end if;
  select * into b from public.bookings where id = p_source_id;
  if not found or b.status not in ('confirmed','completed','canceled','skipped')
    or coalesce(b.confirmed_date,(b.completed_at at time zone 'America/Chicago')::date) is null
    or b.agreement_id is distinct from a.id or b.customer_id is distinct from a.customer_id
    or b.property_id is distinct from a.property_id or jsonb_array_length(a.items_template) = 0 then
    return;
  end if;
  v_first := coalesce(b.confirmed_date,(b.completed_at at time zone 'America/Chicago')::date);
  -- Legacy next_on is a continuation. For a new plan it must follow the first actual visit.
  v_start := greatest(v_today,a.anchor_on,a.next_on,case when not p_legacy then v_first + 1 end);
  v_definition := public.crm_legacy_schedule(a.anchor_on,a.interval_unit,a.interval_count,
    case when a.next_on >= v_start then a.next_on end);
  if not p_legacy and a.next_on <= v_first then
    v_review_reason := 'The planned next visit is on or before the first confirmed visit. Choose a new next date.';
  elsif p_legacy and exists(
    select 1 from public.bookings v where v.agreement_id = a.id
      and v.status in ('confirmed','completed') and v.confirmed_date <> v.occurrence_on
      and v.confirmed_date >= v_start and (a.end_on is null or v.confirmed_date <= a.end_on)
      and exists(select 1 from public.crm_schedule_dates(v_definition,v.confirmed_date,v.confirmed_date))
      and not exists(select 1 from public.bookings other
        where other.agreement_id = a.id and other.occurrence_on = v.confirmed_date)
  ) then
    v_review_reason := 'A saved visit moved onto a regular visit date. Review the saved visits and choose a new next date.';
  end if;
  if v_review_reason is not null then
    update public.recurring_agreements set schedule_source_booking_id = b.id,
      schedule_review_reason = v_review_reason where id = a.id;
    return;
  end if;
  update public.recurring_agreements set schedule_source_booking_id = b.id,
    generation_starts_on = v_start,generated_through = v_start - 1 where id = a.id;
  perform public.crm_write_schedule_revision(a.id,v_start,v_definition,a.items_template,b.confirmed_time);
  perform public.crm_reconcile_schedule(a.id,v_today);
end $$;

create or replace function public.crm_generate_next_job(p_booking_id uuid,p_after date,p_force_on date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare b public.bookings; v_next uuid; v_revision uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.agreement_id is null then return null; end if;
  perform public.crm_activate_schedule(b.agreement_id,b.id);
  perform public.crm_reconcile_schedule(b.agreement_id,v_today);
  if p_force_on >= v_today then
    select revision_id into v_revision from public.crm_schedule_slots(b.agreement_id,p_force_on,p_force_on);
    if v_revision is not null and exists(select 1 from public.recurring_agreements
      where id = b.agreement_id and status = 'active') then
      perform public.crm_materialize_schedule_visit(b.agreement_id,v_revision,p_force_on);
    end if;
  end if;
  -- Completion, skip and cancel report an already scheduled visit.
  select v.id into v_next from public.bookings v
    join public.recurring_agreements a on a.id = v.agreement_id
    where a.id = b.agreement_id and a.status = 'active' and v.id <> b.id
      and v.status in ('pending','confirmed') and v.occurrence_on > p_after
      and v.occurrence_on >= coalesce(p_force_on,v_today)
    order by coalesce(v.confirmed_date,v.preferred_date,v.occurrence_on),v.id limit 1;
  return v_next;
end $$;

create or replace function public.crm_shift_agreement(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_date date,p_time text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; b public.bookings; r public.agreement_schedule_revisions;
  v_agreement_id uuid; v_result jsonb; v_ids uuid[]; v_slots date[]; v_target date; v_rev uuid; v_from date;
  v_row record; v_delta integer; v_request jsonb := jsonb_build_object('date',p_date,'time',p_time);
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if p_date is null then raise exception 'Visit date required' using errcode = '22023'; end if;
  v_result := public.crm_operation_reply(p_operation_id,'shift_agreement',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select agreement_id into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is null then
    raise exception 'Only a plan visit can move the plan' using errcode = '23514';
  end if;
  select * into a from public.recurring_agreements where id = v_agreement_id for update;
  -- Lock the affected visits before checking individual edits and payments.
  perform 1 from public.bookings where agreement_id = a.id order by id for update;
  select * into b from public.bookings where id = p_booking_id;
  if b.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if a.status <> 'active' or b.status not in ('pending','confirmed') then
    raise exception 'Only an unfinished visit on an active plan can move the plan' using errcode = '23514';
  end if;
  if a.schedule_review_reason is not null then
    raise exception 'Review this plan and choose a new next date first' using errcode = '23514';
  end if;
  if exists(select 1 from public.job_payments where booking_id = b.id)
    or b.amount_charged is not null or b.payment_link is not null then
    raise exception 'Review this visit’s payment before moving the plan' using errcode = '23514';
  end if;
  v_delta := p_date - b.occurrence_on;
  v_from := least(p_date,b.occurrence_on);
  -- Count the old rule’s cadence slots, including slots without a saved booking.
  -- An explicit next date and the normal monthly date can fall in the same month.
  with future_slots as (
    select s.cadence_on,
      row_number() over (order by s.cadence_on)::integer as ordinal
    from generate_series(0,(
      select (max(v.occurrence_on) - b.occurrence_on - 1) / 366
      from public.bookings v where v.agreement_id = a.id and v.occurrence_on > b.occurrence_on
        and v.schedule_state is distinct from 'superseded'
    )) as chunk
    cross join lateral public.crm_schedule_slots(a.id,
      b.occurrence_on + 1 + 366 * chunk,b.occurrence_on + 366 + 366 * chunk) s
  ), moving as (
    select b.id,b.occurrence_on,0 as ordinal
    union all
    select v.id,v.occurrence_on,s.ordinal
    from future_slots s join public.bookings v
      on v.agreement_id = a.id and v.occurrence_on = s.cadence_on
    where v.occurrence_on >= v_today and v.schedule_state is distinct from 'superseded'
      and v.status <> 'declined'
  )
  select array_agg(m.id order by m.occurrence_on),array_agg(
    case when a.interval_unit = 'week' then p_date + 7 * a.interval_count * m.ordinal
      else (p_date + make_interval(months => a.interval_count * m.ordinal))::date end
    order by m.occurrence_on) into v_ids,v_slots from moving m;
  if exists(select 1 from public.bookings v where v.id = any(v_ids)
    and (v.status = 'completed' or v.amount_charged is not null or v.payment_link is not null
      or exists(select 1 from public.job_payments p where p.booking_id = v.id))) then
    raise exception 'Review completed or paid visits before moving the plan' using errcode = '23514';
  end if;
  if a.end_on is not null and p_date > a.end_on then
    raise exception 'New date is after the plan’s end date' using errcode = '22023';
  end if;
  if exists(select 1 from unnest(v_slots) d where d > a.end_on) then
    raise exception 'Moving these visits would exceed the plan’s end date' using errcode = '22023';
  end if;
  if exists(select 1 from public.bookings v where v.agreement_id = a.id and not (v.id = any(v_ids))
    and v.occurrence_on = any(v_slots)) or exists(
      select 1 from unnest(v_ids,v_slots) m(id,target)
      join public.bookings moving on moving.id = m.id
      join public.bookings kept on kept.agreement_id = a.id and kept.id <> m.id
        and kept.confirmed_date = m.target and kept.status in ('confirmed','completed')
      where (moving.id = b.id or moving.schedule_state = 'generated')
        and (not (kept.id = any(v_ids))
          or (kept.id <> b.id and kept.schedule_state is distinct from 'generated'))
    ) then
    raise exception 'The plan already has a protected visit on that date' using errcode = '23514';
  end if;
  select * into r from public.agreement_schedule_revisions
    where agreement_id = a.id and ends_before is null;
  -- A start awaiting confirmation can be moved before any generated slots exist.
  if a.generation_starts_on is null then
    update public.recurring_agreements set schedule_source_booking_id = b.id,
      generation_starts_on = greatest(v_today,v_from),generated_through = greatest(v_today,v_from) - 1
      where id = a.id;
  else
    update public.recurring_agreements set generation_starts_on = least(generation_starts_on,greatest(v_today,v_from))
      where id = a.id;
  end if;
  v_rev := public.crm_write_schedule_revision(a.id,v_from,
    public.crm_legacy_schedule(p_date,a.interval_unit,a.interval_count),a.items_template,
    case when r.id is null then nullif(p_time,'') else r.visit_time end);
  for v_row in select m.id,m.target,(v.id = b.id or v.schedule_state = 'generated') as move_actual
    from unnest(v_ids,v_slots) m(id,target)
    join public.bookings v on v.id = m.id
    order by m.target > v.occurrence_on,
      case when m.target > v.occurrence_on then date '2000-01-01' - v.occurrence_on
        else v.occurrence_on - date '2000-01-01' end
  loop
    v_target := v_row.target;
    update public.bookings set original_occurrence_on = coalesce(original_occurrence_on,occurrence_on),
      occurrence_on = v_target,
      confirmed_date = case when v_row.move_actual then v_target else confirmed_date end,
      preferred_date = case when v_row.move_actual then v_target else preferred_date end,
      status = case when id = b.id then 'confirmed' else status end,schedule_revision_id = v_rev,
      schedule_state = coalesce(schedule_state,'exception'),
      confirmed_time = case when id = b.id then nullif(p_time,'') else confirmed_time end,
      lifecycle_note = case when v_row.move_actual then 'Plan moved' else lifecycle_note end
      where id = v_row.id;
  end loop;
  update public.recurring_agreements set anchor_on = p_date,next_on = p_date where id = a.id;
  perform public.crm_reconcile_schedule(a.id,v_today);
  v_result := jsonb_build_object('booking_id',b.id,'agreement_id',a.id,'shift_days',v_delta);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'shift_agreement',p_booking_id,v_request,v_result);
  return v_result || '{"duplicate":false}'::jsonb;
end $$;

revoke all on function public.crm_legacy_schedule(date,text,integer,date),
  public.crm_write_schedule_revision(uuid,date,jsonb,jsonb,text),public.crm_activate_schedule(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.crm_legacy_schedule(date,text,integer,date),
  public.crm_write_schedule_revision(uuid,date,jsonb,jsonb,text),public.crm_activate_schedule(uuid,uuid,boolean)
  to service_role;

create or replace function public.crm_start_agreement(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_config jsonb) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_id uuid; v_result jsonb; v_anchor date;
  v_occurrence date; v_next date; v_total numeric; v_next_booking uuid;
begin
  v_result := public.crm_operation_reply(p_operation_id,'start_agreement',p_booking_id,p_config);
  if v_result is not null then return v_result; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.agreement_id is not null or v_booking.customer_id is null
    or v_booking.property_id is null or v_booking.status not in ('pending','confirmed','completed') then
    raise exception 'Link a current job to a customer and property before starting recurrence'
      using errcode = '23514';
  end if;
  v_occurrence := coalesce(v_booking.confirmed_date,v_booking.preferred_date,(v_booking.completed_at at time zone 'America/Chicago')::date);
  v_anchor := (p_config->>'anchor_on')::date;
  v_next := (p_config->>'next_on')::date;
  if v_occurrence is null or v_anchor is null or v_occurrence <> v_anchor
    or v_next is null or v_next <= v_anchor then
    raise exception 'Choose the current visit as anchor and a later next date' using errcode = '22023';
  end if;
  v_total := public.crm_validate_items(p_config->'items_template');
  insert into public.recurring_agreements(customer_id,property_id,anchor_on,next_on,end_on,
    interval_unit,interval_count,price_per_visit,items_template)
  values(v_booking.customer_id,v_booking.property_id,v_anchor,v_next,
    nullif(p_config->>'end_on','')::date,p_config->>'interval_unit',
    (p_config->>'interval_count')::integer,v_total,p_config->'items_template')
  returning id into v_id;
  update public.bookings set agreement_id = v_id,occurrence_on = v_occurrence,original_occurrence_on = v_occurrence,
    one_time = false where id = p_booking_id;
  if v_booking.status in ('confirmed','completed') then
    v_next_booking := public.crm_generate_next_job(p_booking_id,v_occurrence,v_next);
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'agreement_id',v_id,
    'next_booking_id',v_next_booking);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'start_agreement',p_booking_id,p_config,v_result);
  return v_result;
end $$;

create or replace function public.crm_job_command(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql
  security invoker set search_path = '' as $$
declare v_booking public.bookings; v_result jsonb; v_next uuid; v_date date;
  v_agreement_id uuid;
begin
  if p_action not in ('confirm','reschedule','skip','cancel','mark_one_time') then
    raise exception 'Unsupported job action' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'job_' || p_action,p_booking_id,p_payload);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select agreement_id into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is not null then
    perform 1 from public.recurring_agreements where id = v_agreement_id for update;
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.status in ('completed','declined','canceled','skipped') then
    raise exception 'Finished job cannot be changed' using errcode = '23514';
  end if;
  if p_action in ('confirm','reschedule') then
    v_date := nullif(p_payload->>'date','')::date;
    if v_date is null then raise exception 'Visit date required' using errcode = '22023'; end if;
    update public.bookings set status = 'confirmed',confirmed_date = v_date,
      confirmed_time = nullif(p_payload->>'time',''),preferred_date = v_date
      where id = p_booking_id;
    if v_booking.agreement_id is not null then
      if v_booking.status = 'pending' then
        perform public.crm_activate_schedule(v_booking.agreement_id,p_booking_id);
      else
        perform public.crm_reconcile_schedule(v_booking.agreement_id);
      end if;
    end if;
  elsif p_action = 'mark_one_time' then
    if v_booking.agreement_id is not null then
      raise exception 'Agreement visits cannot be marked one-time' using errcode = '23514';
    end if;
    update public.bookings set one_time = true,lifecycle_note = 'Explicitly marked one-time'
      where id = p_booking_id;
  elsif p_action = 'skip' then
    if v_booking.agreement_id is null then
      raise exception 'Only agreement visits can be skipped' using errcode = '23514';
    end if;
    update public.bookings set status = 'skipped',lifecycle_note = 'Skipped this visit'
      where id = p_booking_id;
    v_next := public.crm_generate_next_job(p_booking_id,v_booking.occurrence_on);
  else
    update public.bookings set status = 'canceled',lifecycle_note = 'Canceled this visit'
      where id = p_booking_id;
    if v_booking.agreement_id is not null then
      v_next := public.crm_generate_next_job(p_booking_id,v_booking.occurrence_on);
    end if;
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next,
    'status',case when p_action in ('confirm','reschedule') then 'confirmed' else
      case when p_action = 'skip' then 'skipped'
        when p_action = 'mark_one_time' then v_booking.status else 'canceled' end end);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'job_' || p_action,p_booking_id,p_payload,v_result);
  return v_result;
end $$;

create or replace function public.crm_attach_to_agreement(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_agreement_id uuid) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_agreement public.recurring_agreements; v_result jsonb;
  v_request jsonb := jsonb_build_object('agreement_id',p_agreement_id); v_on date;
begin
  v_result := public.crm_operation_reply(p_operation_id,'attach_agreement',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select * into v_agreement from public.recurring_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Mowing plan not found' using errcode = 'P0002'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.status not in ('pending','confirmed') then
    raise exception 'Only an upcoming visit can join a mowing plan' using errcode = '23514';
  end if;
  if v_booking.agreement_id is not null then
    raise exception 'This visit is already in a mowing plan' using errcode = '23514';
  end if;
  if v_agreement.status <> 'active' or v_booking.customer_id is distinct from v_agreement.customer_id
    or v_booking.property_id is distinct from v_agreement.property_id then
    raise exception 'The plan must be active and at this visit''s customer and property' using errcode = '23514';
  end if;
  v_on := coalesce(v_booking.confirmed_date,v_booking.preferred_date);
  if v_on is null then raise exception 'Set the visit date first' using errcode = '22023'; end if;
  if exists(select 1 from public.bookings where agreement_id = p_agreement_id and occurrence_on = v_on) then
    raise exception 'The plan already has a visit on that date' using errcode = '23514';
  end if;
  update public.bookings set agreement_id = p_agreement_id,occurrence_on = v_on,original_occurrence_on = v_on,
    schedule_state = 'exception',one_time = false,
    lifecycle_note = 'Added to mowing plan' where id = p_booking_id;
  if v_agreement.end_on is not null and v_on > v_agreement.end_on then
    raise exception 'Visit is after the plan’s end date' using errcode = '22023';
  end if;
  if v_agreement.generation_starts_on is null and v_agreement.schedule_review_reason is null
    and not exists(select 1 from public.bookings where agreement_id = p_agreement_id and status in ('pending','confirmed') and occurrence_on > v_on) then
    update public.recurring_agreements set anchor_on = v_on,next_on = public.crm_next_occurrence(
      v_on,v_on,interval_unit,interval_count) where id = p_agreement_id;
  end if;
  if v_booking.status = 'confirmed' then
    perform public.crm_activate_schedule(p_agreement_id,p_booking_id);
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'agreement_id',p_agreement_id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'attach_agreement',p_booking_id,v_request,v_result);
  return v_result || '{"duplicate":false}'::jsonb;
end $$;

-- An individual line-item edit protects the visit even if its total stays the same.
create or replace function public.crm_replace_job_items(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_items jsonb) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_item jsonb; v_total numeric; v_result jsonb;
begin
  v_result := public.crm_operation_reply(p_operation_id,'replace_job_items',p_booking_id,p_items);
  if v_result is not null then return v_result; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.status in ('completed','canceled','skipped','declined') then
    raise exception 'Finished job prices cannot be changed' using errcode = '23514';
  end if;
  v_total := public.crm_validate_items(p_items);
  delete from public.job_items where booking_id = p_booking_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.job_items(booking_id,kind,description,amount)
      values(p_booking_id,v_item->>'kind',btrim(v_item->>'description'),(v_item->>'amount')::numeric);
  end loop;
  update public.bookings set job_total = v_total,
    price_per_visit = case when v_total = trunc(v_total) and v_total <= 2147483647
      then v_total::integer else null end,
    payment_link = null,
    schedule_state = case when schedule_state = 'generated' then 'exception' else schedule_state end
    where id = p_booking_id;
  v_result := jsonb_build_object('booking_id',p_booking_id,'job_total',v_total);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'replace_job_items',p_booking_id,p_items,v_result);
  return v_result;
end $$;

create or replace function public.crm_agreement_command(p_agreement_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql
  security invoker set search_path = '' as $$
declare v_agreement public.recurring_agreements; v_result jsonb; v_future jsonb;
  v_next date; v_source uuid; v_new uuid; v_total numeric; v_revision uuid; v_booking_id uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
  r public.agreement_schedule_revisions;
begin
  if p_action not in ('price_template','pause','end','resume') then
    raise exception 'Unsupported agreement action' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'agreement_' || p_action,
    p_agreement_id,p_payload);
  if v_result is not null then return v_result; end if;
  select * into v_agreement from public.recurring_agreements
    where id = p_agreement_id for update;
  if not found then raise exception 'Agreement not found' using errcode = 'P0002'; end if;
  if v_agreement.updated_at is distinct from p_expected_updated_at then
    raise exception 'Agreement changed since it was opened' using errcode = 'PT409';
  end if;
  if v_agreement.status = 'ended' then
    raise exception 'Ended agreements cannot be changed' using errcode = '23514';
  end if;
  if p_action = 'price_template' then
    v_total := public.crm_validate_items(p_payload->'items_template');
    update public.recurring_agreements set items_template = p_payload->'items_template',
      price_per_visit = v_total where id = p_agreement_id;
    select * into r from public.agreement_schedule_revisions where agreement_id = p_agreement_id
      and ends_before is null;
    if found then
      v_next := greatest(v_today,r.starts_on);
      v_revision := public.crm_write_schedule_revision(p_agreement_id,v_next,r.definition,
        p_payload->'items_template',r.visit_time);
      perform 1 from public.bookings where agreement_id = p_agreement_id and schedule_state = 'generated'
        and status = 'confirmed' and confirmed_date >= v_today order by id for update;
      for v_booking_id in
        update public.bookings b set schedule_revision_id = v_revision,job_total = v_total,
          price_per_visit = case when v_total = trunc(v_total) and v_total <= 2147483647 then v_total::integer end,
          first_visit_price = case when v_total = trunc(v_total) and v_total <= 2147483647 then v_total::integer end
        where b.agreement_id = p_agreement_id and b.schedule_state = 'generated' and b.status = 'confirmed'
          and b.occurrence_on >= v_next and b.confirmed_date >= v_today
          and b.amount_charged is null and b.payment_link is null
          and not exists(select 1 from public.job_payments p where p.booking_id = b.id)
        returning b.id
      loop
        delete from public.job_items where booking_id = v_booking_id;
        insert into public.job_items(booking_id,kind,description,amount)
          select v_booking_id,item->>'kind',item->>'description',(item->>'amount')::numeric
          from jsonb_array_elements(p_payload->'items_template') item;
      end loop;
      perform public.crm_reconcile_schedule(p_agreement_id,v_today);
    end if;
  elsif p_action in ('pause','end') then
    perform 1 from public.bookings where agreement_id = p_agreement_id order by id for update;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_future
      from public.bookings where agreement_id = p_agreement_id
        and status in ('pending','confirmed')
        and (coalesce(confirmed_date,preferred_date,occurrence_on) is null
          or coalesce(confirmed_date,preferred_date,occurrence_on)
            >= (now() at time zone 'America/Chicago')::date);
    if p_payload->'future_job_ids' is distinct from v_future then
      raise exception 'Future visit preview changed; review it again' using errcode = 'PT409';
    end if;
    if exists(select 1 from public.bookings b where b.id in
      (select value::uuid from jsonb_array_elements_text(v_future)) and
      (b.amount_charged is not null or b.payment_link is not null
        or exists(select 1 from public.job_payments p where p.booking_id = b.id))) then
      raise exception 'Review payments before canceling these future visits' using errcode = '23514';
    end if;
    if v_agreement.generation_starts_on is not null and v_agreement.status = 'active' then
      -- Finish recording already due work before closing the active period.
      perform public.crm_reconcile_schedule(p_agreement_id,v_today - 91);
      if exists(select 1 from public.recurring_agreements a where a.id = p_agreement_id
        and coalesce(a.generated_through + 1,a.generation_starts_on) <= least(v_today - 1,a.end_on)) then
        raise exception 'Schedule is catching up; try again after reconciling older visits' using errcode = 'PT409';
      end if;
      update public.agreement_schedule_revisions set ends_before = greatest(starts_on,v_today)
        where agreement_id = p_agreement_id and (ends_before is null or ends_before > v_today);
    end if;
    update public.recurring_agreements set status = case when p_action = 'pause'
      then 'paused' else 'ended' end,
      schedule_review_reason = case when p_action = 'pause' then schedule_review_reason end
      where id = p_agreement_id;
    update public.bookings set status = 'canceled',
      schedule_state = case when schedule_state = 'generated' then 'superseded' else schedule_state end,
      lifecycle_note = case when p_action = 'pause' then 'Canceled on agreement pause'
        else 'Canceled on agreement end' end
      where agreement_id = p_agreement_id and status in ('pending','confirmed')
      and (coalesce(confirmed_date,preferred_date,occurrence_on) is null
        or coalesce(confirmed_date,preferred_date,occurrence_on)
          >= (now() at time zone 'America/Chicago')::date);
  else
    if v_agreement.status <> 'paused' and v_agreement.schedule_review_reason is null then
      raise exception 'Only paused agreements or schedules under review can resume' using errcode = '23514';
    end if;
    v_next := nullif(p_payload->>'next_on','')::date;
    if v_next is null or v_next < (now() at time zone 'America/Chicago')::date then
      raise exception 'Choose a future resume date' using errcode = '22023';
    end if;
    if v_agreement.end_on is not null and v_next > v_agreement.end_on then
      raise exception 'Resume date exceeds agreement end date' using errcode = '22023';
    end if;
    if v_agreement.schedule_review_reason is not null and exists(
      select 1 from public.bookings where agreement_id = p_agreement_id
        and status in ('confirmed','completed')
        and coalesce(confirmed_date,(completed_at at time zone 'America/Chicago')::date) >= v_next
    ) then
      raise exception 'Choose a next date after the saved visits' using errcode = '22023';
    end if;
    select id into v_source from public.bookings where agreement_id = p_agreement_id
      and status <> 'pending' and customer_id = v_agreement.customer_id and property_id = v_agreement.property_id
      order by (id = v_agreement.schedule_source_booking_id) desc nulls last,occurrence_on desc limit 1;
    if v_source is null or jsonb_array_length(v_agreement.items_template) = 0 then
      raise exception 'Review the plan’s prior visit and price before resuming' using errcode = '23514';
    end if;
    update public.recurring_agreements set status = 'active',anchor_on = v_next,next_on = v_next,
      schedule_review_reason = null,
      schedule_source_booking_id = v_source,generation_starts_on = least(generation_starts_on,v_next),
      generated_through = v_next - 1 where id = p_agreement_id;
    select * into r from public.agreement_schedule_revisions where agreement_id = p_agreement_id
      order by created_at desc,starts_on desc limit 1;
    perform public.crm_write_schedule_revision(p_agreement_id,v_next,
      public.crm_legacy_schedule(v_next,v_agreement.interval_unit,v_agreement.interval_count),
      v_agreement.items_template,coalesce(r.visit_time,(select confirmed_time from public.bookings where id = v_source)));
    -- An explicitly resumed date may reuse a legacy visit canceled only by a plan pause.
    update public.bookings set schedule_state = 'superseded',
      original_occurrence_on = coalesce(original_occurrence_on,occurrence_on)
      where agreement_id = p_agreement_id and occurrence_on = v_next and schedule_state is null
        and status = 'canceled' and lifecycle_note = 'Canceled on agreement pause'
        and amount_charged is null and payment_link is null
        and not exists(select 1 from public.job_payments p where p.booking_id = bookings.id);
    if exists(select 1 from public.bookings b where b.agreement_id = p_agreement_id and b.occurrence_on = v_next
      and b.status in ('canceled','skipped') and b.schedule_state is distinct from 'superseded') then
      raise exception 'An individually canceled or skipped visit occupies this date' using errcode = '23505';
    end if;
    perform public.crm_reconcile_schedule(p_agreement_id,v_today);
    select id into v_new from public.bookings where agreement_id = p_agreement_id
      and occurrence_on = v_next and status = 'confirmed';
    update public.leads set customer_canceled_at = null where board_column = 'customer'
      and id = (select lead_id from public.bookings where id = v_source) and customer_canceled_at is not null;
  end if;
  v_result := jsonb_build_object('agreement_id',p_agreement_id,
    'status',case when p_action = 'pause' then 'paused' when p_action = 'end'
      then 'ended' when p_action = 'resume' then 'active' else v_agreement.status end,
    'future_job_ids',v_future,'next_booking_id',v_new,'price_per_visit',v_total);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'agreement_' || p_action,p_agreement_id,p_payload,v_result);
  return v_result;
end $$;

create or replace function public.crm_bookings_board_sync() returns trigger language plpgsql
  set search_path = '' as $$
begin
  if new.lead_id is null or new.schedule_state in ('generated','superseded') then return null; end if;
  if new.status in ('confirmed','completed')
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    -- Plan visits keep a customer current, but never pull a card staff closed back out.
    update public.leads set board_column = 'customer', customer_canceled_at = null
      where id = new.lead_id and (board_column <> 'customer' or customer_canceled_at is not null)
        and not (new.agreement_id is not null and board_column = 'closed');
  elsif tg_op = 'INSERT' and new.status = 'pending' and new.agreement_id is null then
    -- Online booking, emailed-quote booking or a staff job still waiting for a date.
    update public.leads set board_column = 'booking_request'
      where id = new.lead_id and board_column in ('new','in_talks','quoted','closed');
  elsif tg_op = 'UPDATE' and new.status = 'canceled' and old.status is distinct from 'canceled'
    and not exists (select 1 from public.bookings where lead_id = new.lead_id and id <> new.id
      and status in ('pending','confirmed')) then
    -- Customers keep their card with a Canceled chip (S9); a dropped request goes back to Quoted.
    update public.leads set
      customer_canceled_at = case when board_column = 'customer' then coalesce(customer_canceled_at, now())
        else customer_canceled_at end,
      board_column = case when board_column = 'booking_request' then 'quoted' else board_column end
      where id = new.lead_id and board_column in ('customer','booking_request');
  end if;
  return null;
end $$;

-- Retain every existing visit as saved history. A legacy plan without a dated,
-- identity-matched source and a priced template remains visible for review.
do $$
declare v_plan record;
begin
  for v_plan in
    select a.id,b.id as source_id from public.recurring_agreements a
    cross join lateral (
      select v.id from public.bookings v where v.agreement_id = a.id
        and v.customer_id = a.customer_id and v.property_id = a.property_id
        and v.status in ('confirmed','completed','skipped','canceled')
        and coalesce(v.confirmed_date,(v.completed_at at time zone 'America/Chicago')::date) is not null
      order by v.occurrence_on desc limit 1
    ) b
    where a.status in ('active','paused') and jsonb_array_length(a.items_template) > 0
    order by a.id
  loop
    perform public.crm_activate_schedule(v_plan.id,v_plan.source_id,true);
  end loop;
end $$;
