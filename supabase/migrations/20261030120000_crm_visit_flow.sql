-- Visit flow for plan customers (owner report, 30 Oct): log each visit, move one visit or the
-- whole plan, and fold a recurring visit booked from a lead into the customer's existing plan.

-- The next plan visit is never in the past, and a plan never gets a second open visit ahead
-- of the one it already has (completing, skipping or canceling an old visit while a later one
-- is booked reuses the later one). Explicit dates (p_force_on: resume, plan started from a
-- finished visit) are honored as before.
create or replace function public.crm_generate_next_job(p_booking_id uuid,p_after date,p_force_on date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_booking public.bookings; v_agreement public.recurring_agreements;
  v_next date; v_id uuid; v_item jsonb; v_total numeric; v_last_mow text;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.agreement_id is null then return null; end if;
  select * into v_agreement from public.recurring_agreements
    where id = v_booking.agreement_id for update;
  if v_agreement.status <> 'active' then return null; end if;
  if p_force_on is null then
    select id into v_id from public.bookings where agreement_id = v_agreement.id
      and id <> p_booking_id and status in ('pending','confirmed') and occurrence_on > p_after
      order by occurrence_on limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  v_next := coalesce(p_force_on,case when v_agreement.next_on > p_after
    then v_agreement.next_on else public.crm_next_occurrence(
      v_agreement.anchor_on,p_after,v_agreement.interval_unit,v_agreement.interval_count) end);
  if p_force_on is null and v_next < v_today then
    v_next := public.crm_next_occurrence(v_agreement.anchor_on,v_today - 1,
      v_agreement.interval_unit,v_agreement.interval_count);
  end if;
  if v_agreement.end_on is not null and v_next > v_agreement.end_on then return null; end if;
  if jsonb_array_length(v_agreement.items_template) > 0 then
    v_total := public.crm_validate_items(v_agreement.items_template);
  else
    v_total := coalesce(v_agreement.price_per_visit,0);
  end if;
  v_last_mow := v_booking.last_mow;
  if v_booking.status = 'completed' and exists(
    select 1 from public.job_items where booking_id = p_booking_id and kind = 'service'
      and description ~* '(mow|lawn care|lawn cut|grass cut)') then
    v_last_mow := v_booking.completed_at::date::text;
  end if;
  insert into public.bookings(name,phone,email,address,customer_id,property_id,
    agreement_id,occurrence_on,confirmed_date,status,price_per_visit,frequency,
    accepted_quote_snapshot,attribution,lead_id,one_time,manual_quote,notify_failed,
    job_total,gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,
    gbraid,wbraid,google_campaign_id,google_adgroup_id,google_ad_id,
    sq_ft,first_visit_price,confirmed_time,map_screenshot_url,addon_interest,
    preferred_date,last_mow,customer_notes,preferred_time)
  values(v_booking.name,v_booking.phone,v_booking.email,v_booking.address,
    v_agreement.customer_id,v_agreement.property_id,v_agreement.id,v_next,v_next,
    'confirmed',case when v_total = trunc(v_total) and v_total <= 2147483647
      then v_total::integer end,v_booking.frequency,
    jsonb_build_object('agreement_id',v_agreement.id,'items',v_agreement.items_template,
      'total',v_total,'currency','USD'),v_booking.attribution,v_booking.lead_id,
    false,false,false,v_total,v_booking.gclid,v_booking.utm_source,v_booking.utm_medium,
    v_booking.utm_campaign,v_booking.utm_term,v_booking.utm_content,
    v_booking.gbraid,v_booking.wbraid,v_booking.google_campaign_id,
    v_booking.google_adgroup_id,v_booking.google_ad_id,v_booking.sq_ft,
    case when v_total = trunc(v_total) and v_total <= 2147483647
      then v_total::integer end,
    v_booking.confirmed_time,v_booking.map_screenshot_url,null,
    v_next,v_last_mow,v_booking.customer_notes,v_booking.preferred_time)
  on conflict (agreement_id,occurrence_on) where agreement_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.bookings
      where agreement_id = v_agreement.id and occurrence_on = v_next;
    if p_force_on is not null and exists(select 1 from public.bookings where id = v_id
      and status = 'canceled' and lifecycle_note = 'Canceled on agreement pause') then
      update public.bookings set status = 'confirmed',confirmed_date = v_next,
        preferred_date = v_next,lifecycle_note = 'Resumed after agreement pause'
        where id = v_id;
    elsif exists(select 1 from public.bookings where id = v_id and status in ('canceled','skipped')) then
      raise exception 'An individually canceled or skipped visit occupies this date'
        using errcode = '23505';
    end if;
  else
    for v_item in select value from jsonb_array_elements(v_agreement.items_template) loop
      insert into public.job_items(booking_id,kind,description,amount)
        values(v_id,v_item->>'kind',v_item->>'description',(v_item->>'amount')::numeric);
    end loop;
  end if;
  update public.recurring_agreements set next_on = public.crm_next_occurrence(
    anchor_on,v_next,interval_unit,interval_count) where id = v_agreement.id;
  return v_id;
end $$;

-- Fold a visit that is not in a plan (a recurring booking from a lead) into the customer's
-- active plan at the same property. The visit keeps its own price. When it is the plan's
-- latest open visit, the plan's schedule restarts from its date.
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
  update public.bookings set agreement_id = p_agreement_id,occurrence_on = v_on,one_time = false,
    lifecycle_note = 'Added to mowing plan' where id = p_booking_id;
  if not exists(select 1 from public.bookings where agreement_id = p_agreement_id
      and id <> p_booking_id and status in ('pending','confirmed') and occurrence_on > v_on) then
    if v_agreement.end_on is not null and v_on > v_agreement.end_on then
      raise exception 'Visit is after the plan''s end date' using errcode = '22023';
    end if;
    update public.recurring_agreements set anchor_on = v_on,next_on = public.crm_next_occurrence(
      v_on,v_on,interval_unit,interval_count) where id = p_agreement_id;
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'agreement_id',p_agreement_id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'attach_agreement',p_booking_id,v_request,v_result);
  return v_result || '{"duplicate":false}'::jsonb;
end $$;

-- Move one upcoming plan visit and the rest of the plan with it: the visit's date becomes the
-- plan's new starting point, later open plan visits shift by the same number of days, and
-- future visits follow the new cadence. (Moving only this visit stays crm_job_command reschedule.)
create or replace function public.crm_shift_agreement(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_date date,p_time text) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_agreement public.recurring_agreements; v_result jsonb;
  v_request jsonb := jsonb_build_object('date',p_date,'time',p_time); v_from date;
  v_delta integer; v_row record; v_last date; v_agreement_id uuid;
begin
  if p_date is null then raise exception 'Visit date required' using errcode = '22023'; end if;
  v_result := public.crm_operation_reply(p_operation_id,'shift_agreement',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select agreement_id into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is null then
    raise exception 'Only a mowing plan visit can move the plan' using errcode = '23514';
  end if;
  select * into v_agreement from public.recurring_agreements where id = v_agreement_id for update;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.status not in ('pending','confirmed') then
    raise exception 'Finished job cannot be changed' using errcode = '23514';
  end if;
  if v_agreement.status <> 'active' then
    raise exception 'Only an active plan can be moved' using errcode = '23514';
  end if;
  if v_agreement.end_on is not null and p_date > v_agreement.end_on then
    raise exception 'New date is after the plan''s end date' using errcode = '22023';
  end if;
  v_from := v_booking.occurrence_on;
  v_delta := p_date - v_from;
  if exists(select 1 from public.bookings where agreement_id = v_agreement.id and id <> p_booking_id
      and occurrence_on = p_date and not (status in ('pending','confirmed') and occurrence_on > v_from)) then
    raise exception 'The plan already has a visit on that date' using errcode = '23514';
  end if;
  -- Move this visit and every later open plan visit; order avoids passing through a taken date.
  for v_row in select id,occurrence_on from public.bookings where agreement_id = v_agreement.id
      and (id = p_booking_id or (status in ('pending','confirmed') and occurrence_on > v_from))
      order by case when v_delta > 0 then -extract(epoch from occurrence_on::timestamp)
        else extract(epoch from occurrence_on::timestamp) end loop
    update public.bookings set occurrence_on = v_row.occurrence_on + v_delta,
      confirmed_date = v_row.occurrence_on + v_delta,preferred_date = v_row.occurrence_on + v_delta,
      status = 'confirmed',
      confirmed_time = case when id = p_booking_id then nullif(p_time,'') else confirmed_time end,
      lifecycle_note = 'Plan moved' where id = v_row.id;
  end loop;
  select max(occurrence_on) into v_last from public.bookings where agreement_id = v_agreement.id
    and status in ('pending','confirmed');
  update public.recurring_agreements set anchor_on = p_date,next_on = public.crm_next_occurrence(
    p_date,greatest(p_date,v_last),interval_unit,interval_count) where id = v_agreement.id;
  v_result := jsonb_build_object('booking_id',p_booking_id,'agreement_id',v_agreement.id,
    'shift_days',v_delta);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'shift_agreement',p_booking_id,v_request,v_result);
  return v_result || '{"duplicate":false}'::jsonb;
end $$;

revoke all on function public.crm_generate_next_job(uuid,date,date),
  public.crm_attach_to_agreement(uuid,timestamptz,uuid,uuid),
  public.crm_shift_agreement(uuid,timestamptz,uuid,date,text) from public,anon,authenticated;
grant execute on function public.crm_generate_next_job(uuid,date,date),
  public.crm_attach_to_agreement(uuid,timestamptz,uuid,uuid),
  public.crm_shift_agreement(uuid,timestamptz,uuid,date,text) to service_role;
