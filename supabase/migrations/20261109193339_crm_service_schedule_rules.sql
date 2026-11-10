-- Revisions keep the rules in effect during earlier work. Visits retain their
-- booking IDs and their agreed prices when a later revision changes the cadence.
create function public.crm_validate_schedule(p_definition jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare v_period jsonb; v_rule jsonb; v_frequency text; v_pattern text;
  v_start date; v_end date; v_ranges daterange[] := array[]::daterange[];
  v_annual datemultirange := '{}'::datemultirange; v_season datemultirange;
begin
  if jsonb_typeof(p_definition) is distinct from 'object'
    or p_definition->'version' is distinct from '1'::jsonb
    or p_definition - array['version','base','annual','temporary','excluded_on'] <> '{}'::jsonb
    or jsonb_typeof(p_definition->'base') is distinct from 'object'
    or jsonb_typeof(coalesce(p_definition->'annual','[]')) <> 'array'
    or jsonb_typeof(coalesce(p_definition->'temporary','[]')) <> 'array'
    or jsonb_typeof(coalesce(p_definition->'excluded_on','[]')) <> 'array' then
    raise exception 'Invalid service schedule definition' using errcode = '22023';
  end if;

  -- A common year rejects invalid annual dates and makes overlap independent of DST.
  for v_period in select value from jsonb_array_elements(coalesce(p_definition->'annual','[]')) loop
    if jsonb_typeof(v_period) <> 'object'
      or v_period - array['start','end','rule'] <> '{}'::jsonb
      or coalesce(v_period->>'start','') !~ '^[0-9]{2}-[0-9]{2}$'
      or coalesce(v_period->>'end','') !~ '^[0-9]{2}-[0-9]{2}$' then
      raise exception 'Invalid annual schedule period' using errcode = '22023';
    end if;
    v_start := ('2001-' || (v_period->>'start'))::date;
    v_end := ('2001-' || (v_period->>'end'))::date;
    if v_start = v_end then raise exception 'Empty annual schedule period' using errcode = '22023'; end if;
    v_season := case when v_start < v_end then datemultirange(daterange(v_start,v_end))
      else datemultirange(daterange(v_start,date '2002-01-01'),daterange(date '2001-01-01',v_end)) end;
    if v_annual && v_season then raise exception 'Annual schedule periods overlap' using errcode = '22023'; end if;
    v_annual := v_annual + v_season;
  end loop;

  for v_period in select value from jsonb_array_elements(coalesce(p_definition->'temporary','[]')) loop
    if jsonb_typeof(v_period) <> 'object'
      or v_period - array['start','end','rule'] <> '{}'::jsonb
      or coalesce(v_period->>'start','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(v_period->>'end','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Invalid temporary schedule period' using errcode = '22023';
    end if;
    v_start := (v_period->>'start')::date;
    v_end := (v_period->>'end')::date;
    if v_start >= v_end or daterange(v_start,v_end) && any(v_ranges) then
      raise exception 'Temporary schedule periods are inverted or overlap' using errcode = '22023';
    end if;
    v_ranges := array_append(v_ranges,daterange(v_start,v_end));
  end loop;

  for v_rule in
    select p_definition->'base'
    union all select value->'rule' from jsonb_array_elements(coalesce(p_definition->'annual','[]'))
    union all select value->'rule' from jsonb_array_elements(coalesce(p_definition->'temporary','[]'))
  loop
    v_frequency := coalesce(v_rule->>'frequency','');
    if jsonb_typeof(v_rule) is distinct from 'object'
      or v_frequency not in ('paused','weekly','biweekly','monthly','legacy') then
      raise exception 'Invalid service cadence' using errcode = '22023';
    end if;
    if v_frequency = 'paused' and v_rule - 'frequency' = '{}'::jsonb then continue; end if;
    if coalesce(v_rule->>'anchor_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Choose a schedule anchor date' using errcode = '22023';
    end if;
    perform (v_rule->>'anchor_on')::date;
    v_pattern := v_rule->>'pattern';
    if v_frequency in ('weekly','biweekly')
      and v_rule - array['frequency','anchor_on'] = '{}'::jsonb then continue; end if;
    if v_frequency = 'legacy' and v_rule->>'unit' in ('week','month')
      and coalesce(v_rule->>'count','') ~ '^([1-9]|[1-4][0-9]|5[0-2])$'
      and v_rule - array['frequency','anchor_on','unit','count'] = '{}'::jsonb then continue; end if;
    if v_frequency = 'monthly' then
      if v_pattern = 'last_day' and v_rule - array['frequency','anchor_on','pattern'] = '{}'::jsonb then continue; end if;
      if v_pattern = 'day' and coalesce(v_rule->>'day','') ~ '^([1-9]|[12][0-9]|3[01])$'
        and v_rule - array['frequency','anchor_on','pattern','day'] = '{}'::jsonb then continue; end if;
      if v_pattern = 'ordinal' and coalesce(v_rule->>'ordinal','') ~ '^(-1|[1-5])$'
        and coalesce(v_rule->>'weekday','') ~ '^[1-7]$'
        and v_rule - array['frequency','anchor_on','pattern','ordinal','weekday'] = '{}'::jsonb then continue; end if;
    end if;
    raise exception 'Invalid service cadence fields' using errcode = '22023';
  end loop;

  for v_rule in select value from jsonb_array_elements(coalesce(p_definition->'excluded_on','[]')) loop
    if jsonb_typeof(v_rule) <> 'string' or (v_rule#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Invalid schedule exclusion date' using errcode = '22023';
    end if;
    perform (v_rule#>>'{}')::date;
  end loop;
  return true;
end $$;

create function public.crm_schedule_dates(p_definition jsonb,p_from date,p_through date)
returns setof date language plpgsql stable security invoker set search_path = '' as $$
declare v_day date; v_rule jsonb; v_annual jsonb; v_anchor date; v_month_end date; v_season_start date;
  v_frequency text; v_step integer; v_month_day text; v_dom integer;
begin
  if p_from is null or p_through is null or p_through - p_from not between 0 and 365 then
    raise exception 'Choose a date range of at most 366 days' using errcode = '22023';
  end if;
  perform public.crm_validate_schedule(p_definition);
  for v_day in select p_from + n from generate_series(0,p_through - p_from) as n loop
    if (p_definition->'excluded_on') ? to_char(v_day,'YYYY-MM-DD') then continue; end if;
    v_month_day := to_char(v_day,'MM-DD');
    select value into v_annual from jsonb_array_elements(coalesce(p_definition->'annual','[]'))
      where case when value->>'start' < value->>'end' then
        v_month_day >= value->>'start' and v_month_day < value->>'end'
        else v_month_day >= value->>'start' or v_month_day < value->>'end' end;
    select value->'rule' into v_rule from jsonb_array_elements(coalesce(p_definition->'temporary','[]'))
      where v_day >= (value->>'start')::date and v_day < (value->>'end')::date;
    if found then v_annual := null;
    else v_rule := coalesce(v_annual->'rule',p_definition->'base'); end if;
    v_frequency := v_rule->>'frequency';
    if v_frequency = 'paused' then continue; end if;
    v_anchor := (v_rule->>'anchor_on')::date;
    v_season_start := case when v_annual is not null then
      ((extract(year from v_day)::integer - case when v_month_day < v_annual->>'start' then 1 else 0 end)
        || '-' || (v_annual->>'start'))::date end;
    if v_frequency in ('weekly','biweekly') or (v_frequency = 'legacy' and v_rule->>'unit' = 'week') then
      if v_season_start is not null then
        v_anchor := v_season_start + ((extract(isodow from v_anchor)::integer
          - extract(isodow from v_season_start)::integer + 7) % 7);
      end if;
      v_step := case v_frequency when 'weekly' then 1 when 'biweekly' then 2 else (v_rule->>'count')::integer end;
      if v_day >= v_anchor and (v_day - v_anchor) % (7 * v_step) = 0 then return next v_day; end if;
    else
      v_anchor := coalesce(v_season_start,v_anchor);
      if v_day < v_anchor then continue; end if;
      v_dom := extract(day from v_day)::integer;
      v_month_end := (date_trunc('month',v_day::timestamp) + interval '1 month')::date - 1;
      if v_frequency = 'legacy' then
        if ((extract(year from v_day) - extract(year from v_anchor)) * 12
          + extract(month from v_day) - extract(month from v_anchor)) % (v_rule->>'count')::integer = 0
          and v_dom = least(extract(day from (v_rule->>'anchor_on')::date),extract(day from v_month_end)) then
          return next v_day;
        end if;
      elsif (v_rule->>'pattern' = 'day' and v_dom = (v_rule->>'day')::integer)
        or (v_rule->>'pattern' = 'last_day' and v_day = v_month_end)
        or (v_rule->>'pattern' = 'ordinal' and extract(isodow from v_day) = (v_rule->>'weekday')::integer
          and case when v_rule->>'ordinal' = '-1' then v_day + 7 > v_month_end
            else (v_dom - 1) / 7 + 1 = (v_rule->>'ordinal')::integer end) then
        return next v_day;
      end if;
    end if;
  end loop;
end $$;

create table public.agreement_schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.recurring_agreements(id),
  starts_on date not null,
  ends_before date,
  definition jsonb not null check (public.crm_validate_schedule(definition)),
  items_template jsonb not null check (public.crm_validate_items(items_template) >= 0),
  visit_time text,
  created_at timestamptz not null default now(),
  check (ends_before is null or ends_before >= starts_on),
  unique (id,agreement_id)
);
create index agreement_schedule_history_idx on public.agreement_schedule_revisions(agreement_id,starts_on);
create unique index agreement_schedule_current_idx on public.agreement_schedule_revisions(agreement_id)
  where ends_before is null;
alter table public.agreement_schedule_revisions enable row level security;
revoke all on public.agreement_schedule_revisions from public,anon,authenticated;
grant select,insert,update on public.agreement_schedule_revisions to service_role;

alter table public.recurring_agreements
  add column schedule_source_booking_id uuid references public.bookings(id),
  add column generation_starts_on date,
  add column generated_through date,
  add column schedule_review_reason text,
  add constraint agreements_generation_bounds check (
    generated_through is null or generated_through >= generation_starts_on - 1
  );
create index agreement_schedule_source_idx on public.recurring_agreements(schedule_source_booking_id)
  where schedule_source_booking_id is not null;

alter table public.bookings
  add column schedule_revision_id uuid,
  add column schedule_state text check (schedule_state in ('generated','exception','superseded')),
  add column original_occurrence_on date,
  add constraint bookings_schedule_revision_fk foreign key (schedule_revision_id,agreement_id)
    references public.agreement_schedule_revisions(id,agreement_id),
  add constraint bookings_schedule_identity_check check (
    (schedule_state is null and schedule_revision_id is null)
    or (schedule_state is not null and agreement_id is not null and original_occurrence_on is not null)
  );
create index bookings_schedule_revision_idx on public.bookings(schedule_revision_id)
  where schedule_revision_id is not null;
create index bookings_moved_schedule_date_idx on public.bookings(agreement_id,confirmed_date)
  where status in ('confirmed','completed') and confirmed_date <> occurrence_on;
create index bookings_unfinished_date_idx on public.bookings(confirmed_date,id)
  where status = 'confirmed' and confirmed_date is not null;

revoke all on function public.crm_validate_schedule(jsonb), public.crm_schedule_dates(jsonb,date,date)
  from public,anon,authenticated;
grant execute on function public.crm_validate_schedule(jsonb), public.crm_schedule_dates(jsonb,date,date)
  to service_role;
