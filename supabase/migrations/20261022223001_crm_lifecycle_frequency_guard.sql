-- Only exact one-time labels exempt a legacy cadence from explicit conversion.
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
    and btrim(v_booking.frequency) !~* '^(one[ -]?time|single|once)$' then
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

