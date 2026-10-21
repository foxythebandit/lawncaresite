-- Stop before changing privileges if deployed policies/column grants need separate review.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bookings'
    and policyname not in ('authenticated_read_bookings', 'public_insert_bookings', 'client_read_own_bookings')) then
    raise exception 'Unexpected bookings policies: review production preflight before applying';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.bookings'::regclass and attacl is not null) then
    raise exception 'Existing bookings column grants require review before applying';
  end if;
end $$;
alter table public.bookings add column if not exists status text not null default 'pending';
alter table public.bookings add column if not exists map_screenshot_url text;
grant select, insert, update, delete on public.leads, public.bookings, public.extra_charges, public.quotes to service_role;
revoke all on public.leads, public.quotes from anon, authenticated;
revoke all on public.bookings from public, anon, authenticated;
grant select (id, email, created_at, status, confirmed_date, preferred_date, confirmed_time,
  address, sq_ft, frequency, price_per_visit, map_screenshot_url, completed_at,
  amount_charged, payment_method, payment_link) on public.bookings to authenticated;
-- Staff reads use guarded server-only service-role clients. Customer auth is not staff auth.
drop policy if exists authenticated_read_leads on public.leads;
drop policy if exists public_insert_leads on public.leads;
drop policy if exists authenticated_read_bookings on public.bookings;
drop policy if exists client_read_own_bookings on public.bookings;
drop policy if exists public_insert_bookings on public.bookings;
drop policy if exists public_insert_quotes on public.quotes;
drop policy if exists authenticated_read_quotes on public.quotes;
create policy customer_read_own_bookings on public.bookings for select to authenticated
  using (email is not null and lower(email) = lower((select auth.jwt()->>'email')));

alter table public.leads
  add column name text,
  add column email text,
  add column source text not null default 'legacy',
  add column external_submission_id text,
  add column form_version text,
  add column services jsonb not null default '[]',
  add column answers jsonb not null default '{}',
  add column timing text,
  add column frequency text,
  add column attribution jsonb not null default '{}',
  add column consent_version text,
  add column estimated_value numeric,
  add column score numeric,
  add column quote_draft jsonb,
  add column quote_saved_at timestamptz,
  add column quote_confirmed_at timestamptz;
create unique index leads_external_submission on public.leads(source, external_submission_id)
  where external_submission_id is not null;
alter table public.bookings
  add column lead_id uuid references public.leads(id) on delete restrict,
  add column attribution jsonb not null default '{}',
  add column confirmed_at timestamptz,
  add column payment_recorded_at timestamptz;
create index bookings_lead_id on public.bookings(lead_id);

create table public.intake_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  submission_id text not null,
  payload_hash text not null,
  lead_id uuid not null references public.leads(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(source, submission_id)
);
create index intake_events_lead_id on public.intake_events(lead_id);
create index intake_events_booking_id on public.intake_events(booking_id);
alter table public.intake_events enable row level security;
create table public.staff_alerts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.intake_events(id),
  recipient text not null default '',
  unique(event_id, recipient),
  state text not null default 'pending' check (state in ('pending','sending','accepted','delivered','failed','unknown','disabled')),
  provider_sid text unique,
  provider_status text,
  error_code text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.staff_alerts enable row level security;
revoke all on public.intake_events, public.staff_alerts from anon, authenticated;
grant all on public.intake_events, public.staff_alerts to service_role;

-- Atomic durable intake + outbox. Only the guarded server calls this function.
create function public.record_intake(p_source text, p_submission text, p_hash text, p_lead jsonb, p_booking jsonb default null, p_existing_lead uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_event public.intake_events;
  v_lead uuid;
  v_booking uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_source || ':' || p_submission, 0));
  select * into v_event from public.intake_events where source = p_source and submission_id = p_submission;
  if found then
    if v_event.payload_hash <> p_hash then raise exception 'Submission ID already used with different content' using errcode = '23505'; end if;
    return jsonb_build_object('lead_id', v_event.lead_id, 'event_id', v_event.id, 'booking_id', v_event.booking_id, 'duplicate', true);
  end if;
  if p_existing_lead is not null then
    select id into strict v_lead from public.leads where id = p_existing_lead;
  else
    v_lead := gen_random_uuid();
    insert into public.leads select (jsonb_populate_record(null::public.leads,
      jsonb_build_object('id',v_lead,'created_at',now(),'consent',false,'source',p_source,'external_submission_id',p_submission,'services','[]'::jsonb,'answers','{}'::jsonb,'attribution','{}'::jsonb)
      || p_lead || jsonb_build_object('id',v_lead,'source',p_source,'external_submission_id',p_submission))).*;
  end if;
  if p_booking is not null then
    update public.leads set name = coalesce(p_booking->>'name', name), email = coalesce(p_booking->>'email', email),
      timing = coalesce(p_booking->>'preferred_date', timing), frequency = coalesce(p_booking->>'frequency', frequency),
      address = coalesce(p_booking->>'address', address),
      services = (select coalesce(jsonb_agg(distinct service), '[]'::jsonb) from (
        select jsonb_array_elements_text(services) as service
        union select jsonb_object_keys(coalesce(nullif(p_booking->'addon_interest', 'null'::jsonb), '{}'::jsonb))
      ) selected),
      answers = answers || jsonb_strip_nulls(jsonb_build_object('addon_interest', p_booking->'addon_interest', 'last_mow', p_booking->'last_mow'))
      where id = v_lead;
    v_booking := gen_random_uuid();
    insert into public.bookings select (jsonb_populate_record(null::public.bookings,
      jsonb_build_object('notify_failed',false,'manual_quote',false,'one_time',false) || p_booking || jsonb_build_object('id',v_booking,'created_at',now(),'status','pending','lead_id',v_lead,
        'attribution',(select attribution from public.leads where id=v_lead),
        'gclid',(select gclid from public.leads where id=v_lead),
        'utm_source',(select utm_source from public.leads where id=v_lead),
        'utm_medium',(select utm_medium from public.leads where id=v_lead),
        'utm_campaign',(select utm_campaign from public.leads where id=v_lead),
        'utm_term',(select utm_term from public.leads where id=v_lead),
        'utm_content',(select utm_content from public.leads where id=v_lead)))).*;
  end if;
  insert into public.intake_events(source,submission_id,payload_hash,lead_id,booking_id)
    values(p_source,p_submission,p_hash,v_lead,v_booking) returning * into v_event;
  if p_source <> 'staff-booking' then insert into public.staff_alerts(event_id) values(v_event.id); end if;
  return jsonb_build_object('lead_id',v_lead,'event_id',v_event.id,'booking_id',v_booking,'duplicate',false);
end $$;
revoke all on function public.record_intake(text,text,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.record_intake(text,text,text,jsonb,jsonb,uuid) to service_role;

create function public.booking_stage_times() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'confirmed' and (TG_OP = 'INSERT' or old.status is distinct from 'confirmed') then new.confirmed_at := coalesce(new.confirmed_at, now()); end if;
  if nullif(new.payment_method,'') is not null and (TG_OP = 'INSERT' or nullif(old.payment_method,'') is null) then new.payment_recorded_at := now(); end if;
  return new;
end $$;
create trigger booking_stage_times before insert or update on public.bookings for each row execute function public.booking_stage_times();

-- Existing manual inquiries become visible in Leads; never infer links by phone.
insert into public.leads(id, phone, name, address, source, form_version, answers, attribution, gclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_at)
select id, phone, name, address, 'legacy-manual', 'manual:legacy', jsonb_build_object('lawn_size_bucket', lawn_size_bucket),
  jsonb_build_object('utm_source',utm_source,'utm_medium',utm_medium,'utm_campaign',utm_campaign,'utm_term',utm_term,'utm_content',utm_content,'gclid',gclid), gclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_at
from public.bookings where manual_quote = true and lead_id is null;
update public.bookings set lead_id = id where manual_quote = true and lead_id is null;
