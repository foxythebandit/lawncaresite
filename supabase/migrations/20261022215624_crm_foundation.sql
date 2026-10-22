-- Additive CRM identities. Historical rows are deliberately left unlinked.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  address text not null check (btrim(address) <> ''),
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  measurement_context jsonb,
  measured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, customer_id)
);
create index properties_customer_id_idx on public.properties(customer_id);

alter table public.leads
  add column customer_id uuid references public.customers(id) on delete restrict,
  add column property_id uuid,
  add column stage text not null default 'new' check (stage in ('new','contacted','quoted','booked','lost')),
  add column contact_outcome text check (contact_outcome in ('no_answer','reached','wrong_number')),
  add column follow_up_at timestamptz,
  add column quote_status text not null default 'draft' check (quote_status in ('draft','accepted','declined','canceled')),
  add column quote_accepted_at timestamptz,
  add column accepted_quote_snapshot jsonb,
  add column updated_at timestamptz not null default now(),
  add constraint leads_property_requires_customer check (property_id is null or customer_id is not null),
  add constraint leads_property_customer_fk foreign key (property_id,customer_id)
    references public.properties(id,customer_id) on delete restrict;
create index leads_customer_id_idx on public.leads(customer_id);
create index leads_property_id_idx on public.leads(property_id);
create index leads_follow_up_idx on public.leads(follow_up_at) where follow_up_at is not null;
create index leads_stage_idx on public.leads(stage,created_at desc);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  kind text not null check (kind in ('note','call','stage','quote','follow_up')),
  outcome text,
  body text,
  data jsonb,
  actor_email text,
  occurred_at timestamptz not null default now()
);
create index lead_activities_lead_time_idx on public.lead_activities(lead_id,occurred_at desc);

create table public.recurring_agreements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  property_id uuid not null,
  status text not null default 'active' check (status in ('active','paused','ended')),
  anchor_on date not null,
  next_on date not null,
  end_on date,
  interval_unit text not null check (interval_unit in ('week','month')),
  interval_count integer not null check (interval_count > 0 and interval_count <= 52),
  price_per_visit numeric(12,2) check (price_per_visit >= 0),
  items_template jsonb not null default '[]'::jsonb check (jsonb_typeof(items_template) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agreements_date_order check (end_on is null or end_on >= anchor_on),
  constraint agreements_property_customer_fk foreign key (property_id,customer_id)
    references public.properties(id,customer_id) on delete restrict
);
create index recurring_agreements_customer_idx on public.recurring_agreements(customer_id);
create index recurring_agreements_property_idx on public.recurring_agreements(property_id);
create index recurring_agreements_due_idx on public.recurring_agreements(next_on) where status = 'active';

alter table public.bookings
  add column customer_id uuid references public.customers(id) on delete restrict,
  add column property_id uuid,
  add column agreement_id uuid references public.recurring_agreements(id) on delete restrict,
  add column occurrence_on date,
  add column updated_at timestamptz not null default now(),
  add column creation_operation_id uuid unique,
  add column creation_request jsonb,
  add column completion_operation_id uuid unique,
  add column accepted_quote_snapshot jsonb,
  add column job_total numeric(12,2) check (job_total >= 0),
  add constraint bookings_property_requires_customer check (property_id is null or customer_id is not null),
  add constraint bookings_property_customer_fk foreign key (property_id,customer_id)
    references public.properties(id,customer_id) on delete restrict,
  add constraint bookings_agreement_occurrence check (agreement_id is null or occurrence_on is not null);
create unique index bookings_agreement_occurrence_idx on public.bookings(agreement_id,occurrence_on) where agreement_id is not null;
create index bookings_customer_id_idx on public.bookings(customer_id);
create index bookings_property_id_idx on public.bookings(property_id);
create index bookings_agreement_id_idx on public.bookings(agreement_id);
create index bookings_service_date_idx on public.bookings(confirmed_date,status);

create table public.job_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  kind text not null check (kind in ('service','discount')),
  description text not null check (btrim(description) <> ''),
  amount numeric(12,2) not null check ((kind = 'service' and amount >= 0) or (kind = 'discount' and amount <= 0)),
  created_at timestamptz not null default now()
);
create index job_items_booking_id_idx on public.job_items(booking_id);

create table public.job_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  operation_id uuid not null unique,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  paid_on date not null,
  method text not null check (btrim(method) <> ''),
  provenance text not null check (provenance in ('manual','processor_verified')),
  created_at timestamptz not null default now()
);
create index job_payments_booking_id_idx on public.job_payments(booking_id);

-- The existing uniqueness covered SMS alone. Preserve historical rows as SMS.
alter table public.staff_alerts add column channel text not null default 'sms'
  check (channel in ('sms','voice'));
alter table public.staff_alerts drop constraint staff_alerts_event_id_recipient_key;
alter table public.staff_alerts add constraint staff_alerts_event_recipient_channel_key
  unique (event_id,recipient,channel);

-- The customer portal's older booking column grant remains exactly as it was.
alter table public.customers enable row level security;
alter table public.properties enable row level security;
alter table public.lead_activities enable row level security;
alter table public.recurring_agreements enable row level security;
alter table public.job_items enable row level security;
alter table public.job_payments enable row level security;
revoke all on public.customers,public.properties,public.lead_activities,
  public.recurring_agreements,public.job_items,public.job_payments from public,anon,authenticated;
grant select,insert,update on public.customers,public.properties,public.recurring_agreements,
  public.job_items,public.job_payments to service_role;
grant select,insert on public.lead_activities to service_role;

create function public.crm_touch_updated_at() returns trigger language plpgsql
  set search_path = '' as $$
begin
  if tg_table_name = 'leads' and tg_op = 'INSERT' then
    new.stage := coalesce(new.stage,'new');
    new.quote_status := coalesce(new.quote_status,'draft');
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger crm_customers_touch before insert or update on public.customers
  for each row execute function public.crm_touch_updated_at();
create trigger crm_properties_touch before insert or update on public.properties
  for each row execute function public.crm_touch_updated_at();
create trigger crm_leads_touch before insert or update on public.leads
  for each row execute function public.crm_touch_updated_at();
create trigger crm_agreements_touch before insert or update on public.recurring_agreements
  for each row execute function public.crm_touch_updated_at();
create trigger crm_bookings_touch before insert or update on public.bookings
  for each row execute function public.crm_touch_updated_at();

create function public.crm_guard_snapshots() returns trigger language plpgsql
  set search_path = '' as $$
begin
  if old.accepted_quote_snapshot is not null
     and new.accepted_quote_snapshot is distinct from old.accepted_quote_snapshot then
    raise exception 'Accepted quote snapshot is immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger crm_bookings_snapshot before update on public.bookings
  for each row execute function public.crm_guard_snapshots();

create function public.crm_next_occurrence(p_anchor date,p_after date,p_unit text,p_count integer)
returns date language plpgsql immutable strict set search_path = '' as $$
declare v_step integer := 0; v_month date; v_date date;
begin
  if p_count <= 0 or p_count > 52 or p_unit not in ('week','month') then
    raise exception 'Invalid recurrence interval' using errcode = '22023';
  end if;
  loop
    v_step := v_step + 1;
    if p_unit = 'week' then
      v_date := p_anchor + (v_step * p_count * 7);
    else
      v_month := (date_trunc('month',p_anchor)::date + make_interval(months => v_step * p_count))::date;
      v_date := v_month + least(extract(day from p_anchor)::integer,
        extract(day from ((v_month + interval '1 month')::date - 1))::integer) - 1;
    end if;
    if v_date > p_after then return v_date; end if;
  end loop;
end $$;

-- All command functions are invoker-only and callable only with the server key.
create function public.update_lead_workflow(p_lead_id uuid,p_expected_updated_at timestamptz,
  p_patch jsonb,p_activity jsonb,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_kind text; v_new_status text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or p_patch - 'stage' - 'contact_outcome' - 'follow_up_at' - 'quote_status'
      - 'quote_draft' - 'name' - 'phone' - 'email' - 'address' - 'review_quote' <> '{}'::jsonb then
    raise exception 'Unsupported lead update' using errcode = '22023';
  end if;
  v_kind := p_activity->>'kind';
  if v_kind not in ('note','call','stage','quote','follow_up') or p_actor_email is null then
    raise exception 'Activity and actor are required' using errcode = '22023';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if v_lead.updated_at is distinct from p_expected_updated_at then
    raise exception 'Lead changed since it was opened' using errcode = '40001';
  end if;
  if v_lead.quote_status = 'accepted' and (p_patch ? 'quote_draft'
    or p_patch->>'quote_status' not in ('accepted','canceled')) then
    raise exception 'Accepted quote is immutable; cancel it before making a new draft'
      using errcode = '23514';
  end if;
  if p_patch ? 'phone' and nullif(btrim(p_patch->>'phone'),'') is null then
    raise exception 'Phone is required' using errcode = '23514';
  end if;
  if p_patch ? 'address' and nullif(btrim(p_patch->>'address'),'') is null then
    raise exception 'Address is required' using errcode = '23514';
  end if;
  v_new_status := coalesce(p_patch->>'quote_status',v_lead.quote_status);
  if v_new_status = 'accepted' and v_lead.quote_status <> 'accepted' then
    if coalesce(p_patch->'quote_draft',v_lead.quote_draft) is null
       or (p_patch ? 'quote_draft' and p_patch->>'review_quote' is distinct from 'true')
       or (v_lead.quote_confirmed_at is null and p_patch->>'review_quote' is distinct from 'true') then
      raise exception 'Quote must be reviewed before acceptance' using errcode = '23514';
    end if;
  end if;
  update public.leads set
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    phone = case when p_patch ? 'phone' then p_patch->>'phone' else phone end,
    email = case when p_patch ? 'email' then p_patch->>'email' else email end,
    address = case when p_patch ? 'address' then p_patch->>'address' else address end,
    stage = case when p_patch ? 'stage' then p_patch->>'stage' else stage end,
    contact_outcome = case when p_patch ? 'contact_outcome' then p_patch->>'contact_outcome' else contact_outcome end,
    follow_up_at = case when p_patch ? 'follow_up_at' then (p_patch->>'follow_up_at')::timestamptz else follow_up_at end,
    quote_status = v_new_status,
    quote_draft = case when p_patch ? 'quote_draft' then p_patch->'quote_draft' else quote_draft end,
    quote_saved_at = case when p_patch ? 'quote_draft' then now() else quote_saved_at end,
    quote_confirmed_at = case when p_patch->>'review_quote' = 'true' then now()
      when p_patch ? 'quote_draft' then null else quote_confirmed_at end,
    accepted_quote_snapshot = case
      when v_new_status = 'accepted' and quote_status <> 'accepted'
        then coalesce(p_patch->'quote_draft',quote_draft)
      when v_new_status = 'draft' and quote_status <> 'draft' then null
      else accepted_quote_snapshot end,
    quote_accepted_at = case when v_new_status = 'accepted' and quote_status <> 'accepted'
      then now() when v_new_status = 'draft' then null else quote_accepted_at end
  where id = p_lead_id returning * into v_lead;
  insert into public.lead_activities(lead_id,kind,outcome,body,actor_email,data)
    values(p_lead_id,v_kind,p_activity->>'outcome',p_activity->>'body',p_actor_email,
      case when v_kind = 'quote' and v_new_status = 'accepted'
        then jsonb_build_object('accepted_quote',v_lead.accepted_quote_snapshot,
          'accepted_at',v_lead.quote_accepted_at)
        else p_activity->'data' end);
  return jsonb_build_object('lead_id',p_lead_id,'updated_at',v_lead.updated_at);
end $$;

create function public.record_job_payment(p_booking_id uuid,p_operation_id uuid,
  p_amount numeric,p_paid_on date,p_method text,p_provenance text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_existing public.job_payments; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_operation_id::text,0));
  select * into v_existing from public.job_payments where operation_id = p_operation_id;
  if found then
    if v_existing.booking_id <> p_booking_id or v_existing.amount <> p_amount
      or v_existing.paid_on <> p_paid_on or v_existing.method <> p_method
      or v_existing.provenance <> p_provenance then
      raise exception 'Payment operation conflict' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  perform 1 from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  insert into public.job_payments(booking_id,operation_id,amount,paid_on,method,provenance)
    values(p_booking_id,p_operation_id,p_amount,p_paid_on,p_method,p_provenance)
    returning id into v_id;
  return v_id;
end $$;

create function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_booking public.bookings; v_agreement public.recurring_agreements;
  v_next date; v_next_id uuid; v_item jsonb; v_total numeric(12,2);
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.agreement_id is not null then
    select * into v_agreement from public.recurring_agreements
      where id = v_booking.agreement_id for update;
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.completion_operation_id = p_operation_id then
    select id into v_next_id from public.bookings
      where agreement_id = v_booking.agreement_id and occurrence_on > v_booking.occurrence_on
      order by occurrence_on limit 1;
    return jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next_id,'duplicate',true);
  end if;
  if v_booking.status = 'completed' or v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = '40001';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'Only confirmed jobs can be completed' using errcode = '23514';
  end if;
  update public.bookings set status = 'completed',completed_at = now(),
    completion_operation_id = p_operation_id where id = p_booking_id;
  if v_booking.agreement_id is not null and v_agreement.status = 'active' then
    v_next := greatest(v_agreement.next_on,
      public.crm_next_occurrence(v_agreement.anchor_on,v_booking.occurrence_on,
        v_agreement.interval_unit,v_agreement.interval_count));
    if v_agreement.end_on is null or v_next <= v_agreement.end_on then
      select coalesce(sum((value->>'amount')::numeric),v_agreement.price_per_visit,0)
        into v_total from jsonb_array_elements(v_agreement.items_template);
      if v_total < 0 then raise exception 'Agreement total cannot be negative' using errcode = '23514'; end if;
      insert into public.bookings(name,phone,email,address,customer_id,property_id,
        agreement_id,occurrence_on,confirmed_date,status,price_per_visit,frequency,
        accepted_quote_snapshot,attribution,lead_id,one_time,manual_quote,notify_failed,
        job_total,gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,
        sq_ft,first_visit_price,confirmed_time,map_screenshot_url,addon_interest,
        preferred_date,last_mow,customer_notes,preferred_time)
      values(v_booking.name,v_booking.phone,v_booking.email,v_booking.address,
        v_agreement.customer_id,v_agreement.property_id,v_agreement.id,v_next,v_next,
        'confirmed',case when v_total = trunc(v_total) then v_total::integer end,v_booking.frequency,
        jsonb_build_object('agreement_id',v_agreement.id,'items',v_agreement.items_template,
          'price_per_visit',v_agreement.price_per_visit),v_booking.attribution,
        v_booking.lead_id,false,false,false,v_total,v_booking.gclid,
        v_booking.utm_source,v_booking.utm_medium,v_booking.utm_campaign,
        v_booking.utm_term,v_booking.utm_content,v_booking.sq_ft,
        case when v_total = trunc(v_total) then v_total::integer end,
        v_booking.confirmed_time,v_booking.map_screenshot_url,v_booking.addon_interest,
        v_next,v_booking.last_mow,v_booking.customer_notes,v_booking.preferred_time)
      on conflict (agreement_id,occurrence_on) where agreement_id is not null do nothing
      returning id into v_next_id;
      if v_next_id is null then
        select id into v_next_id from public.bookings
          where agreement_id = v_agreement.id and occurrence_on = v_next;
      else
        for v_item in select value from jsonb_array_elements(v_agreement.items_template) loop
          insert into public.job_items(booking_id,kind,description,amount)
          values(v_next_id,coalesce(v_item->>'kind','service'),v_item->>'description',
            (v_item->>'amount')::numeric);
        end loop;
      end if;
      update public.recurring_agreements set next_on = public.crm_next_occurrence(
        anchor_on,v_next,interval_unit,interval_count) where id = v_agreement.id;
    end if;
  end if;
  return jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next_id,'duplicate',false);
end $$;

create function public.create_job_from_quote(p_lead_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_job jsonb,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_existing public.bookings; v_id uuid; v_item jsonb;
  v_total numeric(12,2); v_request jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('quote-job:' || p_operation_id::text,0));
  v_request := jsonb_build_object('lead_id',p_lead_id,'job',p_job,'items',p_items);
  select * into v_existing from public.bookings where creation_operation_id = p_operation_id;
  if found then
    if v_existing.creation_request is distinct from v_request then
      raise exception 'Job operation conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('booking_id',v_existing.id,'duplicate',true);
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if v_lead.updated_at is distinct from p_expected_updated_at then
    raise exception 'Lead changed since it was opened' using errcode = '40001';
  end if;
  if v_lead.quote_status <> 'accepted' or v_lead.accepted_quote_snapshot is null then
    raise exception 'Quote must be accepted first' using errcode = '23514';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Priced job items are required' using errcode = '22023';
  end if;
  select sum((value->>'amount')::numeric) into v_total from jsonb_array_elements(p_items);
  if v_total is null or v_total < 0 then
    raise exception 'Job total cannot be negative' using errcode = '23514';
  end if;
  insert into public.bookings(name,phone,email,address,lead_id,customer_id,property_id,
    status,preferred_date,price_per_visit,creation_operation_id,creation_request,
    accepted_quote_snapshot,job_total,manual_quote,one_time,notify_failed,attribution,
    gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content)
  values(coalesce(nullif(p_job->>'name',''),v_lead.name,'Unknown'),v_lead.phone,
    v_lead.email,coalesce(nullif(p_job->>'address',''),v_lead.address),p_lead_id,
    v_lead.customer_id,v_lead.property_id,'pending',(p_job->>'preferred_date')::date,
    case when v_total = trunc(v_total) then v_total::integer end,p_operation_id,v_request,
    jsonb_build_object('quote_draft',v_lead.accepted_quote_snapshot,'items',p_items,
      'total',v_total,'currency','USD','accepted_at',v_lead.quote_accepted_at),
    v_total,false,true,false,v_lead.attribution,v_lead.gclid,v_lead.utm_source,
    v_lead.utm_medium,v_lead.utm_campaign,v_lead.utm_term,v_lead.utm_content)
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.job_items(booking_id,kind,description,amount)
    values(v_id,coalesce(v_item->>'kind','service'),v_item->>'description',
      (v_item->>'amount')::numeric);
  end loop;
  update public.leads set stage = 'booked' where id = p_lead_id;
  return jsonb_build_object('booking_id',v_id,'duplicate',false);
end $$;

revoke all on function public.crm_touch_updated_at(),public.crm_guard_snapshots(),
  public.crm_next_occurrence(date,date,text,integer),
  public.update_lead_workflow(uuid,timestamptz,jsonb,jsonb,text),
  public.record_job_payment(uuid,uuid,numeric,date,text,text),
  public.complete_job(uuid,timestamptz,uuid),
  public.create_job_from_quote(uuid,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.crm_next_occurrence(date,date,text,integer),
  public.update_lead_workflow(uuid,timestamptz,jsonb,jsonb,text),
  public.record_job_payment(uuid,uuid,numeric,date,text,text),
  public.complete_job(uuid,timestamptz,uuid),
  public.create_job_from_quote(uuid,timestamptz,uuid,jsonb,jsonb) to service_role;
