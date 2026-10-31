-- Preserve completed one-off jobs when adding recurrence, and advance after one-visit cancel.
create or replace function public.crm_validate_items(p_items jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
declare v_item jsonb; v_amount numeric; v_total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one priced item is required' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'kind','') not in ('service','discount')
      or nullif(btrim(v_item->>'description'),'') is null
      or length(v_item->>'description') > 240
      or coalesce(v_item->>'amount','') !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$' then
      raise exception 'Invalid priced item' using errcode = '22023';
    end if;
    v_amount := (v_item->>'amount')::numeric;
    if (v_item->>'kind' = 'service' and v_amount < 0)
      or (v_item->>'kind' = 'discount' and v_amount > 0) then
      raise exception 'Item amount has wrong sign' using errcode = '22023';
    end if;
    v_total := v_total + v_amount;
  end loop;
  if v_total < 0 or v_total > 9999999999.99 then
    raise exception 'Job total is outside allowed range' using errcode = '22023';
  end if;
  return v_total;
end $$;

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
  update public.bookings set agreement_id = v_id,occurrence_on = v_occurrence,
    one_time = false where id = p_booking_id;
  if v_booking.status = 'completed' then
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
  if v_result is not null then return v_result; end if;
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


-- Explicitly convert legacy recurring work before completion; never silently stop its cadence.
create or replace function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_completed_on date) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_agreement_id uuid; v_next_id uuid;
  v_result jsonb; v_request jsonb;
begin
  if p_completed_on is null then raise exception 'Completion date required' using errcode = '22023'; end if;
  v_request := jsonb_build_object('completed_on',p_completed_on);
  v_result := public.crm_operation_reply(p_operation_id,'complete_job',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select agreement_id into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is not null then
    perform 1 from public.recurring_agreements where id = v_agreement_id for update;
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.completion_operation_id = p_operation_id then
    select id into v_next_id from public.bookings where agreement_id = v_booking.agreement_id
      and occurrence_on > v_booking.occurrence_on and status not in ('canceled','skipped')
      order by occurrence_on limit 1;
    return jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next_id,
      'duplicate',true);
  end if;
  if v_booking.status <> 'confirmed' or v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Confirmed job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.agreement_id is null and not coalesce(v_booking.one_time,false)
    and nullif(btrim(v_booking.frequency),'') is not null
    and v_booking.frequency !~* '(one.?time|single|once)' then
    raise exception 'Link customer and start an agreement, or mark this visit one-time before completion'
      using errcode = '23514';
  end if;
  update public.bookings set status = 'completed',
    completed_at = p_completed_on::timestamp at time zone 'America/Chicago',
    completion_operation_id = p_operation_id where id = p_booking_id;
  if v_booking.agreement_id is not null then
    v_next_id := public.crm_generate_next_job(p_booking_id,v_booking.occurrence_on);
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next_id,
    'duplicate',false);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'complete_job',p_booking_id,v_request,v_result);
  return v_result;
end $$;

