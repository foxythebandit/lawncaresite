-- An extra keeps its independent booking and price. Its explicit provenance
-- lets completion review account for earlier work in the same service.
alter table public.bookings add column extra_for_agreement_id uuid references public.recurring_agreements(id);
create index bookings_extra_agreement_date_idx on public.bookings(extra_for_agreement_id,confirmed_date)
  where extra_for_agreement_id is not null;
update public.bookings b set extra_for_agreement_id = a.id
from public.crm_operations o
join public.recurring_agreements a on a.id::text = o.request#>>'{edit,related_agreement_id}'
where o.action = 'service_create' and b.id::text = o.result->>'booking_id'
  and b.customer_id = a.customer_id and b.property_id = a.property_id and b.agreement_id is null;

create or replace function public.crm_intro_for_visit(p_booking_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select g.source_booking_id from public.bookings b
  join public.crm_intro_grants g on g.customer_id = b.customer_id
  join public.bookings s on s.id = g.source_booking_id
  where b.id = p_booking_id and (
    b.id = s.id or coalesce(b.agreement_id,b.extra_for_agreement_id) = s.agreement_id
    or exists(select 1 from public.recurring_agreements a
      where a.id = coalesce(b.agreement_id,b.extra_for_agreement_id) and a.intro_source_booking_id = g.source_booking_id)
  );
$$;

-- Search existing revisions only as far as needed for the requested candidate.
-- Each rule expansion is bounded and returns as soon as it finds the first
-- open slot. Nothing here advances the generation cursor or inserts a visit.
create function public.crm_schedule_first_projected_slot(p_agreement_id uuid,p_from date,p_through date)
returns table (revision_id uuid,service_on date,items jsonb)
language plpgsql stable security invoker set search_path = '' as $$
declare r record; v_start date; v_on date;
begin
  if p_through is null then return; end if;
  for r in
    select rev.id,rev.definition,rev.items_template,
      greatest(p_from,a.generation_starts_on,rev.starts_on) as first_on,
      least(p_through,a.end_on,rev.ends_before - 1) as last_on
    from public.agreement_schedule_revisions rev
    join public.recurring_agreements a on a.id = rev.agreement_id
    where a.id = p_agreement_id and a.status = 'active' and a.generation_starts_on is not null
      and a.schedule_review_reason is null
      and greatest(p_from,a.generation_starts_on,rev.starts_on) <= least(p_through,a.end_on,rev.ends_before - 1)
    order by rev.starts_on
  loop
    v_start := r.first_on;
    while v_start <= r.last_on loop
      select min(d) into v_on
      from public.crm_schedule_dates(r.definition,v_start,least(r.last_on,v_start + 365)) d
      where not public.crm_schedule_has_actual_visit(p_agreement_id,d)
        and not exists(select 1 from public.bookings b where b.agreement_id = p_agreement_id and b.occurrence_on = d
          and (b.schedule_state is distinct from 'superseded' or public.crm_intro_fixed_price(b.id)));
      if v_on is not null then
        return query select r.id,v_on,r.items_template;
        return;
      end if;
      v_start := v_start + 366;
    end loop;
  end loop;
end $$;

-- Read the next saved or projected date without advancing the worker. One
-- year covers the editor's normal seasonal lookahead. A saved date is valid
-- even if it lies past that lookahead.
create function public.crm_schedule_next_dates(p_agreement_ids uuid[],p_today date)
returns table(agreement_id uuid,next_on date)
language sql stable security invoker set search_path = '' as $$
  select a.id,least(saved.visit_on,projected.service_on)
  from public.recurring_agreements a
  left join lateral (
    select min(b.confirmed_date) as visit_on from public.bookings b
    where b.agreement_id = a.id and b.status = 'confirmed' and b.confirmed_date >= p_today
  ) saved on true
  left join lateral public.crm_schedule_first_projected_slot(a.id,p_today,least(p_today + 365,saved.visit_on)) projected on true
  where a.id = any(p_agreement_ids) and a.status = 'active' and a.generation_starts_on is not null
    and a.schedule_review_reason is null and p_today is not null;
$$;

-- Saved bookings and a proposed/read-only set of virtual slots share one
-- ordering and one set of allocation guards.
create function public.crm_intro_target(p_agreement_id uuid,p_virtual jsonb,p_changes jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare g public.crm_intro_grants; held public.bookings; target record;
begin
  select i.* into g from public.crm_intro_grants i
    join public.recurring_agreements a on a.id = p_agreement_id
    where i.source_booking_id = public.crm_intro_for_visit(a.schedule_source_booking_id);
  if not found or g.consumed_on is not null then return null; end if;
  select * into held from public.bookings where id = g.allocated_booking_id;
  if held.agreement_id is distinct from p_agreement_id
    or not (held.status in ('canceled','skipped') or exists(select 1 from jsonb_array_elements(p_changes) c
      where c->>'booking_id' = held.id::text and c->>'action' = 'cancel'))
    or exists(select 1 from jsonb_array_elements(p_changes) c
      where c->>'booking_id' = held.id::text and c->>'action' = 'restore') then return null; end if;
  with affected as (
    select * from jsonb_to_recordset(p_changes) as c(booking_id uuid,action text,"on" date,price numeric)
  ), candidates as (
    select b.id,coalesce(c."on",b.confirmed_date) as service_on,coalesce(c.price,b.job_total) as price,
      b.extra_for_agreement_id is not null as is_extra,
      b.price_override and not coalesce(c.action = 'restore' and b.intro_parked_price is not null
        and not public.crm_intro_fixed_price(b.id),false) as override_price,b.updated_at,b.schedule_revision_id as revision_id
    from public.bookings b left join affected c on c.booking_id = b.id
    where (b.agreement_id = p_agreement_id or b.extra_for_agreement_id = p_agreement_id)
      and (b.status = 'confirmed' or c.action = 'restore') and coalesce(c.action,'keep') <> 'cancel'
    union all
    select null,v."on",v.price,false,false,null,v.revision_id
    from jsonb_to_recordset(p_virtual) as v("on" date,price numeric,revision_id uuid)
    where not exists(select 1 from public.bookings b where b.agreement_id = p_agreement_id
      and (b.occurrence_on = v."on" or (b.confirmed_date = v."on" and b.status in ('confirmed','completed')))
      and (b.schedule_state is distinct from 'superseded' or public.crm_intro_fixed_price(b.id)
        or exists(select 1 from affected c where c.booking_id = b.id and c.action = 'restore')))
  )
  select * into target from candidates where service_on is not null
    order by service_on,is_extra desc,id nulls last limit 1;
  if not found then return null; end if;
  return jsonb_build_object('booking_id',target.id,'on',target.service_on,'revision_id',target.revision_id,
    'standard_price',target.price,'target_version',target.updated_at,'source_id',g.source_booking_id,
    'held_version',held.updated_at,'intro_items',g.first_items,
    'needs_review',target.is_extra or target.override_price or public.crm_intro_fixed_price(held.id)
      or public.crm_intro_fixed_price(target.id) or not public.crm_visit_items_match(held.id,g.first_items));
end $$;

create function public.crm_intro_current_target(p_agreement_id uuid,p_through date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare g public.crm_intro_grants; held public.bookings; v_virtual jsonb;
begin
  select i.* into g from public.crm_intro_grants i
    join public.recurring_agreements a on a.id = p_agreement_id
    where i.source_booking_id = public.crm_intro_for_visit(a.schedule_source_booking_id);
  if not found or g.consumed_on is not null then return null; end if;
  select * into held from public.bookings where id = g.allocated_booking_id;
  if held.agreement_id is distinct from p_agreement_id or held.status not in ('canceled','skipped') then return null; end if;
  select jsonb_build_array(jsonb_build_object('on',service_on,'price',public.crm_validate_items(items),'revision_id',revision_id))
    into v_virtual from public.crm_schedule_first_projected_slot(p_agreement_id,null,p_through);
  return public.crm_intro_target(p_agreement_id,coalesce(v_virtual,'[]'::jsonb),'[]'::jsonb);
end $$;

create function public.crm_intro_extra_matches(p_booking_id uuid,p_items jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select array_agg(description order by description) from public.job_items
    where booking_id = p_booking_id and kind = 'service')
  is not distinct from (select array_agg(description order by description)
    from jsonb_to_recordset(p_items) as i(kind text,description text) where kind = 'service');
$$;

create or replace function public.crm_intro_move(p_source uuid,p_target uuid,p_reviewed boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; old public.bookings; target public.bookings; v_standard jsonb;
begin
  select * into g from public.crm_intro_grants where source_booking_id = p_source for update;
  if not found or g.consumed_on is not null then return false; end if;
  if g.allocated_booking_id = p_target then return true; end if;
  select * into old from public.bookings where id = g.allocated_booking_id for update;
  select * into target from public.bookings where id = p_target for update;
  if target.status is distinct from 'confirmed' or target.customer_id is distinct from g.customer_id
    or target.property_id is distinct from old.property_id
    or public.crm_intro_for_visit(target.id) is distinct from p_source
    or (target.extra_for_agreement_id is not null and (not p_reviewed or not public.crm_intro_extra_matches(target.id,g.first_items)))
    or (not p_reviewed and target.price_override)
    or public.crm_intro_fixed_price(old.id) or public.crm_intro_fixed_price(target.id)
    or not public.crm_visit_items_match(old.id,g.first_items) then return false; end if;
  select jsonb_agg(jsonb_build_object('kind',kind,'description',description,'amount',amount::text) order by created_at,id)
    into v_standard from public.job_items where booking_id = target.id;
  if v_standard is null then return false; end if;

  -- A canceled occurrence keeps its recorded amount. If a temporary pause
  -- later restores it, the schedule reconciler reapplies the saved standard price.
  if old.status in ('canceled','skipped') then
    update public.bookings set intro_parked_price = jsonb_build_object(
      'items',g.standard_items,'price_override',g.standard_price_override) where id = old.id;
  else
    perform public.crm_intro_reprice(old.id,g.standard_items,g.standard_price_override);
  end if;
  perform public.crm_intro_reprice(target.id,g.first_items,true);
  update public.crm_intro_grants set allocated_booking_id = target.id,standard_items = v_standard,
    standard_price_override = target.price_override where source_booking_id = g.source_booking_id;
  return true;
end $$;

create or replace function public.crm_intro_sync(p_agreement_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; b public.bookings; v_through date; v_target jsonb;
begin
  select i.* into g from public.crm_intro_grants i
    join public.bookings s on s.id = i.source_booking_id
    where p_agreement_id = s.agreement_id or exists(select 1 from public.recurring_agreements a
      where a.id = p_agreement_id and a.intro_source_booking_id = i.source_booking_id)
    for update of i;
  if not found then return; end if;
  for b in select * from public.bookings where agreement_id = p_agreement_id
    and status = 'confirmed' and intro_parked_price is not null order by id for update
  loop
    if not public.crm_intro_fixed_price(b.id) then
      perform public.crm_intro_reprice(b.id,b.intro_parked_price->'items',
        (b.intro_parked_price->>'price_override')::boolean);
    end if;
  end loop;
  select max(confirmed_date) into v_through from public.bookings
    where (agreement_id = p_agreement_id or extra_for_agreement_id = p_agreement_id) and status = 'confirmed';
  v_target := public.crm_intro_current_target(p_agreement_id,v_through);
  if v_target->>'booking_id' is not null and not (v_target->>'needs_review')::boolean then
    perform public.crm_intro_move(g.source_booking_id,(v_target->>'booking_id')::uuid);
  end if;
end $$;

create or replace function public.crm_service_create(p_customer_id uuid,p_request jsonb,p_staff_user_id uuid,
  p_operation_id uuid default null,p_preview text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.service_labels; b public.bookings; a public.recurring_agreements;
  v_property uuid := (p_request->>'property_id')::uuid;
  v_source uuid := (p_request->>'source_id')::uuid;
  v_related uuid := (p_request->>'related_agreement_id')::uuid;
  v_intro uuid := (p_request->>'intro_source_id')::uuid;
  v_intro_grant public.crm_intro_grants; v_allocated public.bookings;
  v_intro_agreement uuid;
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
      or (b.service_label_id is not null and b.service_label_id <> l.id
        and exists(select 1 from public.service_labels original where original.id = b.service_label_id and original.retired_at is null))
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
  if v_intro is not null then
    if v_source is not null or v_related is not null or v_property is null
      or v_definition is null or l.semantic_key is distinct from 'mowing' then
      raise exception 'Choose the saved property and Lawn care schedule for the unused introductory price.' using errcode = '23514';
    end if;
    select held.agreement_id into v_intro_agreement from public.crm_intro_grants i
      join public.bookings held on held.id = i.allocated_booking_id where i.source_booking_id = v_intro;
    if v_intro_agreement is not null then
      perform 1 from public.recurring_agreements where id = v_intro_agreement for update;
    end if;
    select * into v_intro_grant from public.crm_intro_grants where source_booking_id = v_intro for update;
    select * into v_allocated from public.bookings where id = v_intro_grant.allocated_booking_id for update;
    if v_allocated.agreement_id is distinct from v_intro_agreement
      or not exists(select 1 from public.crm_intro_continuation(p_customer_id) i
        where i.source_id = v_intro and i.property_id = v_property)
      or public.crm_intro_fixed_price(v_allocated.id)
      or not public.crm_visit_items_match(v_allocated.id,v_intro_grant.first_items) then
      raise exception 'The saved introductory price needs review. Check the prior visit, payment and payment link before continuing it.'
        using errcode = '23514';
    end if;
    if exists(select 1 from public.bookings e where e.customer_id = p_customer_id and e.property_id = v_property
      and e.status = 'confirmed' and public.crm_intro_for_visit(e.id) = v_intro) then
      raise exception 'Resolve the remaining booked visits in the prior service before moving its introductory price.'
        using errcode = '23514';
    end if;
  end if;
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
    'first_price',case when v_intro is not null then public.crm_validate_items(v_intro_grant.first_items)
      when b.id is null then v_total else coalesce(b.job_total,b.first_visit_price,b.price_per_visit,0) end,
    'first_arrival',case when b.id is not null then b.confirmed_time else v_time end,
    'same_day_extra',v_related is not null and (public.crm_schedule_has_actual_visit(v_related,v_first)
      or exists(select 1 from public.crm_schedule_slots(v_related,v_first,v_first))),
    'dates',v_dates,'name',l.name,'changes','[]'::jsonb,'conflicts','[]'::jsonb,
    'intro_continuation',case when v_intro is not null then jsonb_build_object(
      'from_on',v_allocated.confirmed_date,'regular_price',v_total) end);
  v_token := md5(jsonb_build_array(v_today,v_request,v_result,l.updated_at,a.updated_at,v_allocated.updated_at)::text);
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
  update public.bookings set service_label_id = coalesce(service_label_id,l.id),extra_for_agreement_id = v_related
    where id = v_source and (service_label_id is null or v_related is not null);
  if v_definition is not null then
    v_unit := case when v_frequency = 'monthly' then 'month' else 'week' end;
    v_count := case when v_frequency = 'biweekly' then 2 else 1 end;
    insert into public.recurring_agreements(customer_id,property_id,anchor_on,next_on,end_on,interval_unit,interval_count,
      price_per_visit,items_template,service_label_id,schedule_source_booking_id,generation_starts_on,generated_through,intro_source_booking_id)
      values(p_customer_id,v_property,v_first,(v_dates->0->>'on')::date,v_end,v_unit,v_count,v_total,
        v_items,l.id,v_source,v_start,v_start - 1,v_intro) returning * into a;
    update public.bookings set agreement_id = a.id,occurrence_on = v_first,original_occurrence_on = v_first,
      schedule_state = 'exception',retain_visit = true,price_override = true,one_time = false
      where id = v_source;
    v_revision := public.crm_write_schedule_revision(a.id,v_start,v_definition,v_items,v_time);
    update public.agreement_schedule_revisions set staff_user_id = p_staff_user_id,operation_id = p_operation_id
      where id = v_revision;
    if v_intro is not null and not public.crm_intro_move(v_intro,v_source,true) then
      raise exception 'The saved introductory price could not be carried. Reopen and review both visits.' using errcode = 'PT409';
    end if;
    perform public.crm_reconcile_schedule(a.id,v_today);
  end if;
  v_result := jsonb_build_object('booking_id',v_source,'agreement_id',case when v_definition is not null then a.id end,
    'property_id',v_property,'duplicate',false);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'service_create',p_customer_id,v_request,v_result);
  return v_result;
end $$;

create or replace function public.crm_service_edit(p_agreement_id uuid,p_expected_updated_at timestamptz,
  p_request jsonb,p_staff_user_id uuid,p_operation_id uuid default null,p_preview text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; held public.bookings; target jsonb; v_source uuid;
  v_result jsonb; v_base_token text; v_token text; v_changes jsonb; v_dates jsonb;
  v_price numeric; v_virtual jsonb; v_before jsonb; v_after jsonb;
  v_from date := (p_request->>'from')::date;
  v_through date := (p_request->>'through')::date;
  v_mode text := p_request->>'mode';
  v_request jsonb := jsonb_build_object('edit',p_request,'staff_user_id',p_staff_user_id);
begin
  if p_operation_id is not null then
    v_result := public.crm_operation_reply(p_operation_id,'service_edit',p_agreement_id,v_request);
    if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  end if;
  v_result := public.crm_service_edit_base(p_agreement_id,p_expected_updated_at,p_request,p_staff_user_id);
  v_base_token := v_result->>'preview';
  select schedule_source_booking_id into v_source from public.recurring_agreements where id = p_agreement_id;
  select * into g from public.crm_intro_grants
    where source_booking_id = public.crm_intro_for_visit(v_source) for update;
  v_token := v_base_token;
  if found and v_mode not in ('pause','end') and jsonb_array_length(v_result->'conflicts') = 0 then
    select * into held from public.bookings where id = g.allocated_booking_id;
    select coalesce(jsonb_agg(case when c->>'action' = 'restore' and b.intro_parked_price is not null
        and not public.crm_intro_fixed_price(b.id)
      then c || jsonb_build_object('price',public.crm_validate_items(b.intro_parked_price->'items'))
      else c end order by ord),'[]'::jsonb)
    into v_changes from jsonb_array_elements(v_result->'changes') with ordinality as change(c,ord)
    join public.bookings b on b.id = (c->>'booking_id')::uuid;

    if g.consumed_on is null and held.agreement_id = p_agreement_id then
      if v_mode in ('range','future') then
        select jsonb_build_array(jsonb_build_object('on',service_on,'price',public.crm_validate_items(items),'revision_id',revision_id))
          into v_before from public.crm_schedule_first_projected_slot(p_agreement_id,null,v_from - 1);
      end if;
      if v_mode = 'range' then
        select jsonb_build_array(jsonb_build_object('on',service_on,'price',public.crm_validate_items(items),'revision_id',revision_id))
          into v_after from public.crm_schedule_first_projected_slot(p_agreement_id,v_through + 1,v_through + 366);
      end if;
      v_virtual := coalesce(v_before,'[]'::jsonb) || (v_result->'dates') || coalesce(v_after,'[]'::jsonb);
      target := public.crm_intro_target(p_agreement_id,v_virtual,v_changes);
      if target is not null then
        if (target->>'needs_review')::boolean then
          v_result := v_result || jsonb_build_object('intro_transfer',jsonb_build_object('needs_review',true));
        else
          v_price := public.crm_validate_items(target->'intro_items');
          v_result := v_result || jsonb_build_object('intro_transfer',jsonb_build_object(
            'to_on',target->>'on','standard_price',target->'standard_price','intro_price',v_price));
          if target->>'booking_id' is not null and not exists(select 1 from jsonb_array_elements(v_changes) c
            where c->>'booking_id' = target->>'booking_id') then
            v_changes := v_changes || jsonb_build_object('booking_id',target->>'booking_id','on',target->>'on','action','update',
              'price',v_price,'old_price',target->'standard_price');
          elsif target->>'booking_id' is not null then
            select jsonb_agg(case when c->>'booking_id' = target->>'booking_id'
              then c || jsonb_build_object('price',v_price) else c end order by ord) into v_changes
              from jsonb_array_elements(v_changes) with ordinality as change(c,ord);
          end if;
        end if;
      end if;
    end if;
    select coalesce(jsonb_agg(case when (d->>'on')::date = (v_result->'intro_transfer'->>'to_on')::date
        then d || jsonb_build_object('price',v_price)
      when c is not null then d || jsonb_build_object('price',c->'price') else d end order by ord),'[]'::jsonb)
    into v_dates from jsonb_array_elements(v_result->'dates') with ordinality as date(d,ord)
    left join lateral (
      select value as c from jsonb_array_elements(v_changes) where value->>'on' = d->>'on'
        and value->>'action' = 'restore' limit 1
    ) restored on true;
    v_result := v_result || jsonb_build_object('dates',v_dates,'changes',v_changes);
    v_token := md5(jsonb_build_array(v_result,held.updated_at,g.consumed_on,target)::text);
  end if;
  if p_operation_id is null then return v_result || jsonb_build_object('preview',v_token); end if;
  if p_preview is distinct from v_token then
    raise exception 'Schedule preview changed. Review it again before saving.' using errcode = 'PT409';
  end if;
  return public.crm_service_edit_base(p_agreement_id,p_expected_updated_at,p_request,p_staff_user_id,p_operation_id,v_base_token);
end $$;

create or replace function public.crm_calendar_edit_occurrence(p_agreement_id uuid,p_revision_id uuid,p_on date,
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
  perform public.crm_intro_sync(p_agreement_id);
  select * into b from public.bookings where id = v_id for update;
  -- Reconciliation may have saved an untouched visit after this page opened.
  -- Individual edits, payments, and a replaced cadence require a fresh review.
  if b.status <> 'confirmed' or b.confirmed_date is distinct from p_on
    or (b.schedule_state is distinct from 'generated' and not (
      not (b.date_override or b.time_override or b.retain_visit) and exists(
        select 1 from public.crm_intro_grants g where g.allocated_booking_id = b.id and g.consumed_on is null
          and not g.standard_price_override and public.crm_visit_items_match(b.id,g.first_items))))
    or b.schedule_revision_id is distinct from p_revision_id
    or (p_payload ? 'expected_items' and not public.crm_visit_items_match(b.id,p_payload->'expected_items'))
    or exists(select 1 from public.job_payments p where p.booking_id = b.id) then
    raise exception 'Visit changed since it was opened' using errcode = 'PT409';
  end if;
  case p_action
    when 'notes' then
      v_result := public.crm_calendar_save_note(b.id,b.updated_at,v_child_operation,p_payload->>'note');
    when 'complete' then
      v_result := public.complete_job(b.id,b.updated_at,v_child_operation,(p_payload->>'date')::date,p_payload->>'intro_review');
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
      v_result := public.crm_job_command(b.id,b.updated_at,v_child_operation,p_action,p_payload - 'expected_items');
  end case;
  v_result := v_result || jsonb_build_object('booking_id',b.id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'visit_occurrence',p_agreement_id,v_request,v_result);
  return v_result;
end $$;

create function public.crm_intro_slot_items(p_target jsonb,p_revision_id uuid,p_on date,p_standard jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_target->>'booking_id' is null and p_target->>'revision_id' = p_revision_id::text
    and p_target->>'on' = p_on::text and not (p_target->>'needs_review')::boolean
    then p_target->'intro_items' else p_standard end;
$$;

create function public.crm_calendar_projected_items(p_agreement_id uuid,p_revision_id uuid,p_on date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_target jsonb; v_items jsonb;
begin
  select r.items_template into v_items from public.agreement_schedule_revisions r
  join public.recurring_agreements a on a.id = r.agreement_id
  where r.id = p_revision_id and r.agreement_id = p_agreement_id and a.status = 'active'
    and exists(select 1 from public.crm_schedule_slots(a.id,p_on,p_on) s where s.revision_id = r.id);
  if not found then return null; end if;
  v_target := public.crm_intro_current_target(p_agreement_id,p_on);
  v_items := public.crm_intro_slot_items(v_target,p_revision_id,p_on,v_items);
  return jsonb_build_object('items',v_items,'total',public.crm_validate_items(v_items));
end $$;

create or replace function public.crm_calendar_entries(p_from date,p_through date)
returns table(booking_id uuid,agreement_id uuid,revision_id uuid,cadence_on date,service_on date,
  visit_time text,visit_status text,customer_id uuid,property_id uuid,name text,address text,job_total numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_from is null or p_through is null or p_through - p_from not between 0 and 365 then
    raise exception 'Choose a date range of at most 366 days' using errcode = '22023';
  end if;
  return query
    with projected as materialized (
      select a.id as plan_id,s.revision_id,s.cadence_on,r.visit_time,
        a.customer_id,a.property_id,b.name,b.address,r.items_template
      from public.recurring_agreements a
      join public.bookings b on b.id = a.schedule_source_booking_id
      cross join lateral public.crm_schedule_slots(a.id,p_from,p_through) s
      join public.agreement_schedule_revisions r on r.id = s.revision_id
      where a.status = 'active' and a.schedule_review_reason is null
        and not public.crm_schedule_has_actual_visit(a.id,s.cadence_on)
        and not exists(select 1 from public.bookings v
          where v.agreement_id = a.id and v.occurrence_on = s.cadence_on
            and (v.schedule_state is distinct from 'superseded' or public.crm_intro_fixed_price(v.id)))
    ), introductory as materialized (
      select q.plan_id,public.crm_intro_current_target(q.plan_id,p_through) as target
      from (select distinct p.plan_id from projected p) q
    )
    select b.id,b.agreement_id,b.schedule_revision_id,b.occurrence_on,b.confirmed_date,
      b.confirmed_time,b.status,b.customer_id,b.property_id,b.name,b.address,b.job_total
    from public.bookings b where b.confirmed_date between p_from and p_through
      and b.status in ('confirmed','completed')
    union all
    select null::uuid,p.plan_id,p.revision_id,p.cadence_on,p.cadence_on,p.visit_time,
      'confirmed',p.customer_id,p.property_id,p.name,p.address,
      public.crm_validate_items(public.crm_intro_slot_items(i.target,p.revision_id,p.cadence_on,p.items_template))
    from projected p join introductory i on i.plan_id = p.plan_id
    order by 5,6,1,2;
end $$;

create or replace function public.crm_intro_before_complete(p_source uuid,p_booking_id uuid,p_completed_on date,p_review text)
returns void language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; b public.bookings; allocated public.bookings; source public.bookings;
  v_earlier uuid; v_earlier_on date; v_projected record; v_agreements uuid[]; v_message text; v_token text; v_intro numeric; v_move boolean := false;
begin
  if p_source is null then return; end if;
  select * into g from public.crm_intro_grants where source_booking_id = p_source;
  select * into b from public.bookings where id = p_booking_id;
  select * into allocated from public.bookings where id = g.allocated_booking_id;
  select * into source from public.bookings where id = g.source_booking_id;
  if b.intro_parked_price is not null then
    raise exception 'This restored visit still has the earlier introductory price. Review its payment link or payment before recording completion.'
      using errcode = '23514';
  end if;
  v_intro := public.crm_validate_items(g.first_items);

  if g.consumed_on is not null then
    if p_completed_on >= g.consumed_on then return; end if;
    v_message := 'This completion is earlier than the visit that used the introductory price. Review both saved amounts before recording the actual date. Both prices will stay as recorded.';
  else
    select array_agg(id) into v_agreements from public.recurring_agreements
      where id = source.agreement_id or intro_source_booking_id = g.source_booking_id;
    select e.id,e.confirmed_date into v_earlier,v_earlier_on from public.bookings e where e.id <> b.id
      and e.customer_id = g.customer_id and e.property_id = b.property_id
      and e.status = 'confirmed' and e.confirmed_date < p_completed_on
      and (e.id = source.id or coalesce(e.agreement_id,e.extra_for_agreement_id) = any(v_agreements))
      order by e.confirmed_date,e.id limit 1;
    select a.id,s.revision_id,s.service_on into v_projected
      from unnest(v_agreements) a(id)
      cross join lateral public.crm_schedule_first_projected_slot(a.id,null,least(p_completed_on - 1,v_earlier_on)) s
      order by s.service_on,a.id limit 1;
    if v_earlier is not null or v_projected.id is not null then
      raise exception 'Resolve the earlier scheduled mow first. Record its completion if it happened, or skip it if it did not.'
        using errcode = 'PT422', detail = case when v_projected.id is not null and
          (v_earlier_on is null or v_projected.service_on < v_earlier_on) then jsonb_build_object(
            'earlierOccurrence',jsonb_build_object('agreementId',v_projected.id,'revisionId',v_projected.revision_id,'on',v_projected.service_on))::text
          else jsonb_build_object('earlierVisitId',v_earlier)::text end;
    end if;
    if not public.crm_visit_items_match(allocated.id,g.first_items) then
      raise exception 'Review the saved introductory items on the visit that holds the introductory price.'
        using errcode = 'PT422', detail = jsonb_build_object('earlierVisitId',allocated.id)::text;
    end if;
    if allocated.id = b.id then
      update public.crm_intro_grants set consumed_on = p_completed_on where source_booking_id = p_source;
      return;
    end if;
    if public.crm_intro_fixed_price(allocated.id) or public.crm_intro_fixed_price(b.id) then
      raise exception 'A payment or payment link fixes one of these amounts. Review it before moving the introductory price.'
        using errcode = 'PT422', detail = jsonb_build_object('earlierVisitId',allocated.id,'allocatedAmount',allocated.job_total,
          'allocatedOn',allocated.confirmed_date,'visitAmount',b.job_total,'introAmount',v_intro)::text;
    end if;
    if b.extra_for_agreement_id is not null and not public.crm_intro_extra_matches(b.id,g.first_items) then
      raise exception 'This extra visit has different work items from the introductory offer. Review both sets of items before applying the offer.'
        using errcode = 'PT422', detail = jsonb_build_object('earlierVisitId',allocated.id,'allocatedAmount',allocated.job_total,
          'allocatedOn',allocated.confirmed_date,'visitAmount',b.job_total,'introAmount',v_intro)::text;
    end if;
    v_move := true;
    v_message := 'This will be the first completed mow. Review the saved introductory items and both visit prices before moving the offer to this visit.';
  end if;

  v_token := md5(jsonb_build_array(g.source_booking_id,g.consumed_on,allocated.id,allocated.updated_at,
    coalesce(b.agreement_id,b.id),b.occurrence_on,b.confirmed_date,b.job_total,b.schedule_revision_id,p_completed_on,
    v_intro,v_move)::text);
  if p_review is distinct from v_token then
    raise exception '%', v_message using errcode = 'PT422',
      detail = jsonb_build_object('token',v_token,'allocatedAmount',allocated.job_total,
        'allocatedOn',coalesce(g.consumed_on,allocated.confirmed_date),'visitAmount',b.job_total,
        'introAmount',v_intro,'replacementAmount',case when v_move then public.crm_validate_items(g.standard_items) end,
        'move',v_move)::text;
  end if;
  if v_move then
    if not public.crm_intro_move(p_source,b.id,true) then
      raise exception 'The introductory price could not be moved. Review the saved amounts and payment links.' using errcode = '23514';
    end if;
    update public.crm_intro_grants set consumed_on = p_completed_on where source_booking_id = p_source;
  end if;
end $$;

create or replace function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_completed_on date,p_intro_review text) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_agreement_id uuid; v_next_id uuid;
  v_result jsonb; v_request jsonb; v_intro uuid;
begin
  if p_completed_on is null then raise exception 'Completion date required' using errcode = '22023'; end if;
  v_request := jsonb_strip_nulls(jsonb_build_object('completed_on',p_completed_on,'intro_review',p_intro_review));
  v_result := public.crm_operation_reply(p_operation_id,'complete_job',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select coalesce(agreement_id,extra_for_agreement_id) into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is not null then
    perform 1 from public.recurring_agreements where id = v_agreement_id for update;
  end if;
  v_intro := public.crm_intro_for_visit(p_booking_id);
  if v_intro is not null then
    perform 1 from public.crm_intro_grants where source_booking_id = v_intro for update;
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
  perform public.crm_intro_before_complete(v_intro,p_booking_id,p_completed_on,p_intro_review);
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
  select coalesce(agreement_id,extra_for_agreement_id) into v_agreement_id from public.bookings where id = p_booking_id;
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
    if v_booking.agreement_id is not null
      and (v_booking.status = 'pending' or v_date is distinct from v_booking.confirmed_date)
      and (public.crm_schedule_has_actual_visit(v_booking.agreement_id,v_date,p_booking_id)
        or (v_date <> v_booking.occurrence_on and exists(
          select 1 from public.crm_schedule_slots(v_booking.agreement_id,v_date,v_date) s
          join public.recurring_agreements a on a.id = v_booking.agreement_id
          where a.status = 'active' and a.schedule_review_reason is null
        ) and not exists(select 1 from public.bookings existing
          where existing.agreement_id = v_booking.agreement_id and existing.occurrence_on = v_date
            and existing.schedule_state is distinct from 'superseded'))) then
      raise exception 'This plan already has a visit on that date. Choose another date.' using errcode = '23514';
    end if;
    update public.bookings set status = 'confirmed',confirmed_date = v_date,
      confirmed_time = nullif(p_payload->>'time',''),preferred_date = v_date,
      date_override = date_override or (agreement_id is not null and status = 'confirmed' and confirmed_date is distinct from v_date),
      time_override = time_override or (agreement_id is not null and status = 'confirmed' and confirmed_time is distinct from nullif(p_payload->>'time',''))
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
  if v_booking.extra_for_agreement_id is not null and p_action in ('cancel','reschedule') then
    perform public.crm_intro_sync(v_booking.extra_for_agreement_id);
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next,
    'status',case when p_action in ('confirm','reschedule') then 'confirmed' else
      case when p_action = 'skip' then 'skipped'
        when p_action = 'mark_one_time' then v_booking.status else 'canceled' end end);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'job_' || p_action,p_booking_id,p_payload,v_result);
  return v_result;
end $$;

create or replace function public.crm_calendar_attention_page(p_today date,p_kind text default null,
  p_limit integer default 25,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with gaps as (
    select a.id,a.schedule_source_booking_id,coalesce(a.generated_through + 1,a.generation_starts_on) as gap_start,
      least(p_today - 1,a.end_on) as gap_end
    from public.recurring_agreements a
    where a.status = 'active' and a.generation_starts_on is not null and a.schedule_review_reason is null
      and coalesce(a.generated_through + 1,a.generation_starts_on) <= least(p_today - 1,a.end_on)
  ), introductory as materialized (
    select g.id,public.crm_intro_current_target(g.id,least(g.gap_end,g.gap_start + 365)) as target from gaps g
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
      a.customer_id,b.name,b.address,b.phone,
      public.crm_validate_items(public.crm_intro_slot_items(i.target,s.revision_id,s.cadence_on,r.items_template)),'confirmed',null::text,null::timestamptz
    from gaps g join introductory i on i.id = g.id
    cross join lateral public.crm_schedule_slots(g.id,g.gap_start,least(g.gap_end,g.gap_start + 365)) s
    join public.recurring_agreements a on a.id = g.id
    join public.agreement_schedule_revisions r on r.id = s.revision_id
    left join public.bookings b on b.id = g.schedule_source_booking_id
    where not public.crm_schedule_has_actual_visit(g.id,s.cadence_on)
      and not exists(select 1 from public.bookings v where v.agreement_id = g.id
        and v.occurrence_on = s.cadence_on and (v.schedule_state is distinct from 'superseded' or public.crm_intro_fixed_price(v.id)))
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

revoke all on function public.crm_schedule_first_projected_slot(uuid,date,date),public.crm_schedule_next_dates(uuid[],date),public.crm_intro_target(uuid,jsonb,jsonb),
  public.crm_intro_current_target(uuid,date),public.crm_intro_extra_matches(uuid,jsonb),
  public.crm_calendar_projected_items(uuid,uuid,date),public.crm_intro_slot_items(jsonb,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.crm_schedule_first_projected_slot(uuid,date,date),public.crm_schedule_next_dates(uuid[],date),public.crm_intro_target(uuid,jsonb,jsonb),
  public.crm_intro_current_target(uuid,date),public.crm_intro_extra_matches(uuid,jsonb),
  public.crm_calendar_projected_items(uuid,uuid,date),public.crm_intro_slot_items(jsonb,uuid,date,jsonb) to service_role;
