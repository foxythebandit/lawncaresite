-- Use one attention query for both the counters and their bounded drilldowns.
create function public.crm_calendar_attention_page(p_today date,p_kind text default null,
  p_limit integer default 25,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with gaps as (
    select a.id,a.schedule_source_booking_id,coalesce(a.generated_through + 1,a.generation_starts_on) as gap_start,
      least(p_today - 1,a.end_on) as gap_end
    from public.recurring_agreements a
    where a.status = 'active' and a.generation_starts_on is not null and a.schedule_review_reason is null
      and coalesce(a.generated_through + 1,a.generation_starts_on) <= least(p_today - 1,a.end_on)
  ), reviews as (
    select a.id,a.customer_id,a.property_id,a.schedule_source_booking_id,
      coalesce(a.schedule_review_reason,case
        when conflict.day is not null then format('A moved visit conflicts with the schedule on %s.',conflict.day)
        when a.status = 'active' and a.generation_starts_on is null
          and not exists(select 1 from public.bookings b where b.agreement_id = a.id and b.status = 'pending')
          then 'Review the schedule before generating more visits.'
      end) as reason,conflict.day
    from public.recurring_agreements a
    left join lateral (
      select public.crm_schedule_first_move_conflict(a.id,coalesce(a.generated_through + 1,a.generation_starts_on)) as day
      where a.status = 'active' and a.schedule_review_reason is null
    ) conflict on true
  ), entries as (
    select 'overdue'::text as kind,b.id as booking_id,b.agreement_id,null::uuid as revision_id,
      b.occurrence_on as cadence_on,b.confirmed_date as service_on,b.confirmed_time as visit_time,
      b.customer_id,b.name,b.address,b.phone,b.job_total,b.status as visit_status,null::text as reason,b.created_at
    from public.bookings b where b.status = 'confirmed' and b.confirmed_date < p_today
    union all
    select 'overdue',null::uuid,g.id,s.revision_id,s.cadence_on,s.cadence_on,r.visit_time,
      a.customer_id,b.name,b.address,b.phone,public.crm_validate_items(r.items_template),'confirmed',null::text,null::timestamptz
    from gaps g
    cross join lateral public.crm_schedule_slots(g.id,g.gap_start,least(g.gap_end,g.gap_start + 365)) s
    join public.recurring_agreements a on a.id = g.id
    join public.agreement_schedule_revisions r on r.id = s.revision_id
    left join public.bookings b on b.id = g.schedule_source_booking_id
    where not public.crm_schedule_has_actual_visit(g.id,s.cadence_on)
      and not exists(select 1 from public.bookings v where v.agreement_id = g.id
        and v.occurrence_on = s.cadence_on and v.schedule_state is distinct from 'superseded')
    union all
    select 'needs_scheduling',b.id,b.agreement_id,null::uuid,b.occurrence_on,b.preferred_date,b.preferred_time,
      b.customer_id,b.name,b.address,b.phone,b.job_total,b.status,null::text,b.created_at
    from public.bookings b where b.status = 'pending'
    union all
    select 'schedule_review',visit.id,r.id,null::uuid,visit.occurrence_on,r.day,visit.confirmed_time,
      r.customer_id,coalesce(visit.name,c.name),coalesce(visit.address,p.address),coalesce(visit.phone,c.phone),
      visit.job_total,visit.status,r.reason,visit.created_at
    from reviews r
    join public.customers c on c.id = r.customer_id
    join public.properties p on p.id = r.property_id
    left join lateral (
      select b.id,b.occurrence_on,b.confirmed_time,b.name,b.address,b.phone,b.job_total,b.status,b.created_at
      from public.bookings b where b.agreement_id = r.id
      order by (b.confirmed_date = r.day and b.status in ('confirmed','completed')) desc nulls last,
        (b.id = r.schedule_source_booking_id) desc nulls last,b.created_at desc,b.id
      limit 1
    ) visit on true
    where r.reason is not null
  ), page as (
    select kind,booking_id,agreement_id,revision_id,cadence_on,service_on,visit_time,
      customer_id,name,address,phone,job_total,visit_status,reason
    from entries where kind = p_kind
    order by service_on nulls first,created_at,booking_id,agreement_id
    limit greatest(0,least(p_limit,50)) offset greatest(0,p_offset)
  )
  select jsonb_build_object(
    'counts',jsonb_build_object(
      'overdue',count(*) filter (where kind = 'overdue'),
      'needs_scheduling',count(*) filter (where kind = 'needs_scheduling'),
      'schedule_review',count(*) filter (where kind = 'schedule_review'),
      'catching_up',exists(select 1 from gaps)),
    'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb))
  from entries;
$$;

create or replace function public.crm_calendar_attention(p_today date default (now() at time zone 'America/Chicago')::date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.crm_calendar_attention_page(p_today,null,0,0)->'counts';
$$;

create function public.crm_calendar_save_note(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_note text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.bookings; v_agreement_id uuid; v_result jsonb;
  v_request jsonb := jsonb_build_object('note',p_note);
begin
  if p_operation_id is null or p_note is null or length(p_note) > 2000 then
    raise exception 'Enter a note of up to 2,000 characters' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'visit_note',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select agreement_id into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is not null then
    perform 1 from public.recurring_agreements where id = v_agreement_id for update;
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Visit not found' using errcode = 'P0002'; end if;
  if b.updated_at is distinct from p_expected_updated_at then
    raise exception 'Visit changed since it was opened' using errcode = 'PT409';
  end if;
  update public.bookings set notes = nullif(p_note,'') where id = b.id;
  v_result := jsonb_build_object('booking_id',b.id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'visit_note',b.id,v_request,v_result);
  return v_result;
end $$;

-- The ledger and the visit both roll back if the requested operation fails.
create function public.crm_calendar_edit_occurrence(p_agreement_id uuid,p_revision_id uuid,p_on date,
  p_operation_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.bookings; v_id uuid; v_result jsonb;
  v_child_operation uuid := gen_random_uuid();
  v_request jsonb := jsonb_build_object('revision_id',p_revision_id,'on',p_on,'action',p_action,'payload',p_payload);
begin
  if p_operation_id is null or p_revision_id is null or p_on is null
    or p_action is null or p_action not in ('reschedule','shift','complete','notes','skip','cancel','items','payment','contact','payment_link','reminder') then
    raise exception 'Invalid projected visit action' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'visit_occurrence',p_agreement_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  v_id := public.crm_materialize_schedule_visit(p_agreement_id,p_revision_id,p_on);
  select * into b from public.bookings where id = v_id for update;
  -- Reconciliation may have saved an untouched visit after this page opened.
  -- Individual edits, payments, and a replaced cadence require a fresh review.
  if b.status <> 'confirmed' or b.confirmed_date is distinct from p_on
    or b.schedule_state is distinct from 'generated' or b.schedule_revision_id is distinct from p_revision_id
    or exists(select 1 from public.job_payments p where p.booking_id = b.id) then
    raise exception 'Visit changed since it was opened' using errcode = 'PT409';
  end if;
  case p_action
    when 'notes' then
      v_result := public.crm_calendar_save_note(b.id,b.updated_at,v_child_operation,p_payload->>'note');
    when 'complete' then
      v_result := public.complete_job(b.id,b.updated_at,v_child_operation,(p_payload->>'date')::date);
    when 'shift' then
      v_result := public.crm_shift_agreement(b.id,b.updated_at,v_child_operation,(p_payload->>'date')::date,p_payload->>'time');
    when 'items' then
      v_result := public.crm_replace_job_items(b.id,b.updated_at,v_child_operation,p_payload->'items');
    when 'payment' then
      v_result := jsonb_build_object('payment_id',public.record_job_payment(b.id,v_child_operation,
        (p_payload->>'amount')::numeric,(p_payload->>'date')::date,p_payload->>'method','manual'));
    when 'contact' then
      if nullif(btrim(p_payload->>'name'),'') is null or nullif(btrim(p_payload->>'phone'),'') is null then
        raise exception 'Enter a name and phone number' using errcode = '22023';
      end if;
      update public.bookings set name = btrim(p_payload->>'name'),phone = btrim(p_payload->>'phone'),
        email = nullif(btrim(p_payload->>'email'),'') where id = b.id;
      v_result := '{}'::jsonb;
    when 'payment_link', 'reminder' then
      if p_action = 'payment_link' and coalesce(b.job_total,0) <= 0 then
        raise exception 'Set a positive visit price first' using errcode = '22023';
      end if;
      if p_action = 'reminder' and nullif(btrim(b.email),'') is null then
        raise exception 'No email on file for this client' using errcode = '22023';
      end if;
      -- Provider calls follow commit, using the saved visit and this operation ID.
      v_result := jsonb_build_object('updated_at',b.updated_at,'prepared_at',statement_timestamp());
    else
      v_result := public.crm_job_command(b.id,b.updated_at,v_child_operation,p_action,p_payload);
  end case;
  v_result := v_result || jsonb_build_object('booking_id',b.id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'visit_occurrence',p_agreement_id,v_request,v_result);
  return v_result;
end $$;

revoke all on function public.crm_calendar_attention_page(date,text,integer,integer),
  public.crm_calendar_save_note(uuid,timestamptz,uuid,text),
  public.crm_calendar_edit_occurrence(uuid,uuid,date,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.crm_calendar_attention_page(date,text,integer,integer),
  public.crm_calendar_save_note(uuid,timestamptz,uuid,text),
  public.crm_calendar_edit_occurrence(uuid,uuid,date,uuid,text,jsonb)
  to service_role;
