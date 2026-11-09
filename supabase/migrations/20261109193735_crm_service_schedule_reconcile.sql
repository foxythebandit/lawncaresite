create function public.crm_schedule_slots(p_agreement_id uuid,p_from date,p_through date)
returns table(revision_id uuid,cadence_on date) language sql stable security invoker set search_path = '' as $$
  select r.id,d
  from public.agreement_schedule_revisions r
  join public.recurring_agreements a on a.id = r.agreement_id
  cross join lateral public.crm_schedule_dates(r.definition,
    greatest(p_from,r.starts_on,a.generation_starts_on),
    least(p_through,r.ends_before - 1,a.end_on)) d
  where a.id = p_agreement_id and a.generation_starts_on is not null
    and greatest(p_from,r.starts_on,a.generation_starts_on) <= least(p_through,r.ends_before - 1,a.end_on);
$$;

-- Protect a visit as soon as staff records an individual change. Schedule
-- commands mark their own transitions by changing the revision or state.
create function public.crm_protect_schedule_visit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.original_occurrence_on is not null and new.original_occurrence_on is distinct from old.original_occurrence_on then
    raise exception 'Original visit date is immutable' using errcode = '23514';
  end if;
  if old.schedule_state = 'generated' and new.schedule_state = 'generated'
    and new.schedule_revision_id is not distinct from old.schedule_revision_id
    and (new.status,new.confirmed_date,new.confirmed_time,new.notes,new.job_total,new.payment_link,
      new.name,new.phone,new.email,new.address,new.customer_id,new.property_id)
      is distinct from (old.status,old.confirmed_date,old.confirmed_time,old.notes,old.job_total,old.payment_link,
        old.name,old.phone,old.email,old.address,old.customer_id,old.property_id) then
    new.schedule_state := 'exception';
  end if;
  return new;
end $$;
create trigger crm_protect_schedule_visit before update on public.bookings
  for each row execute function public.crm_protect_schedule_visit();

create function public.crm_materialize_schedule_visit(p_agreement_id uuid,p_revision_id uuid,p_on date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; b public.bookings; r public.agreement_schedule_revisions;
  v_id uuid; v_total numeric;
begin
  select * into a from public.recurring_agreements where id = p_agreement_id for update;
  if not found or a.status <> 'active' or not exists(
    select 1 from public.crm_schedule_slots(p_agreement_id,p_on,p_on) s where s.revision_id = p_revision_id
  ) then
    raise exception 'Schedule changed; reopen the calendar' using errcode = 'PT409';
  end if;
  -- Validate the requested revision before looking up the current occupant of the slot.
  select * into b from public.bookings where agreement_id = a.id and occurrence_on = p_on for update;
  if found then
    if b.schedule_state = 'superseded' then
      select * into r from public.agreement_schedule_revisions where id = p_revision_id;
      update public.bookings set status = 'confirmed', schedule_state = 'generated',
        schedule_revision_id = p_revision_id, confirmed_date = p_on, preferred_date = p_on,
        confirmed_time = r.visit_time, lifecycle_note = 'Schedule visit restored'
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
    occurrence_on,original_occurrence_on,schedule_revision_id,schedule_state,
    confirmed_date,preferred_date,confirmed_time,preferred_time,status,job_total,price_per_visit,first_visit_price,
    frequency,one_time,manual_quote,notify_failed,accepted_quote_snapshot,attribution,lead_id,
    gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,gbraid,wbraid,
    google_campaign_id,google_adgroup_id,google_ad_id,sq_ft,map_screenshot_url,last_mow,customer_notes)
  values(b.name,b.phone,b.email,b.address,a.customer_id,a.property_id,a.id,
    p_on,p_on,r.id,'generated',
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

create function public.crm_reconcile_schedule(p_agreement_id uuid,
  p_today date default (now() at time zone 'America/Chicago')::date)
returns date language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_agreements; v_from date; v_through date; v_slot record; v_next date;
begin
  if p_today is null then raise exception 'Choose a reconciliation date' using errcode = '22023'; end if;
  select * into a from public.recurring_agreements where id = p_agreement_id for update;
  if not found or a.status <> 'active' or a.generation_starts_on is null then return null; end if;
  v_from := coalesce(a.generated_through + 1,a.generation_starts_on);
  v_through := least(p_today + 90,a.end_on,v_from + 365);
  if v_from <= v_through then
    for v_slot in
      select s.* from public.crm_schedule_slots(a.id,v_from,v_through) s
      where not exists(select 1 from public.bookings b where b.agreement_id = a.id
        and b.occurrence_on = s.cadence_on and b.schedule_state is distinct from 'superseded')
      order by s.cadence_on
    loop
      perform public.crm_materialize_schedule_visit(a.id,v_slot.revision_id,v_slot.cadence_on);
    end loop;
  end if;
  select min(occurrence_on) into v_next from public.bookings
    where agreement_id = a.id and status = 'confirmed' and confirmed_date >= p_today;
  update public.recurring_agreements set
    generated_through = case when v_from <= v_through then v_through else a.generated_through end,
    next_on = coalesce(v_next,a.next_on)
  where id = a.id and (v_from <= v_through or next_on is distinct from coalesce(v_next,a.next_on));
  return greatest(a.generated_through,case when v_from <= v_through then v_through end);
end $$;

create function public.crm_reconcile_schedules(p_today date default (now() at time zone 'America/Chicago')::date)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_count integer := 0;
begin
  for v_id in select a.id from public.recurring_agreements a
    where a.status = 'active' and a.generation_starts_on is not null
      and coalesce(a.generated_through + 1,a.generation_starts_on) <= least(p_today + 90,a.end_on)
    order by a.id for update skip locked
  loop
    perform public.crm_reconcile_schedule(v_id,p_today);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.crm_calendar_entries(p_from date,p_through date)
returns table(booking_id uuid,agreement_id uuid,revision_id uuid,cadence_on date,service_on date,
  visit_time text,visit_status text,customer_id uuid,property_id uuid,name text,address text,job_total numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_from is null or p_through is null or p_through - p_from not between 0 and 365 then
    raise exception 'Choose a date range of at most 366 days' using errcode = '22023';
  end if;
  return query
    select b.id,b.agreement_id,b.schedule_revision_id,b.occurrence_on,b.confirmed_date,
      b.confirmed_time,b.status,b.customer_id,b.property_id,b.name,b.address,b.job_total
    from public.bookings b where b.confirmed_date between p_from and p_through
      and b.status in ('confirmed','completed')
    union all
    select null::uuid,a.id,s.revision_id,s.cadence_on,s.cadence_on,r.visit_time,
      'confirmed',a.customer_id,a.property_id,b.name,b.address,public.crm_validate_items(r.items_template)
    from public.recurring_agreements a
    join public.bookings b on b.id = a.schedule_source_booking_id
    cross join lateral public.crm_schedule_slots(a.id,p_from,p_through) s
    join public.agreement_schedule_revisions r on r.id = s.revision_id
    where a.status = 'active' and not exists(select 1 from public.bookings v
      where v.agreement_id = a.id and v.occurrence_on = s.cadence_on
        and v.schedule_state is distinct from 'superseded')
    order by 5,6,1,2;
end $$;

create function public.crm_calendar_attention(p_today date default (now() at time zone 'America/Chicago')::date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with gaps as (
    select a.id,coalesce(a.generated_through + 1,a.generation_starts_on) as gap_start,
      least(p_today - 1,a.end_on) as gap_end
    from public.recurring_agreements a
    where a.status = 'active' and a.generation_starts_on is not null
      and coalesce(a.generated_through + 1,a.generation_starts_on) <= least(p_today - 1,a.end_on)
  )
  select jsonb_build_object(
    'overdue', (select count(*) from public.bookings where status = 'confirmed' and confirmed_date < p_today)
      + (select count(*) from gaps g cross join lateral public.crm_schedule_slots(
          g.id,g.gap_start,least(g.gap_end,g.gap_start + 365)) s
        where not exists(select 1 from public.bookings b where b.agreement_id = g.id
          and b.occurrence_on = s.cadence_on and b.schedule_state is distinct from 'superseded')),
    'needs_scheduling', (select count(*) from public.bookings where status = 'pending'),
    'schedule_review', (select count(*) from public.recurring_agreements a
      where a.status = 'active' and a.generation_starts_on is null
        and not exists(select 1 from public.bookings b where b.agreement_id = a.id and b.status = 'pending')),
    'catching_up', exists(select 1 from gaps)
  );
$$;

revoke all on function public.crm_schedule_slots(uuid,date,date), public.crm_protect_schedule_visit(),
  public.crm_materialize_schedule_visit(uuid,uuid,date), public.crm_reconcile_schedule(uuid,date),
  public.crm_reconcile_schedules(date), public.crm_calendar_entries(date,date), public.crm_calendar_attention(date)
  from public,anon,authenticated;
grant execute on function public.crm_schedule_slots(uuid,date,date),
  public.crm_materialize_schedule_visit(uuid,uuid,date), public.crm_reconcile_schedule(uuid,date),
  public.crm_reconcile_schedules(date), public.crm_calendar_entries(date,date), public.crm_calendar_attention(date)
  to service_role;
