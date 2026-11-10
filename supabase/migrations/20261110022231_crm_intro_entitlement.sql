-- Each accepted promotion keeps its exact first-visit items. The allocation is
-- operational, while the accepted snapshot and any financial history stay fixed.
alter table public.bookings add column intro_parked_price jsonb;

create table public.crm_intro_grants (
  source_booking_id uuid primary key references public.bookings(id),
  customer_id uuid not null unique references public.customers(id),
  first_items jsonb not null,
  allocated_booking_id uuid not null unique references public.bookings(id),
  standard_items jsonb not null,
  standard_price_override boolean not null,
  consumed_on date
);
alter table public.crm_intro_grants enable row level security;
revoke all on public.crm_intro_grants from public,anon,authenticated;
grant select,insert,update on public.crm_intro_grants to service_role;
alter table public.recurring_agreements add column intro_source_booking_id uuid references public.crm_intro_grants(source_booking_id);
create index recurring_agreements_intro_source_idx on public.recurring_agreements(intro_source_booking_id)
  where intro_source_booking_id is not null;

create function public.crm_intro_customer_eligible(p_customer_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select not exists(select 1 from public.crm_intro_grants where customer_id = p_customer_id)
    and not exists(select 1 from public.bookings b
      left join public.service_labels l on l.id = b.service_label_id
      where b.customer_id = p_customer_id and b.status = 'completed' and (
        l.semantic_key = 'mowing' or b.accepted_quote_snapshot->>'mowing' = 'true'
        or (l.id is null and exists(select 1 from public.intake_events i where i.booking_id = b.id and i.source = 'website-booking'))
      ));
$$;

create function public.crm_register_intro(p_booking_id uuid,p_first jsonb,p_standard jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare b public.bookings;
begin
  if not exists(select 1 from jsonb_to_recordset(p_first) as i(kind text,description text,amount numeric)
    where i.kind = 'discount' and i.amount < 0
      and i.description in ('Introductory mowing discount','First visit 30% off')) then return; end if;
  select * into b from public.bookings where id = p_booking_id;
  perform 1 from public.customers where id = b.customer_id for update;
  if not public.crm_intro_customer_eligible(b.customer_id) then return; end if;
  insert into public.crm_intro_grants(source_booking_id,customer_id,first_items,allocated_booking_id,
    standard_items,standard_price_override)
    values(b.id,b.customer_id,p_first,b.id,p_standard,b.price_override);
  update public.bookings set price_override = true where id = b.id and not price_override;
end $$;

create function public.crm_intro_for_visit(p_booking_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select g.source_booking_id from public.bookings b
  join public.crm_intro_grants g on g.customer_id = b.customer_id
  join public.bookings s on s.id = g.source_booking_id
  where b.id = p_booking_id and (
    b.id = s.id or b.agreement_id = s.agreement_id
    or exists(select 1 from public.recurring_agreements a where a.id = b.agreement_id and a.intro_source_booking_id = g.source_booking_id)
  );
$$;

create function public.crm_intro_fixed_price(p_booking_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.bookings
    where id = p_booking_id and (status = 'completed' or payment_link is not null or amount_charged is not null))
    or exists(select 1 from public.job_payments where booking_id = p_booking_id);
$$;

create function public.crm_intro_reprice(p_booking_id uuid,p_items jsonb,p_price_override boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.status is distinct from 'confirmed' or public.crm_intro_fixed_price(b.id) then
    raise exception 'Review the payment or payment link before changing this price.' using errcode = '23514';
  end if;
  perform public.crm_replace_job_items(b.id,b.updated_at,gen_random_uuid(),p_items);
  update public.bookings set price_per_visit = b.price_per_visit,price_override = p_price_override,
    schedule_state = case when agreement_id is not null
      and not (p_price_override or date_override or time_override or retain_visit) then 'generated' else schedule_state end,
    intro_parked_price = null where id = b.id;
end $$;

create function public.crm_intro_move(p_source uuid,p_target uuid,p_reviewed boolean default false)
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

create function public.crm_intro_sync(p_agreement_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; b public.bookings; v_target uuid;
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
  if g.consumed_on is not null or not exists(select 1 from public.bookings where id = g.allocated_booking_id
    and agreement_id = p_agreement_id and status in ('skipped','canceled')) then return; end if;
  select id into v_target from public.bookings
    where agreement_id = p_agreement_id and status = 'confirmed'
    order by confirmed_date,id limit 1;
  if v_target is not null then perform public.crm_intro_move(g.source_booking_id,v_target); end if;
end $$;

create or replace function public.crm_reconcile_schedule(p_agreement_id uuid,
  p_today date default (now() at time zone 'America/Chicago')::date)
returns date language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; v_from date; v_through date; v_slot record; v_next date; v_conflict date;
begin
  if p_today is null then raise exception 'Choose a reconciliation date' using errcode = '22023'; end if;
  select * into a from public.recurring_agreements where id = p_agreement_id for update;
  if not found or a.status <> 'active' or a.generation_starts_on is null then return null; end if;
  if a.schedule_review_reason is not null then return a.generated_through; end if;
  v_from := coalesce(a.generated_through + 1,a.generation_starts_on);
  v_through := least(p_today + 90,a.end_on,v_from + 365);
  if v_from <= v_through then
    v_conflict := public.crm_schedule_first_move_conflict(a.id,v_from,v_through);
    if v_conflict is not null then
      update public.recurring_agreements set schedule_review_reason = format(
        'A saved visit overlaps the regular visit on %s. Review the dates before restarting.',v_conflict)
        where id = a.id;
      return a.generated_through;
    end if;
    for v_slot in
      select s.* from public.crm_schedule_slots(a.id,v_from,v_through) s
      where not exists(select 1 from public.bookings b where b.agreement_id = a.id
        and b.occurrence_on = s.cadence_on and b.schedule_state is distinct from 'superseded'
          and b.schedule_cancellation is distinct from 'pause'
          and b.schedule_cancellation is distinct from 'range')
      order by s.cadence_on
    loop
      perform public.crm_materialize_schedule_visit(a.id,v_slot.revision_id,v_slot.cadence_on);
    end loop;
  end if;
  select min(confirmed_date) into v_next from public.bookings
    where agreement_id = a.id and status = 'confirmed' and confirmed_date >= p_today;
  update public.recurring_agreements set
    generated_through = case when v_from <= v_through then v_through else a.generated_through end,
    next_on = coalesce(v_next,a.next_on)
  where id = a.id and (v_from <= v_through or next_on is distinct from coalesce(v_next,a.next_on));
  perform public.crm_intro_sync(a.id);
  return greatest(a.generated_through,case when v_from <= v_through then v_through end);
end $$;

-- Runs under the agreement/grant locks held by complete_job. A money review is
-- an aborted command so a projected visit and its receipt also roll back.
create function public.crm_intro_before_complete(p_source uuid,p_booking_id uuid,p_completed_on date,p_review text)
returns void language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; b public.bookings; allocated public.bookings; source public.bookings;
  v_earlier uuid; v_message text; v_token text; v_intro numeric; v_move boolean := false;
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
    select e.id into v_earlier from public.bookings e where e.id <> b.id and e.customer_id = g.customer_id
      and e.property_id = b.property_id and e.status = 'confirmed' and e.confirmed_date < p_completed_on
      and (e.id = source.id or e.agreement_id = source.agreement_id or exists(select 1 from public.recurring_agreements a
        where a.id = e.agreement_id and a.intro_source_booking_id = g.source_booking_id))
      order by e.confirmed_date,e.id limit 1;
    if v_earlier is not null then
      raise exception 'Resolve the earlier scheduled mow first. Record its completion if it happened, or skip it if it did not.'
        using errcode = 'PT422', detail = jsonb_build_object('earlierVisitId',v_earlier)::text;
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

create function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_completed_on date,p_intro_review text) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_agreement_id uuid; v_next_id uuid;
  v_result jsonb; v_request jsonb; v_intro uuid;
begin
  if p_completed_on is null then raise exception 'Completion date required' using errcode = '22023'; end if;
  v_request := jsonb_strip_nulls(jsonb_build_object('completed_on',p_completed_on,'intro_review',p_intro_review));
  v_result := public.crm_operation_reply(p_operation_id,'complete_job',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select agreement_id into v_agreement_id from public.bookings where id = p_booking_id;
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


create or replace function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_completed_on date) returns jsonb language sql security invoker
  set search_path = '' as $$
  select public.complete_job(p_booking_id,p_expected_updated_at,p_operation_id,p_completed_on,null);
$$;

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
      v_result := public.crm_job_command(b.id,b.updated_at,v_child_operation,p_action,p_payload);
  end case;
  v_result := v_result || jsonb_build_object('booking_id',b.id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'visit_occurrence',p_agreement_id,v_request,v_result);
  return v_result;
end $$;
revoke all on function public.crm_intro_customer_eligible(uuid),public.crm_register_intro(uuid,jsonb,jsonb),
  public.crm_intro_for_visit(uuid),public.crm_intro_fixed_price(uuid),public.crm_intro_reprice(uuid,jsonb,boolean),
  public.crm_intro_move(uuid,uuid,boolean),
  public.crm_intro_sync(uuid),public.crm_intro_before_complete(uuid,uuid,date,text),
  public.complete_job(uuid,timestamptz,uuid,date,text) from public,anon,authenticated;
grant execute on function public.crm_intro_customer_eligible(uuid),public.crm_register_intro(uuid,jsonb,jsonb),
  public.crm_intro_for_visit(uuid),public.crm_intro_fixed_price(uuid),public.crm_intro_reprice(uuid,jsonb,boolean),
  public.crm_intro_move(uuid,uuid,boolean),
  public.crm_intro_sync(uuid),public.crm_intro_before_complete(uuid,uuid,date,text),
  public.complete_job(uuid,timestamptz,uuid,date,text) to service_role;

-- Only saved, unused work can carry a promotion into a separately priced
-- series, and staff must deliberately choose this source in the service editor.
create function public.crm_intro_continuation(p_customer_id uuid)
returns table (source_id uuid,property_id uuid,allocated_id uuid,allocated_on date,amount numeric)
language sql stable security invoker set search_path = '' as $$
  select g.source_booking_id,b.property_id,b.id,b.confirmed_date,public.crm_validate_items(g.first_items)
  from public.crm_intro_grants g
  join public.bookings b on b.id = g.allocated_booking_id
  left join public.recurring_agreements a on a.id = b.agreement_id
  where g.customer_id = p_customer_id and g.consumed_on is null
    and b.property_id is not null and b.status in ('canceled','skipped')
    and (b.agreement_id is null or a.status = 'ended');
$$;

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
  update public.bookings set service_label_id = l.id where id = v_source and service_label_id is null;
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
revoke all on function public.crm_intro_continuation(uuid) from public,anon,authenticated;
grant execute on function public.crm_intro_continuation(uuid) to service_role;

-- Compose the existing schedule review with any affected introductory amounts.
-- The base plan remains responsible for the cadence, visit eligibility and edits.
alter function public.crm_service_edit(uuid,timestamptz,jsonb,uuid,uuid,text) rename to crm_service_edit_base;

create function public.crm_service_edit(p_agreement_id uuid,p_expected_updated_at timestamptz,
  p_request jsonb,p_staff_user_id uuid,p_operation_id uuid default null,p_preview text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; held public.bookings; target record; v_source uuid;
  v_result jsonb; v_base_token text; v_token text; v_changes jsonb; v_dates jsonb;
  v_price numeric;
  v_through date := (p_request->>'through')::date;
  v_mode text := p_request->>'mode'; v_today date := (now() at time zone 'America/Chicago')::date;
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

    if g.consumed_on is null and held.agreement_id = p_agreement_id
      and (held.status in ('skipped','canceled') or exists(select 1 from jsonb_array_elements(v_changes) c
        where (c->>'booking_id')::uuid = held.id and c->>'action' = 'cancel'))
      and not exists(select 1 from jsonb_array_elements(v_changes) c
        where (c->>'booking_id')::uuid = held.id and c->>'action' = 'restore') then
      with affected as (
        select * from jsonb_to_recordset(v_changes) as c(booking_id uuid,action text,"on" date,price numeric)
      ), candidates as (
        select b.id,coalesce(c."on",b.confirmed_date) as service_on,coalesce(c.price,b.job_total) as price,
          b.price_override and not coalesce(c.action = 'restore' and b.intro_parked_price is not null
            and not public.crm_intro_fixed_price(b.id),false) as override_price,b.updated_at
        from public.bookings b left join affected c on c.booking_id = b.id
        where b.agreement_id = p_agreement_id and (b.status = 'confirmed' or c.action = 'restore')
          and coalesce(c.action,'keep') <> 'cancel'
        union all
        select null,(d->>'on')::date,(d->>'price')::numeric,false,null
        from jsonb_array_elements(v_result->'dates') d
        where (d->>'on')::date <= v_today + 90
          and not exists(select 1 from public.bookings b where b.agreement_id = p_agreement_id
            and (b.occurrence_on = (d->>'on')::date or b.confirmed_date = (d->>'on')::date))
        union all
        select null,s.cadence_on,public.crm_validate_items(r.items_template),false,null
        from public.crm_schedule_slots(p_agreement_id,v_through + 1,v_today + 90) s
        join public.agreement_schedule_revisions r on r.id = s.revision_id
        where v_mode = 'range' and v_through < v_today + 90
          and not exists(select 1 from public.bookings b where b.agreement_id = p_agreement_id
            and b.occurrence_on = s.cadence_on)
      )
      select * into target from candidates order by service_on,id nulls last limit 1;
      if target.service_on is not null then
        if target.override_price or public.crm_intro_fixed_price(held.id)
          or public.crm_intro_fixed_price(target.id) or not public.crm_visit_items_match(held.id,g.first_items) then
          v_result := v_result || jsonb_build_object('intro_transfer',jsonb_build_object('needs_review',true));
        else
          v_price := public.crm_validate_items(g.first_items);
          v_result := v_result || jsonb_build_object('intro_transfer',jsonb_build_object(
            'to_on',target.service_on,'standard_price',target.price,'intro_price',v_price));
          if target.id is not null and not exists(select 1 from jsonb_array_elements(v_changes) c
            where (c->>'booking_id')::uuid = target.id) then
            v_changes := v_changes || jsonb_build_object('booking_id',target.id,'on',target.service_on,'action','update',
              'price',v_price,'old_price',target.price);
          elsif target.id is not null then
            select jsonb_agg(case when (c->>'booking_id')::uuid = target.id
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
    v_token := md5(jsonb_build_array(v_result,held.updated_at,g.consumed_on)::text);
  end if;
  if p_operation_id is null then return v_result || jsonb_build_object('preview',v_token); end if;
  if p_preview is distinct from v_token then
    raise exception 'Schedule preview changed. Review it again before saving.' using errcode = 'PT409';
  end if;
  return public.crm_service_edit_base(p_agreement_id,p_expected_updated_at,p_request,p_staff_user_id,p_operation_id,v_base_token);
end $$;

revoke all on function public.crm_service_edit(uuid,timestamptz,jsonb,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_service_edit(uuid,timestamptz,jsonb,uuid,uuid,text) to service_role;
