create table public.service_labels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 120),
  semantic_key text unique check (semantic_key is null or semantic_key = 'mowing'),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index service_labels_active_name_idx on public.service_labels(lower(name)) where retired_at is null;
alter table public.service_labels enable row level security;
revoke all on public.service_labels from public,anon,authenticated;
grant select,insert,update on public.service_labels to service_role;
insert into public.service_labels(name,semantic_key) values ('Lawn care','mowing'),('Leaf cleanup',null);

alter table public.recurring_agreements
  add column service_label_id uuid references public.service_labels(id),
  add column paused_on date;
alter table public.agreement_schedule_revisions
  add column service_label_id uuid references public.service_labels(id),
  add column staff_user_id uuid,
  add column operation_id uuid;
alter table public.bookings
  add column service_label_id uuid references public.service_labels(id),
  add column date_override boolean not null default false,
  add column time_override boolean not null default false,
  add column price_override boolean not null default false,
  add column retain_visit boolean not null default false,
  add column schedule_cancellation text check (schedule_cancellation in ('pause','range','end','rule'));
create index agreements_service_label_idx on public.recurring_agreements(service_label_id) where service_label_id is not null;
create index revisions_service_label_idx on public.agreement_schedule_revisions(service_label_id) where service_label_id is not null;
create index bookings_service_label_idx on public.bookings(service_label_id) where service_label_id is not null;

-- Identify only the old canonical mowing template. Other existing work keeps its saved description.
update public.recurring_agreements a set service_label_id = l.id
  from public.service_labels l where l.semantic_key = 'mowing'
  and exists(select 1 from jsonb_array_elements(a.items_template) i
    where i->>'kind' = 'service' and lower(btrim(i->>'description')) in ('lawn care','mowing plan visit'))
  and not exists(select 1 from jsonb_array_elements(a.items_template) i
    where i->>'kind' = 'service' and lower(btrim(i->>'description')) not in ('lawn care','mowing plan visit'));
update public.agreement_schedule_revisions r set service_label_id = a.service_label_id
  from public.recurring_agreements a where a.id = r.agreement_id and a.service_label_id is not null;
update public.bookings b set service_label_id = a.service_label_id
  from public.recurring_agreements a where a.id = b.agreement_id and a.service_label_id is not null
  and b.schedule_state = 'generated';

-- An older generic exception does not establish which field staff intended to keep.
update public.bookings set date_override = true,time_override = true,price_override = true,retain_visit = true
  where agreement_id is not null and schedule_state is distinct from 'generated'
    and schedule_state is distinct from 'superseded';
update public.bookings set schedule_cancellation = case lifecycle_note
    when 'Canceled on agreement pause' then 'pause' else 'end' end
  where agreement_id is not null and status = 'canceled'
    and lifecycle_note in ('Canceled on agreement pause','Canceled on agreement end');

create or replace function public.crm_protect_schedule_visit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.original_occurrence_on is not null and new.original_occurrence_on is distinct from old.original_occurrence_on then
    raise exception 'Original visit date is immutable' using errcode = '23514';
  end if;
  if old.agreement_id is null or new.agreement_id is distinct from old.agreement_id
    or new.schedule_revision_id is distinct from old.schedule_revision_id then return new; end if;

  if (new.notes,new.name,new.phone,new.email,new.address,new.customer_id,new.property_id)
      is distinct from (old.notes,old.name,old.phone,old.email,old.address,old.customer_id,old.property_id) then
    new.retain_visit := true;
  end if;
  if new.schedule_state = 'generated' and (new.date_override or new.time_override or new.price_override
    or new.retain_visit or new.status is distinct from old.status or new.payment_link is distinct from old.payment_link) then
    new.schedule_state := 'exception';
  end if;
  return new;
end $$;

create or replace function public.crm_protect_schedule_item_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.bookings set schedule_state = 'exception',price_override = true
    where id = new.target_id and agreement_id is not null;
  return new;
end $$;

create or replace function public.crm_write_schedule_revision(p_agreement_id uuid,p_from date,p_definition jsonb,
  p_items jsonb,p_time text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from public.recurring_agreements where id = p_agreement_id for update;
  update public.agreement_schedule_revisions set ends_before = greatest(starts_on,p_from)
    where agreement_id = p_agreement_id and (ends_before is null or ends_before > p_from);
  insert into public.agreement_schedule_revisions(agreement_id,starts_on,definition,items_template,visit_time,service_label_id)
    select p_agreement_id,p_from,p_definition,p_items,p_time,service_label_id
    from public.recurring_agreements where id = p_agreement_id returning id into v_id;
  update public.recurring_agreements set generated_through =
    least(generated_through,greatest(generation_starts_on,p_from) - 1)
    where id = p_agreement_id and generation_starts_on is not null;
  return v_id;
end $$;

create or replace function public.crm_materialize_schedule_visit(p_agreement_id uuid,p_revision_id uuid,p_on date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; b public.bookings; r public.agreement_schedule_revisions;
  v_id uuid; v_total numeric;
begin
  select * into a from public.recurring_agreements where id = p_agreement_id for update;
  if not found or a.status <> 'active' or a.schedule_review_reason is not null or not exists(
    select 1 from public.crm_schedule_slots(p_agreement_id,p_on,p_on) s where s.revision_id = p_revision_id
  ) then
    raise exception 'Schedule changed; reopen the calendar' using errcode = 'PT409';
  end if;
  -- Validate the requested revision before looking up the current occupant of the slot.
  select * into b from public.bookings where agreement_id = a.id and occurrence_on = p_on for update;
  if found and ((b.id = a.schedule_source_booking_id and b.schedule_cancellation = 'range')
    or (b.schedule_state is distinct from 'superseded'
      and b.schedule_cancellation is distinct from 'pause'
      and b.schedule_cancellation is distinct from 'range')) then return b.id; end if;
  if public.crm_schedule_has_actual_visit(a.id,
    case when b.date_override then b.confirmed_date else p_on end,b.id) then
    raise exception 'This plan already has a visit on that date. Review the schedule.' using errcode = 'PT409';
  end if;
  if b.id is not null then
    select * into r from public.agreement_schedule_revisions where id = p_revision_id;
    if (b.date_override and (b.confirmed_date is null or
        (b.schedule_cancellation = 'pause' and b.confirmed_date < r.starts_on)))
      or b.amount_charged is not null or b.payment_link is not null
      or exists(select 1 from public.job_payments where booking_id = b.id) then
      return b.id;
    end if;
    update public.bookings set status = 'confirmed',
      schedule_state = case when date_override or time_override or price_override or retain_visit then 'exception' else 'generated' end,
      schedule_revision_id = p_revision_id,
      confirmed_date = case when date_override then confirmed_date else p_on end,
      preferred_date = case when date_override then preferred_date else p_on end,
      confirmed_time = case when time_override then confirmed_time else r.visit_time end,
      schedule_cancellation = null,lifecycle_note = 'Schedule visit restored'
    where id = b.id;
    if not b.price_override and (
      b.job_total is distinct from public.crm_validate_items(r.items_template)
      or (select items_template from public.agreement_schedule_revisions where id = b.schedule_revision_id)
        is distinct from r.items_template) then
      perform public.crm_replace_job_items(b.id,(select updated_at from public.bookings where id = b.id),
        gen_random_uuid(),r.items_template);
      update public.bookings set price_override = false,
        schedule_state = case when date_override or time_override or retain_visit then 'exception' else 'generated' end
        where id = b.id;
    end if;
    return b.id;
  end if;

  select * into b from public.bookings where id = a.schedule_source_booking_id;
  if not found or b.status = 'pending' or b.agreement_id is distinct from a.id
    or b.customer_id is distinct from a.customer_id or b.property_id is distinct from a.property_id then
    raise exception 'Review the schedule source visit and property' using errcode = '23514';
  end if;
  select * into r from public.agreement_schedule_revisions where id = p_revision_id;
  v_total := public.crm_validate_items(r.items_template);
  insert into public.bookings(name,phone,email,address,customer_id,property_id,agreement_id,
    occurrence_on,original_occurrence_on,schedule_revision_id,schedule_state,service_label_id,
    confirmed_date,preferred_date,confirmed_time,preferred_time,status,job_total,price_per_visit,first_visit_price,
    frequency,one_time,manual_quote,notify_failed,accepted_quote_snapshot,attribution,lead_id,
    gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,gbraid,wbraid,
    google_campaign_id,google_adgroup_id,google_ad_id,sq_ft,map_screenshot_url,last_mow,customer_notes)
  values(b.name,b.phone,b.email,b.address,a.customer_id,a.property_id,a.id,
    p_on,p_on,r.id,'generated',coalesce(r.service_label_id,a.service_label_id),
    p_on,p_on,r.visit_time,b.preferred_time,'confirmed',v_total,
    case when v_total = trunc(v_total) and v_total <= 2147483647 then v_total::integer end,
    case when v_total = trunc(v_total) and v_total <= 2147483647 then v_total::integer end,
    b.frequency,false,false,false,
    jsonb_build_object('agreement_id',a.id,'items',r.items_template,'total',v_total,'currency','USD'),
    b.attribution,b.lead_id,b.gclid,b.utm_source,b.utm_medium,b.utm_campaign,b.utm_term,b.utm_content,
    b.gbraid,b.wbraid,b.google_campaign_id,b.google_adgroup_id,b.google_ad_id,b.sq_ft,
    b.map_screenshot_url,b.last_mow,b.customer_notes)
  returning id into v_id;
  insert into public.job_items(booking_id,kind,description,amount)
    select v_id,item->>'kind',item->>'description',(item->>'amount')::numeric
    from jsonb_array_elements(r.items_template) item;
  return v_id;
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
  return greatest(a.generated_through,case when v_from <= v_through then v_through end);
end $$;

-- A direct series move is reserved for a uniform weekly cadence or the
-- original legacy interval. Complex rules go through the full schedule editor.
create function public.crm_shift_schedule_definition(p_agreement_id uuid,p_slot date,p_date date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare a public.recurring_agreements; r public.agreement_schedule_revisions; v_rule jsonb;
begin
  select * into a from public.recurring_agreements where id = p_agreement_id;
  select * into r from public.agreement_schedule_revisions
    where agreement_id = a.id and (ends_before is null or ends_before > greatest(starts_on,p_slot))
    order by starts_on limit 1;
  v_rule := r.definition->'base';
  if exists(select 1 from public.agreement_schedule_revisions rev
    where rev.agreement_id = a.id
      and (rev.ends_before is null or rev.ends_before > greatest(rev.starts_on,least(p_slot,p_date)))
      and ((rev.definition->'base') is distinct from v_rule
        or rev.items_template is distinct from r.items_template
        or rev.visit_time is distinct from r.visit_time
        or rev.definition->'base'->>'frequency' not in ('legacy','weekly','biweekly')
        or jsonb_array_length(coalesce(rev.definition->'annual','[]')) > 0
        or jsonb_array_length(coalesce(rev.definition->'excluded_on','[]')) > 0
        or exists(select 1 from jsonb_array_elements(coalesce(rev.definition->'temporary','[]')) period
          where (period->>'end')::date - (period->>'start')::date > 1
            or period->'rule'->>'frequency' <> 'weekly'))) then
    raise exception 'Use Edit schedule to preview changes to this service’s future dates' using errcode = '23514';
  end if;
  if v_rule->>'frequency' in ('weekly','biweekly') then
    return jsonb_build_object('version',1,'base',v_rule || jsonb_build_object('anchor_on',p_date));
  end if;
  return public.crm_legacy_schedule(p_date,coalesce(v_rule->>'unit',a.interval_unit),
    coalesce((v_rule->>'count')::integer,a.interval_count));
end $$;

create function public.crm_shift_schedule_rows(p_agreement_id uuid,p_booking_id uuid,p_slot date,
  p_date date,p_today date,p_definition jsonb)
returns table(booking_id uuid,slot date,target date) language sql stable security invoker set search_path = '' as $$
  with future_slots as (
    select s.cadence_on,row_number() over (order by s.cadence_on)::integer as ordinal
    from generate_series(0,(
      select (max(v.occurrence_on) - p_slot - 1) / 366
      from public.bookings v where v.agreement_id = p_agreement_id and v.occurrence_on > p_slot
        and v.schedule_state is distinct from 'superseded'
    )) as chunk
    cross join lateral public.crm_schedule_slots(p_agreement_id,
      p_slot + 1 + 366 * chunk,p_slot + 366 + 366 * chunk) s
  ), moving as (
    select p_booking_id as id,p_slot as occurrence_on,0 as ordinal
    union all
    select v.id,v.occurrence_on,s.ordinal from future_slots s join public.bookings v
      on v.agreement_id = p_agreement_id and v.occurrence_on = s.cadence_on
    where v.occurrence_on >= p_today and v.schedule_state is distinct from 'superseded' and v.status <> 'declined'
  )
  select m.id,m.occurrence_on,case when p_definition->'base'->>'unit' = 'month'
    then (p_date + make_interval(months => (p_definition->'base'->>'count')::integer * m.ordinal))::date
    else p_date + 7 * m.ordinal * case p_definition->'base'->>'frequency'
      when 'biweekly' then 2 when 'weekly' then 1 else (p_definition->'base'->>'count')::integer end end
  from moving m order by m.occurrence_on;
$$;

create function public.crm_apply_schedule_shift(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_date date,p_time text,p_staff_user_id uuid,p_schedule_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; b public.bookings; r public.agreement_schedule_revisions;
  v_agreement_id uuid; v_result jsonb; v_ids uuid[]; v_slots date[]; v_target date; v_rev uuid; v_from date;
  v_row record; v_delta integer; v_definition jsonb; v_request jsonb := jsonb_build_object('date',p_date,'time',p_time);
  v_today date := (now() at time zone 'America/Chicago')::date; v_time text := nullif(p_time,'');
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
  if p_date = coalesce(b.confirmed_date,b.preferred_date) then
    if b.status = 'pending' then
      perform public.crm_job_command(b.id,b.updated_at,gen_random_uuid(),'confirm',v_request);
    end if;
    -- Keep each future rule segment and the worker cursor. Only the window changes.
    for r in select * from public.agreement_schedule_revisions rev
      where rev.agreement_id = a.id and rev.visit_time is distinct from v_time
        and (rev.ends_before is null or rev.ends_before > greatest(rev.starts_on,b.occurrence_on,v_today))
      order by rev.starts_on
    loop
      v_from := greatest(r.starts_on,b.occurrence_on,v_today);
      update public.agreement_schedule_revisions set ends_before = v_from where id = r.id;
      insert into public.agreement_schedule_revisions(agreement_id,starts_on,ends_before,definition,items_template,visit_time,service_label_id,staff_user_id,operation_id)
        values(a.id,v_from,r.ends_before,r.definition,r.items_template,v_time,r.service_label_id,p_staff_user_id,p_schedule_operation_id) returning id into v_rev;
      update public.bookings v set confirmed_time = v_time,schedule_revision_id = v_rev
        where v.agreement_id = a.id and not v.time_override and v.status = 'confirmed'
          and v.occurrence_on >= v_from and (r.ends_before is null or v.occurrence_on < r.ends_before)
          and v.amount_charged is null and v.payment_link is null
          and not exists(select 1 from public.job_payments p where p.booking_id = v.id);
    end loop;
    update public.bookings set confirmed_time = v_time
      where id = b.id and confirmed_time is distinct from v_time;
    -- Keep agreement-version checks current for other staff operations.
    if v_rev is not null then
      update public.recurring_agreements set updated_at = now() where id = a.id;
    end if;
    v_result := jsonb_build_object('booking_id',b.id,'agreement_id',a.id,'shift_days',0);
    insert into public.crm_operations(id,action,target_id,request,result)
      values(p_operation_id,'shift_agreement',p_booking_id,v_request,v_result);
    return v_result || '{"duplicate":false}'::jsonb;
  end if;
  v_definition := public.crm_shift_schedule_definition(a.id,b.occurrence_on,p_date);
  v_delta := p_date - b.occurrence_on;
  v_from := least(p_date,b.occurrence_on);
  select array_agg(m.booking_id order by m.slot),array_agg(m.target order by m.slot)
    into v_ids,v_slots from public.crm_shift_schedule_rows(a.id,b.id,b.occurrence_on,p_date,v_today,v_definition) m;
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
      where (moving.id = b.id or not moving.date_override)
        and (not (kept.id = any(v_ids))
          or (kept.id <> b.id and kept.date_override))
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
    v_definition,a.items_template,
    case when r.id is null then nullif(p_time,'') else r.visit_time end);
  update public.agreement_schedule_revisions set staff_user_id = p_staff_user_id,operation_id = p_schedule_operation_id
    where id = v_rev;
  for v_row in select m.id,m.target,(v.id = b.id or not v.date_override) as move_actual
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
      retain_visit = retain_visit or schedule_state is null,
      price_override = price_override or schedule_state is null,
      confirmed_time = case when id = b.id then nullif(p_time,'') else confirmed_time end,
      lifecycle_note = case when v_row.move_actual then 'Plan moved' else lifecycle_note end
      where id = v_row.id;
  end loop;
  if public.crm_schedule_first_move_conflict(a.id,v_from) is not null then
    raise exception 'The plan already has a protected visit on a regular date. Review the schedule.' using errcode = '23514';
  end if;
  update public.recurring_agreements set anchor_on = p_date,next_on = p_date where id = a.id;
  perform public.crm_reconcile_schedule(a.id,v_today);
  v_result := jsonb_build_object('booking_id',b.id,'agreement_id',a.id,'shift_days',v_delta);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'shift_agreement',p_booking_id,v_request,v_result);
  return v_result || '{"duplicate":false}'::jsonb;
end $$;

create or replace function public.crm_shift_agreement(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_date date,p_time text)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.crm_apply_schedule_shift(p_booking_id,p_expected_updated_at,p_operation_id,p_date,p_time,null,null);
$$;

revoke all on function public.crm_shift_schedule_definition(uuid,date,date),
  public.crm_shift_schedule_rows(uuid,uuid,date,date,date,jsonb),
  public.crm_apply_schedule_shift(uuid,timestamptz,uuid,date,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_shift_schedule_definition(uuid,date,date),
  public.crm_shift_schedule_rows(uuid,uuid,date,date,date,jsonb),
  public.crm_apply_schedule_shift(uuid,timestamptz,uuid,date,text,uuid,uuid) to service_role;


create or replace function public.crm_agreement_command(p_agreement_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql
  security invoker set search_path = '' as $$
declare v_agreement public.recurring_agreements; v_result jsonb; v_future jsonb;
  v_next date; v_source uuid; v_new uuid; v_total numeric; v_revision uuid; v_visit record;
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
      perform 1 from public.bookings where agreement_id = p_agreement_id and not price_override
        and status = 'confirmed' and confirmed_date >= v_today order by id for update;
      for v_visit in
        select b.id,b.updated_at,b.schedule_state from public.bookings b
        where b.agreement_id = p_agreement_id and not b.price_override
          and b.id is distinct from v_agreement.schedule_source_booking_id and b.status = 'confirmed'
          and b.occurrence_on >= v_next and b.confirmed_date >= v_today
          and b.amount_charged is null and b.payment_link is null
          and not exists(select 1 from public.job_payments p where p.booking_id = b.id)
        order by b.id
      loop
        -- Reuse the checked line-item command. Keep these visits schedule-owned.
        perform public.crm_replace_job_items(v_visit.id,v_visit.updated_at,gen_random_uuid(),p_payload->'items_template');
        update public.bookings set schedule_revision_id = v_revision,schedule_state = v_visit.schedule_state,price_override = false,
          first_visit_price = price_per_visit where id = v_visit.id;
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
      if p_action = 'end' then
        update public.agreement_schedule_revisions set ends_before = greatest(starts_on,v_today)
          where agreement_id = p_agreement_id and (ends_before is null or ends_before > v_today);
      end if;
    end if;
    update public.recurring_agreements set status = case when p_action = 'pause'
      then 'paused' else 'ended' end,
      paused_on = case when p_action = 'pause' then coalesce(paused_on,v_today) end,
      schedule_review_reason = case when p_action = 'pause' then schedule_review_reason end
      where id = p_agreement_id;
    update public.bookings set status = 'canceled',
      schedule_state = case when schedule_state = 'generated' then 'superseded' else schedule_state end,
      schedule_cancellation = p_action,
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
    update public.agreement_schedule_revisions set ends_before = greatest(starts_on,v_agreement.paused_on)
      where agreement_id = p_agreement_id and v_agreement.paused_on is not null
        and (ends_before is null or ends_before > v_agreement.paused_on);
    update public.recurring_agreements set status = 'active',anchor_on = v_next,next_on = v_next,
      schedule_review_reason = null,paused_on = null,
      schedule_source_booking_id = v_source,generation_starts_on = least(generation_starts_on,v_next),
      generated_through = v_next - 1 where id = p_agreement_id;
    select * into r from public.agreement_schedule_revisions where agreement_id = p_agreement_id
      order by created_at desc,starts_on desc limit 1;
    perform public.crm_write_schedule_revision(p_agreement_id,v_next,
      case when r.id is not null and (r.definition->'base'->>'frequency' <> 'legacy'
        or jsonb_array_length(coalesce(r.definition->'annual','[]')) > 0
        or jsonb_array_length(coalesce(r.definition->'excluded_on','[]')) > 0
        or jsonb_array_length(coalesce(r.definition->'temporary','[]')) > 0)
        and v_agreement.schedule_review_reason is null then r.definition
        else public.crm_legacy_schedule(v_next,v_agreement.interval_unit,v_agreement.interval_count) end,
      v_agreement.items_template,coalesce(r.visit_time,(select confirmed_time from public.bookings where id = v_source)));
    -- An explicitly resumed date may reuse a legacy visit canceled only by a plan pause.
    update public.bookings set schedule_state = 'superseded',
      original_occurrence_on = coalesce(original_occurrence_on,occurrence_on)
      where agreement_id = p_agreement_id and occurrence_on = v_next and schedule_state is null
        and status = 'canceled' and lifecycle_note = 'Canceled on agreement pause'
        and amount_charged is null and payment_link is null
        and not exists(select 1 from public.job_payments p where p.booking_id = bookings.id);
    if exists(select 1 from public.bookings b where b.agreement_id = p_agreement_id and b.occurrence_on = v_next
      and b.status in ('canceled','skipped') and b.schedule_state is distinct from 'superseded'
      and b.schedule_cancellation is distinct from 'pause') then
      raise exception 'An individually canceled or skipped visit occupies this date' using errcode = '23505';
    end if;
    if public.crm_schedule_first_move_conflict(p_agreement_id,v_next) is not null then
      raise exception 'The plan already has a protected visit on a regular date. Review the schedule.' using errcode = '23514';
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
  if v_booking.service_label_id is not null and v_agreement.service_label_id is not null
    and v_booking.service_label_id <> v_agreement.service_label_id then
    raise exception 'Choose a schedule for the same service' using errcode = '23514';
  end if;
  v_on := coalesce(v_booking.confirmed_date,v_booking.preferred_date);
  if v_on is null then raise exception 'Set the visit date first' using errcode = '22023'; end if;
  if public.crm_schedule_has_actual_visit(p_agreement_id,v_on)
    or exists(select 1 from public.bookings where agreement_id = p_agreement_id and occurrence_on = v_on) then
    raise exception 'The plan already has a visit on that date' using errcode = '23514';
  end if;
  update public.bookings set agreement_id = p_agreement_id,occurrence_on = v_on,original_occurrence_on = v_on,
    schedule_state = 'exception',one_time = false,
    service_label_id = coalesce(service_label_id,v_agreement.service_label_id),
    retain_visit = true,price_override = true,time_override = true,
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
  v_result := jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next,
    'status',case when p_action in ('confirm','reschedule') then 'confirmed' else
      case when p_action = 'skip' then 'skipped'
        when p_action = 'mark_one_time' then v_booking.status else 'canceled' end end);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'job_' || p_action,p_booking_id,p_payload,v_result);
  return v_result;
end $$;
