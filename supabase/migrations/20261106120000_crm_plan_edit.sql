-- Edit plan (owner request, 6 Nov): change how often a plan visits, and resume a paused plan
-- on the rhythm of its resume date. Past, finished and canceled visits are never changed.

-- Change how often a plan visits. The next upcoming plan visit keeps its date and becomes the
-- plan's new starting point; later open plan visits are re-spaced on the new interval from it.
-- Open visits get the new frequency label; every other visit keeps its own.
create or replace function public.crm_change_agreement_interval(p_agreement_id uuid,
  p_expected_updated_at timestamptz,p_operation_id uuid,p_unit text,p_count integer,p_label text)
  returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_agreement public.recurring_agreements; v_result jsonb; v_base date; v_prev date;
  v_last date; v_row record; v_targets jsonb := '{}'::jsonb; v_moved integer := 0;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_request jsonb := jsonb_build_object('interval_unit',p_unit,'interval_count',p_count,'label',p_label);
begin
  if p_unit is null or p_unit not in ('week','month') or p_count is null or p_count < 1 or p_count > 52 then
    raise exception 'Choose how often to visit' using errcode = '22023';
  end if;
  if nullif(btrim(p_label),'') is null or length(p_label) > 60 then
    raise exception 'Frequency label required' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'agreement_interval',p_agreement_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select * into v_agreement from public.recurring_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if v_agreement.updated_at is distinct from p_expected_updated_at then
    raise exception 'Plan changed since it was opened' using errcode = 'PT409';
  end if;
  if v_agreement.status = 'ended' then
    raise exception 'Ended plans cannot be changed' using errcode = '23514';
  end if;
  if v_agreement.interval_unit = p_unit and v_agreement.interval_count = p_count then
    raise exception 'The plan already visits that often' using errcode = '22023';
  end if;
  -- The next visit: the earliest open plan visit from today on, else an overdue open one.
  select occurrence_on into v_base from public.bookings
    where agreement_id = p_agreement_id and status in ('pending','confirmed')
    order by (occurrence_on < v_today), occurrence_on limit 1;
  if v_base is not null then
    v_prev := v_base;
    for v_row in select id from public.bookings where agreement_id = p_agreement_id
        and status in ('pending','confirmed') and occurrence_on > v_base order by occurrence_on loop
      v_prev := public.crm_next_occurrence(v_base,v_prev,p_unit,p_count);
      v_targets := v_targets || jsonb_build_object(v_row.id::text,v_prev);
    end loop;
    if exists(select 1 from public.bookings b where b.agreement_id = p_agreement_id
        and not (v_targets ? b.id::text)
        and b.occurrence_on in (select (value #>> '{}')::date from jsonb_each(v_targets))) then
      raise exception 'Another visit of this plan is on one of the new dates; move or cancel it first'
        using errcode = '23514';
    end if;
    -- Two steps so no visit passes through a date another moving visit still holds.
    update public.bookings b set occurrence_on = date '2999-01-01' + t.n::integer
      from (select key::uuid as id,row_number() over (order by key) as n from jsonb_each(v_targets)) t
      where b.id = t.id;
    update public.bookings b set occurrence_on = (v_targets->>b.id::text)::date,
      preferred_date = (v_targets->>b.id::text)::date,
      confirmed_date = case when b.status = 'confirmed' then (v_targets->>b.id::text)::date else b.confirmed_date end,
      lifecycle_note = 'Plan schedule changed'
      where v_targets ? b.id::text;
    get diagnostics v_moved = row_count;
    update public.bookings set frequency = btrim(p_label)
      where agreement_id = p_agreement_id and status in ('pending','confirmed');
    select max(occurrence_on) into v_last from public.bookings
      where agreement_id = p_agreement_id and status in ('pending','confirmed');
    update public.recurring_agreements set interval_unit = p_unit,interval_count = p_count,
      anchor_on = v_base,next_on = public.crm_next_occurrence(v_base,v_last,p_unit,p_count)
      where id = p_agreement_id;
  else
    -- Nothing booked (a paused plan): the date it would book next becomes the starting point.
    update public.recurring_agreements set interval_unit = p_unit,interval_count = p_count,
      anchor_on = least(next_on,coalesce(end_on,next_on)) where id = p_agreement_id;
  end if;
  v_result := jsonb_build_object('agreement_id',p_agreement_id,'from',v_base,'moved',v_moved);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'agreement_interval',p_agreement_id,v_request,v_result);
  return v_result || '{"duplicate":false}'::jsonb;
end $$;

-- Same command as before; only resume changes: the plan's rhythm restarts from the resume date,
-- so the visit after it is a full interval later (before, it followed the old start date).
create or replace function public.crm_agreement_command(p_agreement_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql
  security invoker set search_path = '' as $$
declare v_agreement public.recurring_agreements; v_result jsonb; v_future jsonb;
  v_next date; v_source uuid; v_new uuid; v_total numeric;
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
  elsif p_action in ('pause','end') then
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_future
      from public.bookings where agreement_id = p_agreement_id
        and status in ('pending','confirmed')
        and (coalesce(confirmed_date,preferred_date,occurrence_on) is null
          or coalesce(confirmed_date,preferred_date,occurrence_on)
            >= (now() at time zone 'America/Chicago')::date);
    if p_payload->'future_job_ids' is distinct from v_future then
      raise exception 'Future visit preview changed; review it again' using errcode = 'PT409';
    end if;
    update public.recurring_agreements set status = case when p_action = 'pause'
      then 'paused' else 'ended' end where id = p_agreement_id;
    update public.bookings set status = 'canceled',
      lifecycle_note = case when p_action = 'pause' then 'Canceled on agreement pause'
        else 'Canceled on agreement end' end
      where agreement_id = p_agreement_id and status in ('pending','confirmed')
      and (coalesce(confirmed_date,preferred_date,occurrence_on) is null
        or coalesce(confirmed_date,preferred_date,occurrence_on)
          >= (now() at time zone 'America/Chicago')::date);
  else
    if v_agreement.status <> 'paused' then
      raise exception 'Only paused agreements can resume' using errcode = '23514';
    end if;
    v_next := nullif(p_payload->>'next_on','')::date;
    if v_next is null or v_next < (now() at time zone 'America/Chicago')::date then
      raise exception 'Choose a future resume date' using errcode = '22023';
    end if;
    if v_agreement.end_on is not null and v_next > v_agreement.end_on then
      raise exception 'Resume date exceeds agreement end date' using errcode = '22023';
    end if;
    select id into v_source from public.bookings where agreement_id = p_agreement_id
      order by occurrence_on desc limit 1;
    if v_source is null then raise exception 'No prior agreement job' using errcode = 'P0002'; end if;
    update public.recurring_agreements set status = 'active',next_on = v_next,
      anchor_on = least(v_next,coalesce(end_on,v_next)) where id = p_agreement_id;
    v_new := public.crm_generate_next_job(v_source,v_next - 1,v_next);
  end if;
  v_result := jsonb_build_object('agreement_id',p_agreement_id,
    'status',case when p_action = 'pause' then 'paused' when p_action = 'end'
      then 'ended' when p_action = 'resume' then 'active' else v_agreement.status end,
    'future_job_ids',v_future,'next_booking_id',v_new,'price_per_visit',v_total);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'agreement_' || p_action,p_agreement_id,p_payload,v_result);
  return v_result;
end $$;

revoke all on function public.crm_change_agreement_interval(uuid,timestamptz,uuid,text,integer,text),
  public.crm_agreement_command(uuid,timestamptz,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_change_agreement_interval(uuid,timestamptz,uuid,text,integer,text),
  public.crm_agreement_command(uuid,timestamptz,uuid,text,jsonb) to service_role;
