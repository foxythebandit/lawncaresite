-- Distinguish an idempotent replay so downstream email is not sent twice.
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

