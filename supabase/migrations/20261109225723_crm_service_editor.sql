-- The label is descriptive. Each service keeps its own quoted items and price.
create function public.crm_save_service_label(p_id uuid,p_expected_updated_at timestamptz,
  p_name text,p_retire boolean,p_operation_id uuid,p_staff_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.service_labels; v_result jsonb;
  v_target uuid := coalesce(p_id,p_operation_id);
  v_request jsonb := jsonb_build_object('name',btrim(p_name),'retire',p_retire,'staff_user_id',p_staff_user_id);
begin
  if p_operation_id is null or p_staff_user_id is null or p_retire is null
    or length(coalesce(btrim(p_name),'')) not between 1 and 120
    or (p_id is null and p_retire) then
    raise exception 'Enter a service name of up to 120 characters' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'service_label',v_target,v_request);
  if v_result is not null then return v_result; end if;
  if p_id is null then
    insert into public.service_labels(id,name) values(p_operation_id,btrim(p_name)) returning * into l;
  else
    select * into l from public.service_labels where id = p_id for update;
    if not found or l.updated_at is distinct from p_expected_updated_at or l.retired_at is not null then
      raise exception 'Service label changed; reopen it before saving' using errcode = 'PT409';
    end if;
    update public.service_labels set name = btrim(p_name),updated_at = clock_timestamp(),
      retired_at = case when p_retire then clock_timestamp() end where id = p_id returning * into l;
  end if;
  v_result := to_jsonb(l);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'service_label',v_target,v_request,v_result);
  return v_result;
end $$;

-- A strict date is checked by the recurrence engine. Exact clock values are
-- local to Austin, including the spring-forward gap. No UTC instant is needed
-- for a visit window, and a fall-back value retains its displayed wall time.
create function public.crm_service_arrival(p_time text,p_on date) returns text
language plpgsql stable security invoker set search_path = '' as $$
declare v_local timestamp;
begin
  if length(p_time) > 120 then raise exception 'Arrival must be at most 120 characters' using errcode = '22023'; end if;
  if p_time ~ '^[0-9]{2}:[0-9]{2}$' then
    if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Choose a valid exact arrival time' using errcode = '22023';
    end if;
    v_local := p_on + p_time::time;
    if timezone('America/Chicago',timezone('America/Chicago',v_local)) <> v_local then
      raise exception 'That arrival time does not exist in Austin on %',p_on using errcode = '22023';
    end if;
  end if;
  return nullif(btrim(p_time),'');
end $$;

-- Add one service visit or start its recurrence. An existing booked visit
-- retains its items and accepted terms while later visits get their own price.
create function public.crm_service_create(p_customer_id uuid,p_request jsonb,p_staff_user_id uuid,
  p_operation_id uuid default null,p_preview text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.service_labels; b public.bookings; a public.recurring_agreements;
  v_property uuid := (p_request->>'property_id')::uuid;
  v_source uuid := (p_request->>'source_id')::uuid;
  v_related uuid := (p_request->>'related_agreement_id')::uuid;
  v_address text := nullif(btrim(p_request->>'address'),'');
  v_first date := (p_request->>'first_on')::date;
  v_end date := (p_request->>'end_on')::date;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_definition jsonb := nullif(p_request->'definition','null'::jsonb);
  v_time text; v_items jsonb; v_total numeric; v_result jsonb; v_token text; v_revision uuid;
  v_dates jsonb; v_start date; v_frequency text; v_unit text; v_count integer;
  v_request jsonb := jsonb_build_object('edit',p_request,'staff_user_id',p_staff_user_id);
begin
  if p_operation_id is not null then
    v_result := public.crm_operation_reply(p_operation_id,'service_create',p_customer_id,v_request);
    if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  end if;
  if p_staff_user_id is null or v_first is null or (v_end is not null and v_end < v_first)
    or (v_source is null and v_first < v_today) then
    raise exception 'Choose a current or future first visit date' using errcode = '22023';
  end if;
  if v_related is not null then
    select * into a from public.recurring_agreements where id = v_related for update;
    if not found or a.customer_id <> p_customer_id or a.property_id is distinct from v_property
      or a.service_label_id is distinct from (p_request->>'label_id')::uuid or a.status = 'ended'
      or v_definition is not null or v_source is not null then
      raise exception 'Choose the same customer, property, and service for the extra visit' using errcode = '23514';
    end if;
  end if;
  select * into l from public.service_labels where id = (p_request->>'label_id')::uuid for share;
  if not found or (l.retired_at is not null and v_related is null) then
    raise exception 'Choose an active service label' using errcode = '22023';
  end if;
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if v_property is not null then
    if v_address is not null or not exists(select 1 from public.properties
      where id = v_property and customer_id = p_customer_id) then
      raise exception 'Choose a property belonging to this customer' using errcode = '23514';
    end if;
  elsif v_address is null or length(v_address) > 500 then
    raise exception 'Enter the property address' using errcode = '22023';
  end if;
  if v_source is not null then
    select * into b from public.bookings where id = v_source for update;
    if not found or v_definition is null or b.agreement_id is not null or b.customer_id is distinct from p_customer_id
      or b.property_id is distinct from v_property or b.property_id is null
      or (b.service_label_id is not null and b.service_label_id <> l.id)
      or b.status not in ('confirmed','completed')
      or coalesce(b.confirmed_date,(b.completed_at at time zone 'America/Chicago')::date) is distinct from v_first
      or b.updated_at is distinct from (p_request->>'source_version')::timestamptz then
      raise exception 'Choose the current booked visit for this service and property' using errcode = 'PT409';
    end if;
  end if;
  if coalesce(p_request->>'price','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
    raise exception 'Enter an agreed price in dollars and cents' using errcode = '22023';
  end if;
  v_items := jsonb_build_array(jsonb_build_object('kind','service','description',l.name,'amount',p_request->>'price'));
  v_total := public.crm_validate_items(v_items);
  v_time := public.crm_service_arrival(p_request->>'arrival',v_first);
  v_start := greatest(v_first + 1,v_today);
  if v_definition is not null then
    perform public.crm_validate_schedule(v_definition);
    v_frequency := v_definition->'base'->>'frequency';
    if v_frequency = 'legacy' then raise exception 'Choose weekly, every two weeks, or monthly' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('on',d,'price',v_total,'arrival',public.crm_service_arrival(v_time,d)) order by d),'[]')
      into v_dates from public.crm_schedule_dates(v_definition,v_start,least(v_start + 365,v_end)) d
      where v_end is null or d <= v_end;
    if jsonb_array_length(v_dates) = 0 then
      raise exception 'The repeating schedule has no future visit in the next year' using errcode = '22023';
    end if;
  else
    v_dates := '[]'::jsonb;
  end if;
  v_result := jsonb_build_object('first_on',v_first,
    'first_price',case when b.id is null then v_total else coalesce(b.job_total,b.first_visit_price,b.price_per_visit,0) end,
    'first_arrival',case when b.id is not null then b.confirmed_time else v_time end,
    'same_day_extra',v_related is not null and (public.crm_schedule_has_actual_visit(v_related,v_first)
      or exists(select 1 from public.crm_schedule_slots(v_related,v_first,v_first))),
    'dates',v_dates,'name',l.name,'changes','[]'::jsonb,'conflicts','[]'::jsonb);
  v_token := md5(jsonb_build_array(v_today,v_request,v_result,l.updated_at,a.updated_at)::text);
  if p_operation_id is null then return v_result || jsonb_build_object('preview',v_token); end if;
  if p_preview is distinct from v_token then
    raise exception 'Service preview changed. Review it again before saving.' using errcode = 'PT409';
  end if;
  if v_source is null then
    v_result := public.crm_create_customer_job(gen_random_uuid(),p_customer_id,v_property,
      case when v_property is null then jsonb_build_object('address',v_address) end,
      jsonb_build_object('preferred_date',v_first,'one_time',true,'notes',p_request->>'notes'),v_items);
    v_source := (v_result->>'booking_id')::uuid;
    v_property := (v_result->>'property_id')::uuid;
    select * into b from public.bookings where id = v_source;
    perform public.crm_job_command(b.id,b.updated_at,gen_random_uuid(),'confirm',jsonb_build_object('date',v_first,'time',v_time));
  end if;
  update public.bookings set service_label_id = l.id where id = v_source;
  if v_definition is not null then
    v_unit := case when v_frequency = 'monthly' then 'month' else 'week' end;
    v_count := case when v_frequency = 'biweekly' then 2 else 1 end;
    insert into public.recurring_agreements(customer_id,property_id,anchor_on,next_on,end_on,interval_unit,interval_count,
      price_per_visit,items_template,service_label_id,schedule_source_booking_id,generation_starts_on,generated_through)
      values(p_customer_id,v_property,v_first,(v_dates->0->>'on')::date,v_end,v_unit,v_count,v_total,
        v_items,l.id,v_source,v_start,v_start - 1) returning * into a;
    update public.bookings set agreement_id = a.id,occurrence_on = v_first,original_occurrence_on = v_first,
      schedule_state = 'exception',retain_visit = true,price_override = true,one_time = false
      where id = v_source;
    v_revision := public.crm_write_schedule_revision(a.id,v_start,v_definition,v_items,v_time);
    update public.agreement_schedule_revisions set staff_user_id = p_staff_user_id,operation_id = p_operation_id
      where id = v_revision;
    perform public.crm_reconcile_schedule(a.id,v_today);
  end if;
  v_result := jsonb_build_object('booking_id',v_source,'agreement_id',case when v_definition is not null then a.id end,
    'property_id',v_property,'duplicate',false);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'service_create',p_customer_id,v_request,v_result);
  return v_result;
end $$;

-- Preview and commit share the candidate segments and affected rows. Commit
-- recomputes them under the agreement and visit locks before accepting the token.
create function public.crm_service_edit(p_agreement_id uuid,p_expected_updated_at timestamptz,
  p_request jsonb,p_staff_user_id uuid,p_operation_id uuid default null,p_preview text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; l public.service_labels; r public.agreement_schedule_revisions;
  v_mode text := p_request->>'mode'; v_from date := (p_request->>'from')::date;
  v_through date := case when v_mode = 'range' then (p_request->>'through')::date end; v_end date;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_begin date; v_limit date; v_reset date; v_rule jsonb; v_def jsonb; v_items jsonb; v_time text;
  v_label uuid; v_unit text; v_count integer; v_total numeric; v_id uuid;
  v_segments jsonb := '[]'; v_changes jsonb := '[]'; v_dates jsonb := '[]'; v_conflicts jsonb := '[]';
  v_result jsonb; v_token text; v_future jsonb; v_collision date;
  v_segment record; v_row record; v_affected record;
  v_request jsonb := jsonb_build_object('edit',p_request,'staff_user_id',p_staff_user_id);
begin
  if p_operation_id is not null then
    v_result := public.crm_operation_reply(p_operation_id,'service_edit',p_agreement_id,v_request);
    if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  end if;
  if p_staff_user_id is null or v_mode is null or v_mode not in ('future','range','pause','end','resume')
    or v_from is null or v_from < v_today
    or (v_mode = 'range' and (v_through is null or v_through - v_from not between 0 and 365))
    or (v_mode in ('pause','end') and v_from <> v_today) then
    raise exception 'Choose a valid future schedule scope' using errcode = '22023';
  end if;
  select * into a from public.recurring_agreements where id = p_agreement_id for update;
  if not found or a.updated_at is distinct from p_expected_updated_at then
    raise exception 'Schedule changed. Reopen it before editing.' using errcode = 'PT409';
  end if;
  if a.status = 'ended' or (v_mode = 'resume' and a.status <> 'paused' and a.schedule_review_reason is null)
    or (v_mode in ('future','range','pause') and a.status <> 'active')
    or (v_mode = 'range' and a.generation_starts_on is null) then
    raise exception 'That change is unavailable for this schedule' using errcode = '23514';
  end if;
  perform 1 from public.bookings where agreement_id = a.id order by id for update;
  select * into r from public.agreement_schedule_revisions where agreement_id = a.id
    and (ends_before is null or ends_before > starts_on)
    order by starts_on desc,created_at desc,id limit 1;
  v_end := case when v_mode = 'future' then (p_request->>'end_on')::date else a.end_on end;
  v_label := a.service_label_id;
  v_items := a.items_template;
  v_time := r.visit_time;
  v_def := r.definition;
  v_reset := v_from;
  v_limit := least(v_from + 365,v_through,v_end);
  if v_mode not in ('pause','end') and v_limit < v_from then
    raise exception 'The change begins after this service ends' using errcode = '22023';
  end if;

  if v_mode = 'future' then
    if a.schedule_review_reason is not null or a.generation_starts_on is null then
      raise exception 'Review and restart this schedule first' using errcode = '23514';
    end if;
    v_def := p_request->'definition';
    perform public.crm_validate_schedule(v_def);
    v_label := coalesce((p_request->>'label_id')::uuid,v_label);
    if v_label is not null then
      select * into l from public.service_labels where id = v_label for share;
      if not found or (l.retired_at is not null and v_label is distinct from a.service_label_id) then
        raise exception 'Choose an active service label' using errcode = '22023';
      end if;
    end if;
    if p_request->>'items_template' is not null then
      v_items := p_request->'items_template';
      perform public.crm_validate_items(v_items);
    elsif p_request->>'price' is not null then
      if coalesce(p_request->>'price','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
        raise exception 'Enter an agreed price in dollars and cents' using errcode = '22023';
      end if;
      v_items := jsonb_build_array(jsonb_build_object('kind','service',
        'description',coalesce(l.name,v_items->0->>'description','Service visit'),'amount',p_request->>'price'));
      perform public.crm_validate_items(v_items);
    end if;
    if p_request ? 'arrival' then v_time := public.crm_service_arrival(p_request->>'arrival',v_from); end if;
    v_segments := jsonb_build_array(jsonb_build_object('starts_on',v_from,'ends_before',null,
      'definition',v_def,'items_template',v_items,'visit_time',v_time,'service_label_id',v_label));
  elsif v_mode = 'range' then
    v_rule := p_request->'rule';
    v_def := jsonb_build_object('version',1,'base',v_rule);
    perform public.crm_validate_schedule(v_def);
    if v_rule->>'frequency' = 'legacy' then raise exception 'Choose a current cadence' using errcode = '22023'; end if;
    for r in select * from public.agreement_schedule_revisions where agreement_id = a.id
      and starts_on <= v_through and (ends_before is null or ends_before > greatest(starts_on,v_from))
      order by starts_on
    loop
      v_begin := greatest(r.starts_on,v_from);
      v_segments := v_segments || jsonb_build_object('starts_on',v_begin,
        'ends_before',least(r.ends_before,v_through + 1),'definition',v_def,
        'items_template',r.items_template,'visit_time',r.visit_time,'service_label_id',r.service_label_id);
      if r.ends_before is null or r.ends_before > v_through + 1 then
        v_segments := v_segments || jsonb_build_object('starts_on',v_through + 1,'ends_before',r.ends_before,
          'definition',r.definition,'items_template',r.items_template,'visit_time',r.visit_time,'service_label_id',r.service_label_id);
      end if;
    end loop;
  elsif v_mode = 'resume' then
    v_reset := coalesce(a.paused_on,v_from);
    if a.schedule_review_reason is not null and exists(select 1 from public.bookings
      where agreement_id = a.id and status in ('confirmed','completed')
        and coalesce(confirmed_date,(completed_at at time zone 'America/Chicago')::date) >= v_from) then
      raise exception 'Choose a restart date after the saved visits' using errcode = '22023';
    end if;
    if a.paused_on is not null and a.schedule_review_reason is null then
      for r in select * from public.agreement_schedule_revisions where agreement_id = a.id
        and (ends_before is null or ends_before > greatest(starts_on,v_from)) order by starts_on
      loop
        v_segments := v_segments || jsonb_build_object('starts_on',greatest(r.starts_on,v_from),'ends_before',r.ends_before,
          'definition',r.definition,'items_template',r.items_template,'visit_time',r.visit_time,'service_label_id',r.service_label_id);
      end loop;
    end if;
    if jsonb_array_length(v_segments) = 0 then
      v_def := coalesce(v_def,public.crm_legacy_schedule(v_from,a.interval_unit,a.interval_count));
      if v_def->'base'->>'frequency' = 'legacy' and a.schedule_review_reason is not null then
        v_def := public.crm_legacy_schedule(v_from,a.interval_unit,a.interval_count);
      end if;
      v_segments := jsonb_build_array(jsonb_build_object('starts_on',v_from,'ends_before',null,
        'definition',v_def,'items_template',v_items,'visit_time',v_time,'service_label_id',v_label));
    end if;
  end if;

  -- Every row in this preview carries its saved version, including retained
  -- money or annotation. Any intervening change therefore invalidates commit.
  with segments as (
    select * from jsonb_to_recordset(v_segments) as s(starts_on date,ends_before date,definition jsonb,
      items_template jsonb,visit_time text,service_label_id uuid)
  ), affected as (
    select b.*,s.items_template as new_items,s.visit_time as new_time,s.service_label_id as new_label,
      case when s.starts_on is null then false
        else exists(select 1 from public.crm_schedule_dates(s.definition,b.occurrence_on,b.occurrence_on)) end as has_slot,
      (b.status = 'completed' or b.amount_charged is not null or b.payment_link is not null
        or exists(select 1 from public.job_payments p where p.booking_id = b.id)) as has_money_or_history
    from public.bookings b left join segments s on b.occurrence_on >= s.starts_on
      and (s.ends_before is null or b.occurrence_on < s.ends_before)
      and (v_end is null or b.occurrence_on <= v_end)
    where b.agreement_id = a.id
      and case when v_mode in ('pause','end') then b.status in ('pending','confirmed')
        and coalesce(b.confirmed_date,b.preferred_date,b.occurrence_on,v_from) >= v_from
      else b.occurrence_on >= v_from and (v_through is null or b.occurrence_on <= v_through)
        and (b.status in ('confirmed','completed') or (b.status = 'canceled'
          and (b.schedule_state = 'superseded' or b.schedule_cancellation in ('pause','range')))) end
  ), changes as (
    select b.*,case
      when v_mode in ('pause','end') then case when has_money_or_history then 'conflict' else 'cancel' end
      when has_money_or_history or b.id = a.schedule_source_booking_id or
        (b.status = 'confirmed' and b.confirmed_date < v_today) then 'keep'
      when b.status = 'canceled' then case when has_slot
        and (not date_override or b.confirmed_date >= v_from) then 'restore' else 'leave_canceled' end
      when has_slot then 'update'
      when v_mode = 'range' and v_rule->>'frequency' = 'paused' and not date_override then 'cancel'
      when date_override or time_override or price_override or retain_visit then
        case when coalesce((p_request->>'keep_unmatched')::boolean,false) or
          (v_mode = 'range' and v_rule->>'frequency' = 'paused' and date_override) then 'extra' else 'conflict' end
      else 'cancel' end as change
    from affected b
  )
  select coalesce(jsonb_agg(jsonb_build_object('booking_id',id,'slot',occurrence_on,
    'on',case when change = 'restore' and not date_override then occurrence_on else coalesce(confirmed_date,preferred_date,occurrence_on) end,
    'version',updated_at,'action',change,'old_price',job_total,
    'price',case when change in ('update','restore') and not price_override then public.crm_validate_items(new_items) else job_total end,
    'arrival',case when change in ('update','restore') and not time_override then new_time else confirmed_time end)
    order by coalesce(confirmed_date,preferred_date,occurrence_on),id),'[]')
    into v_changes from changes where change <> 'leave_canceled';

  select coalesce(jsonb_agg(c),'[]') into v_conflicts from jsonb_array_elements(v_changes) c where c->>'action' = 'conflict';
  if v_limit >= v_from and v_mode not in ('pause','end') then
    with proposed as (
      select d as day,s.items_template,s.visit_time
      from jsonb_to_recordset(v_segments) as s(starts_on date,ends_before date,definition jsonb,
        items_template jsonb,visit_time text)
      cross join lateral public.crm_schedule_dates(s.definition,greatest(s.starts_on,v_from),least(s.ends_before - 1,v_limit)) d
      where greatest(s.starts_on,v_from) <= least(s.ends_before - 1,v_limit)
    )
    select coalesce(jsonb_agg(jsonb_build_object('on',coalesce(c->>'on',p.day::text),
      'price',coalesce((c->>'price')::numeric,public.crm_validate_items(p.items_template)),
      'arrival',public.crm_service_arrival(case when c is null then p.visit_time else c->>'arrival' end,
        coalesce((c->>'on')::date,p.day))) order by p.day),'[]')
    into v_dates from proposed p
    left join public.bookings b on b.agreement_id = a.id and b.occurrence_on = p.day
    left join lateral (select value as c from jsonb_array_elements(v_changes) where (value->>'booking_id')::uuid = b.id) saved on true
    where b.id is null or b.status in ('confirmed','completed') or c->>'action' = 'restore';
  end if;

  -- Include moved dates outside the preview year. A regular slot cannot
  -- silently duplicate a retained saved visit on its actual date.
  with final_saved as (
    select b.id,b.occurrence_on,coalesce((c->>'on')::date,b.confirmed_date) as actual_on
    from public.bookings b
    left join lateral (select value as c from jsonb_array_elements(v_changes) where (value->>'booking_id')::uuid = b.id) change on true
    where b.agreement_id = a.id and (b.status in ('confirmed','completed') or c->>'action' = 'restore')
      and coalesce(c->>'action','keep') <> 'cancel'
  ), candidates as (
    select * from jsonb_to_recordset(v_segments) as s(starts_on date,ends_before date,definition jsonb)
  )
  select min(f.actual_on) into v_collision from final_saved f
    where f.actual_on >= v_from and (v_end is null or f.actual_on <= v_end)
      and (exists(select 1 from final_saved other where other.id <> f.id and other.actual_on = f.actual_on)
      or (f.actual_on is distinct from f.occurrence_on
        and not exists(select 1 from public.bookings b where b.agreement_id = a.id and b.occurrence_on = f.actual_on
          and b.schedule_state is distinct from 'superseded' and b.schedule_cancellation is null)
        and exists(select 1 from candidates s where f.actual_on >= s.starts_on
          and (s.ends_before is null or f.actual_on < s.ends_before)
          and exists(select 1 from public.crm_schedule_dates(s.definition,f.actual_on,f.actual_on)))));
  if v_collision is not null then
    v_conflicts := v_conflicts || jsonb_build_object('on',v_collision,'action','collision');
  end if;

  v_result := jsonb_build_object('changes',v_changes,'dates',v_dates,'conflicts',v_conflicts);
  v_token := md5(jsonb_build_array(v_today,a.updated_at,v_request,v_segments,l.updated_at,v_result)::text);
  if p_operation_id is null then return v_result || jsonb_build_object('preview',v_token); end if;
  if p_preview is distinct from v_token then
    raise exception 'Schedule preview changed. Review it again before saving.' using errcode = 'PT409';
  end if;
  if jsonb_array_length(v_conflicts) > 0 then
    raise exception 'Resolve the visits listed in the preview before saving' using errcode = '23514';
  end if;
  if v_mode in ('pause','end') then
    select coalesce(jsonb_agg((c->>'booking_id')::uuid order by (c->>'booking_id')::uuid),'[]')
      into v_future from jsonb_array_elements(v_changes) c;
    v_result := public.crm_agreement_command(a.id,a.updated_at,gen_random_uuid(),v_mode,
      jsonb_build_object('future_job_ids',v_future));
  else
    if v_mode = 'range' and jsonb_array_length(v_segments) = 0 then
      raise exception 'There is no active schedule in those dates' using errcode = '22023';
    end if;
    if a.schedule_source_booking_id is null or not exists(select 1 from public.bookings
      where id = a.schedule_source_booking_id and agreement_id = a.id
        and customer_id = a.customer_id and property_id = a.property_id and status <> 'pending') then
      raise exception 'Review the linked source visit before restarting this schedule' using errcode = '23514';
    end if;
    update public.agreement_schedule_revisions
      set ends_before = greatest(starts_on,least(v_reset,case when v_mode = 'future' then a.end_on + 1 end))
      where agreement_id = a.id and (ends_before is null or ends_before > greatest(starts_on,v_reset))
        and (v_mode <> 'range' or starts_on <= v_through);
    for v_segment in select * from jsonb_to_recordset(v_segments) as s(starts_on date,ends_before date,
      definition jsonb,items_template jsonb,visit_time text,service_label_id uuid) order by starts_on
    loop
      insert into public.agreement_schedule_revisions(agreement_id,starts_on,ends_before,definition,items_template,
        visit_time,service_label_id,staff_user_id,operation_id)
      values(a.id,v_segment.starts_on,v_segment.ends_before,v_segment.definition,v_segment.items_template,
        v_segment.visit_time,v_segment.service_label_id,p_staff_user_id,p_operation_id);
    end loop;
    v_unit := case v_def->'base'->>'frequency' when 'monthly' then 'month'
      when 'weekly' then 'week' when 'biweekly' then 'week' else a.interval_unit end;
    v_count := case v_def->'base'->>'frequency' when 'weekly' then 1 when 'monthly' then 1
      when 'biweekly' then 2 else a.interval_count end;
    v_total := public.crm_validate_items(v_items);
    update public.recurring_agreements set end_on = v_end,items_template = v_items,price_per_visit = v_total,
      service_label_id = v_label,interval_unit = case when v_mode = 'future' then v_unit else interval_unit end,
      interval_count = case when v_mode = 'future' then v_count else interval_count end,
      status = 'active',paused_on = null,schedule_review_reason = null,
      generation_starts_on = least(generation_starts_on,v_from),
      generated_through = least(generated_through,v_from - 1)
      where id = a.id;

    for v_row in select * from jsonb_to_recordset(v_changes) as c(booking_id uuid,slot date,action text)
      where action in ('update','restore','cancel','extra')
    loop
      if v_row.action = 'cancel' then
        update public.bookings set status = 'canceled',schedule_state = 'superseded',
          schedule_cancellation = case when v_mode = 'range' then 'range' else 'rule' end,
          lifecycle_note = case when v_mode = 'range' then 'Skipped by reviewed date range' else 'Removed by reviewed schedule change' end
          where id = v_row.booking_id;
      elsif v_row.action = 'extra' then
        update public.bookings set date_override = true,retain_visit = true,schedule_state = 'exception',
          lifecycle_note = 'Kept as an individual visit after schedule change' where id = v_row.booking_id;
      else
        select revision_id into v_id from public.crm_schedule_slots(a.id,v_row.slot,v_row.slot);
        if v_row.action = 'restore' then
          perform public.crm_materialize_schedule_visit(a.id,v_id,v_row.slot);
        else
          select b.*,prior.items_template as old_items,rev.items_template as new_items,
            rev.visit_time as new_time,rev.service_label_id as new_label
            into v_affected from public.bookings b join public.agreement_schedule_revisions rev on rev.id = v_id
            left join public.agreement_schedule_revisions prior on prior.id = b.schedule_revision_id
            where b.id = v_row.booking_id;
          if not v_affected.price_override and v_affected.old_items is distinct from v_affected.new_items then
            perform public.crm_replace_job_items(v_affected.id,v_affected.updated_at,gen_random_uuid(),v_affected.new_items);
          end if;
          update public.bookings set schedule_revision_id = v_id,service_label_id = v_affected.new_label,
            confirmed_time = case when v_affected.time_override then confirmed_time else v_affected.new_time end,
            price_override = v_affected.price_override,schedule_state = v_affected.schedule_state,
            first_visit_price = case when not v_affected.price_override then price_per_visit else first_visit_price end
            where id = v_affected.id;
        end if;
      end if;
    end loop;
    perform public.crm_reconcile_schedule(a.id,v_today);
    v_result := jsonb_build_object('agreement_id',a.id,'status','active');
  end if;
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'service_edit',a.id,v_request,v_result);
  return v_result || '{"duplicate":false}'::jsonb;
end $$;

revoke all on function public.crm_save_service_label(uuid,timestamptz,text,boolean,uuid,uuid),
  public.crm_service_arrival(text,date),public.crm_service_create(uuid,jsonb,uuid,uuid,text),
  public.crm_service_edit(uuid,timestamptz,jsonb,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_save_service_label(uuid,timestamptz,text,boolean,uuid,uuid),
  public.crm_service_arrival(text,date),public.crm_service_create(uuid,jsonb,uuid,uuid,text),
  public.crm_service_edit(uuid,timestamptz,jsonb,uuid,uuid,text) to service_role;

-- Uniform series moves retain the reviewed ordinal mapping. Opening a
-- projected visit or previewing its move does not save the visit.
create function public.crm_review_schedule_shift(p_agreement_id uuid,p_request jsonb,p_staff_user_id uuid,
  p_operation_id uuid default null,p_preview text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; b public.bookings; r public.agreement_schedule_revisions;
  v_saved_id uuid := (p_request->>'booking_id')::uuid;
  v_revision uuid := (p_request->>'revision_id')::uuid;
  v_slot date := (p_request->>'on')::date;
  v_date date := (p_request->>'date')::date;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_actual date; v_time text; v_definition jsonb; v_price numeric; v_result jsonb; v_token text;
  v_changes jsonb := '[]'; v_dates jsonb := '[]'; v_conflicts jsonb := '[]';
  v_request jsonb := jsonb_build_object('edit',p_request,'staff_user_id',p_staff_user_id);
begin
  if p_operation_id is not null then
    v_result := public.crm_operation_reply(p_operation_id,'reviewed_schedule_shift',p_agreement_id,v_request);
    if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  end if;
  if p_staff_user_id is null or v_date is null then
    raise exception 'Choose the new visit date' using errcode = '22023';
  end if;
  select * into a from public.recurring_agreements where id = p_agreement_id for update;
  if not found or a.status <> 'active' or a.schedule_review_reason is not null then
    raise exception 'Open an active service schedule before moving its visits' using errcode = 'PT409';
  end if;
  perform 1 from public.bookings where agreement_id = a.id order by id for update;
  if v_saved_id is not null then
    select * into b from public.bookings where id = v_saved_id and agreement_id = a.id;
    if not found or b.updated_at is distinct from (p_request->>'version')::timestamptz or b.status <> 'confirmed' then
      raise exception 'Visit changed since it was opened' using errcode = 'PT409';
    end if;
    v_slot := b.occurrence_on;
  else
    if v_revision is null or v_slot is null or not exists(select 1 from public.crm_schedule_slots(a.id,v_slot,v_slot)
      where revision_id = v_revision) then
      raise exception 'Schedule changed; reopen the calendar' using errcode = 'PT409';
    end if;
    select * into b from public.bookings where agreement_id = a.id and occurrence_on = v_slot;
    if found and (b.status <> 'confirmed' or b.schedule_state is distinct from 'generated'
      or b.schedule_revision_id is distinct from v_revision or b.confirmed_date is distinct from v_slot) then
      raise exception 'Visit changed since it was opened' using errcode = 'PT409';
    end if;
  end if;
  v_actual := coalesce(b.confirmed_date,v_slot);
  v_time := public.crm_service_arrival(p_request->>'time',v_date);
  select rev.* into r from public.agreement_schedule_revisions rev where rev.agreement_id = a.id
    and (rev.ends_before is null or rev.ends_before > rev.starts_on)
    order by (rev.starts_on <= v_slot and (rev.ends_before is null or rev.ends_before > v_slot)) desc,rev.starts_on desc limit 1;
  v_price := coalesce(b.job_total,b.first_visit_price,b.price_per_visit,public.crm_validate_items(r.items_template));
  if v_date = v_actual then
    select coalesce(jsonb_agg(jsonb_build_object('booking_id',v.id,'old_on',v.confirmed_date,'on',v.confirmed_date,
      'version',v.updated_at,'action','update','old_price',v.job_total,'price',v.job_total,'arrival',v_time)
      order by v.confirmed_date,v.id),'[]') into v_changes
    from public.bookings v where v.agreement_id = a.id and v.status = 'confirmed'
      and (v.id = b.id or (v.occurrence_on >= greatest(v_slot,v_today) and not v.time_override))
      and v.amount_charged is null and v.payment_link is null
      and not exists(select 1 from public.job_payments p where p.booking_id = v.id);
    if b.id is not null and not exists(select 1 from jsonb_array_elements(v_changes) v where (v->>'booking_id')::uuid = b.id) then
      raise exception 'Review this visit’s payment before changing its arrival' using errcode = '23514';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('on',c.service_on,'price',c.job_total,
      'arrival',public.crm_service_arrival(v_time,c.service_on)) order by c.service_on),'[]')
      into v_dates from public.crm_calendar_entries(greatest(v_slot,v_today),greatest(v_slot,v_today) + 90) c
      where c.agreement_id = a.id and c.booking_id is null;
  else
    v_definition := public.crm_shift_schedule_definition(a.id,v_slot,v_date);
    with moves as (
      select m.*,v.confirmed_date,coalesce(v.status,'confirmed') as status,v.updated_at,v.job_total,v.confirmed_time,
        case when m.booking_id is not distinct from b.id or not v.date_override then m.target else v.confirmed_date end as new_on,
        (coalesce(v.status = 'completed',false) or v.amount_charged is not null or v.payment_link is not null
          or exists(select 1 from public.job_payments p where p.booking_id = v.id)) as locked
      from public.crm_shift_schedule_rows(a.id,b.id,v_slot,v_date,v_today,v_definition) m
      left join public.bookings v on v.id = m.booking_id
    ), findings as (
      select m.*,m.locked or (a.end_on is not null and m.target > a.end_on)
        or exists(select 1 from public.bookings keep where keep.agreement_id = a.id
          and not exists(select 1 from moves changing where changing.booking_id = keep.id)
          and (keep.occurrence_on = m.target or (keep.confirmed_date = m.new_on and keep.status in ('confirmed','completed'))))
        or exists(select 1 from moves other where other.booking_id is distinct from m.booking_id
          and other.new_on = m.new_on and other.status in ('confirmed','completed')) as blocked
      from moves m
    )
    select coalesce(jsonb_agg(jsonb_build_object('booking_id',booking_id,'old_on',coalesce(confirmed_date,v_actual),
      'on',new_on,'version',updated_at,'action',case when blocked then 'conflict'
        when status in ('skipped','canceled') then 'tombstone'
        when confirmed_date = new_on then 'keep' else 'move' end,
      'old_price',coalesce(job_total,v_price),'price',coalesce(job_total,v_price),
      'arrival',public.crm_service_arrival(case when booking_id is not distinct from b.id then v_time else confirmed_time end,new_on))
      order by slot),'[]') into v_changes from findings;
    select coalesce(jsonb_agg(c),'[]') into v_conflicts from jsonb_array_elements(v_changes) c where c->>'action' = 'conflict';
    -- A retained individual move can collide with an unmaterialized slot beyond the preview window.
    v_conflicts := v_conflicts || coalesce((
      with moves as materialized (select * from public.crm_shift_schedule_rows(a.id,b.id,v_slot,v_date,v_today,v_definition))
      select jsonb_agg(jsonb_build_object('booking_id',v.id,'on',v.confirmed_date,'action','collision') order by v.confirmed_date,v.id)
      from public.bookings v left join moves moving on moving.booking_id = v.id
      where v.agreement_id = a.id and v.id is distinct from b.id and v.status in ('confirmed','completed')
        and v.confirmed_date >= greatest(v_today,least(v_slot,v_date))
        and (a.end_on is null or v.confirmed_date <= a.end_on)
        and ((moving.target is null and v.confirmed_date <> v.occurrence_on)
          or (moving.target is not null and v.date_override and v.confirmed_date <> moving.target))
        and exists(select 1 from public.crm_schedule_dates(v_definition,v.confirmed_date,v.confirmed_date))
        and not exists(select 1 from moves m where m.target = v.confirmed_date)
        and not exists(select 1 from public.bookings keep where keep.agreement_id = a.id
          and keep.occurrence_on = v.confirmed_date and keep.schedule_state is distinct from 'superseded'
          and not exists(select 1 from moves m where m.booking_id = keep.id))
    ),'[]');
    select coalesce(jsonb_agg(jsonb_build_object('on',d,'price',a.price_per_visit,
      'arrival',public.crm_service_arrival(case when r.id is null then v_time else r.visit_time end,d)) order by d),'[]')
      into v_dates from public.crm_schedule_dates(v_definition,v_date,greatest(v_date,least(v_date + 90,a.end_on))) d
      where not exists(select 1 from jsonb_array_elements(v_changes) c where (c->>'on')::date = d);
  end if;
  v_result := jsonb_build_object('changes',v_changes,'dates',v_dates,'conflicts',v_conflicts,
    'first_on',v_date,'first_price',v_price,'first_arrival',v_time);
  v_token := md5(jsonb_build_array(v_today,a.updated_at,v_request,v_definition,r.id,v_result)::text);
  if p_operation_id is null then return v_result || jsonb_build_object('preview',v_token); end if;
  if p_preview is distinct from v_token then
    raise exception 'Schedule preview changed. Review it again before saving.' using errcode = 'PT409';
  end if;
  if jsonb_array_length(v_conflicts) > 0 then
    raise exception 'Resolve the visits listed in the preview before saving' using errcode = '23514';
  end if;
  if b.id is null then
    v_saved_id := public.crm_materialize_schedule_visit(a.id,v_revision,v_slot);
    select * into b from public.bookings where id = v_saved_id;
  end if;
  v_result := public.crm_apply_schedule_shift(b.id,b.updated_at,gen_random_uuid(),v_date,v_time,p_staff_user_id,p_operation_id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'reviewed_schedule_shift',a.id,v_request,v_result);
  return v_result;
end $$;

revoke all on function public.crm_review_schedule_shift(uuid,jsonb,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_review_schedule_shift(uuid,jsonb,uuid,uuid,text) to service_role;
