-- Lifecycle commands are server-key only. Existing rows and accepted quote snapshots stay intact.
alter table public.recurring_agreements add constraint agreements_identity_key unique (id,customer_id,property_id);
alter table public.bookings add constraint bookings_agreement_identity_check
  check (agreement_id is null or (customer_id is not null and property_id is not null));
alter table public.bookings add constraint bookings_agreement_identity_fk
  foreign key (agreement_id,customer_id,property_id)
  references public.recurring_agreements(id,customer_id,property_id) on delete restrict;

create table public.crm_operations (
  id uuid primary key,
  action text not null,
  target_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.crm_operations enable row level security;
revoke all on public.crm_operations from public,anon,authenticated;
grant select,insert on public.crm_operations to service_role;

create function public.crm_validate_items(p_items jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
declare v_item jsonb; v_amount numeric; v_total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one priced item is required' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or v_item->>'kind' not in ('service','discount')
      or nullif(btrim(v_item->>'description'),'') is null
      or length(v_item->>'description') > 240
      or coalesce(v_item->>'amount','') !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$' then
      raise exception 'Invalid priced item' using errcode = '22023';
    end if;
    v_amount := (v_item->>'amount')::numeric;
    if (v_item->>'kind' = 'service' and v_amount < 0)
      or (v_item->>'kind' = 'discount' and v_amount > 0) then
      raise exception 'Item amount has wrong sign' using errcode = '22023';
    end if;
    v_total := v_total + v_amount;
  end loop;
  if v_total < 0 or v_total > 9999999999.99 then
    raise exception 'Job total is outside allowed range' using errcode = '22023';
  end if;
  return v_total;
end $$;

create function public.crm_guard_agreement_template() returns trigger
language plpgsql set search_path = '' as $$
declare v_total numeric;
begin
  if jsonb_array_length(new.items_template) > 0 then
    v_total := public.crm_validate_items(new.items_template);
    if new.price_per_visit is not null and new.price_per_visit <> v_total then
      raise exception 'Agreement price differs from item template' using errcode = '23514';
    end if;
    new.price_per_visit := v_total;
  elsif new.price_per_visit is not null then
    if new.price_per_visit < 0 or new.price_per_visit <> round(new.price_per_visit,2) then
      raise exception 'Invalid agreement price' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger crm_agreement_template before insert or update on public.recurring_agreements
  for each row execute function public.crm_guard_agreement_template();

create function public.crm_operation_reply(p_id uuid,p_action text,p_target uuid,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.crm_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended('crm-operation:' || p_id::text,0));
  select * into v_row from public.crm_operations where id = p_id;
  if found then
    if v_row.action <> p_action or v_row.target_id <> p_target
      or v_row.request is distinct from p_request then
      raise exception 'Lifecycle operation conflict' using errcode = '23505';
    end if;
    return v_row.result;
  end if;
  return null;
end $$;

create function public.crm_link_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_customer_id uuid,p_property_id uuid,p_customer jsonb,p_property jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_booking public.bookings; v_customer_id uuid := p_customer_id;
  v_property_id uuid := p_property_id; v_result jsonb; v_request jsonb;
begin
  v_request := jsonb_build_object('customer_id',p_customer_id,'property_id',p_property_id,
    'customer',p_customer,'property',p_property);
  v_result := public.crm_operation_reply(p_operation_id,'link_job',p_booking_id,v_request);
  if v_result is not null then return v_result; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.agreement_id is not null then
    raise exception 'Agreement job identity cannot be changed' using errcode = '23514';
  end if;
  if v_booking.customer_id is not null and v_booking.customer_id is distinct from p_customer_id then
    raise exception 'Existing customer link must be reviewed separately' using errcode = '23514';
  end if;
  if p_customer_id is null then
    if p_customer is null or nullif(btrim(p_customer->>'name'),'') is null then
      raise exception 'Customer name is required' using errcode = '22023';
    end if;
    insert into public.customers(name,phone,email)
      values(btrim(p_customer->>'name'),nullif(btrim(p_customer->>'phone'),''),
        nullif(btrim(p_customer->>'email'),'')) returning id into v_customer_id;
  elsif p_customer is not null then
    raise exception 'Choose existing customer or create a new customer' using errcode = '22023';
  end if;
  if p_property_id is null then
    if p_property is null or nullif(btrim(p_property->>'address'),'') is null then
      raise exception 'Property address is required' using errcode = '22023';
    end if;
    insert into public.properties(customer_id,address)
      values(v_customer_id,btrim(p_property->>'address')) returning id into v_property_id;
  elsif p_property is not null then
    raise exception 'Choose existing property or create a new property' using errcode = '22023';
  end if;
  if not exists(select 1 from public.properties where id = v_property_id and customer_id = v_customer_id) then
    raise exception 'Property belongs to another customer' using errcode = '23514';
  end if;
  update public.bookings set customer_id = v_customer_id,property_id = v_property_id
    where id = p_booking_id;
  if v_booking.lead_id is not null then
    update public.leads set customer_id = v_customer_id,property_id = v_property_id
      where id = v_booking.lead_id and customer_id is null and property_id is null;
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'customer_id',v_customer_id,
    'property_id',v_property_id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'link_job',p_booking_id,v_request,v_result);
  return v_result;
end $$;

create function public.crm_replace_job_items(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_items jsonb) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_item jsonb; v_total numeric; v_result jsonb;
begin
  v_result := public.crm_operation_reply(p_operation_id,'replace_job_items',p_booking_id,p_items);
  if v_result is not null then return v_result; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.status in ('completed','canceled','skipped','declined') then
    raise exception 'Finished job prices cannot be changed' using errcode = '23514';
  end if;
  v_total := public.crm_validate_items(p_items);
  delete from public.job_items where booking_id = p_booking_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.job_items(booking_id,kind,description,amount)
      values(p_booking_id,v_item->>'kind',btrim(v_item->>'description'),(v_item->>'amount')::numeric);
  end loop;
  update public.bookings set job_total = v_total,
    price_per_visit = case when v_total = trunc(v_total) and v_total <= 2147483647
      then v_total::integer else null end,
    payment_link = null where id = p_booking_id;
  v_result := jsonb_build_object('booking_id',p_booking_id,'job_total',v_total);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'replace_job_items',p_booking_id,p_items,v_result);
  return v_result;
end $$;

alter table public.bookings add column lifecycle_note text;

create function public.crm_generate_next_job(p_booking_id uuid,p_after date,p_force_on date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_booking public.bookings; v_agreement public.recurring_agreements;
  v_next date; v_id uuid; v_item jsonb; v_total numeric; v_last_mow text;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.agreement_id is null then return null; end if;
  select * into v_agreement from public.recurring_agreements
    where id = v_booking.agreement_id for update;
  if v_agreement.status <> 'active' then return null; end if;
  v_next := coalesce(p_force_on,greatest(v_agreement.next_on,public.crm_next_occurrence(
    v_agreement.anchor_on,p_after,v_agreement.interval_unit,v_agreement.interval_count)));
  if v_agreement.end_on is not null and v_next > v_agreement.end_on then return null; end if;
  if jsonb_array_length(v_agreement.items_template) > 0 then
    v_total := public.crm_validate_items(v_agreement.items_template);
  else
    v_total := coalesce(v_agreement.price_per_visit,0);
  end if;
  v_last_mow := v_booking.last_mow;
  if v_booking.status = 'completed' and exists(
    select 1 from public.job_items where booking_id = p_booking_id and kind = 'service'
      and description ~* '(mow|lawn care|lawn cut|grass cut)') then
    v_last_mow := v_booking.completed_at::date::text;
  end if;
  insert into public.bookings(name,phone,email,address,customer_id,property_id,
    agreement_id,occurrence_on,confirmed_date,status,price_per_visit,frequency,
    accepted_quote_snapshot,attribution,lead_id,one_time,manual_quote,notify_failed,
    job_total,gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,
    gbraid,wbraid,google_campaign_id,google_adgroup_id,google_ad_id,
    sq_ft,first_visit_price,confirmed_time,map_screenshot_url,addon_interest,
    preferred_date,last_mow,customer_notes,preferred_time)
  values(v_booking.name,v_booking.phone,v_booking.email,v_booking.address,
    v_agreement.customer_id,v_agreement.property_id,v_agreement.id,v_next,v_next,
    'confirmed',case when v_total = trunc(v_total) and v_total <= 2147483647
      then v_total::integer end,v_booking.frequency,
    jsonb_build_object('agreement_id',v_agreement.id,'items',v_agreement.items_template,
      'total',v_total,'currency','USD'),v_booking.attribution,v_booking.lead_id,
    false,false,false,v_total,v_booking.gclid,v_booking.utm_source,v_booking.utm_medium,
    v_booking.utm_campaign,v_booking.utm_term,v_booking.utm_content,
    v_booking.gbraid,v_booking.wbraid,v_booking.google_campaign_id,
    v_booking.google_adgroup_id,v_booking.google_ad_id,v_booking.sq_ft,
    case when v_total = trunc(v_total) and v_total <= 2147483647
      then v_total::integer end,
    v_booking.confirmed_time,v_booking.map_screenshot_url,null,
    v_next,v_last_mow,v_booking.customer_notes,v_booking.preferred_time)
  on conflict (agreement_id,occurrence_on) where agreement_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.bookings
      where agreement_id = v_agreement.id and occurrence_on = v_next;
    if p_force_on is not null and exists(select 1 from public.bookings where id = v_id
      and status = 'canceled' and lifecycle_note = 'Canceled on agreement pause') then
      update public.bookings set status = 'confirmed',confirmed_date = v_next,
        preferred_date = v_next,lifecycle_note = 'Resumed after agreement pause'
        where id = v_id;
    elsif exists(select 1 from public.bookings where id = v_id and status in ('canceled','skipped')) then
      raise exception 'An individually canceled or skipped visit occupies this date'
        using errcode = '23505';
    end if;
  else
    for v_item in select value from jsonb_array_elements(v_agreement.items_template) loop
      insert into public.job_items(booking_id,kind,description,amount)
        values(v_id,v_item->>'kind',v_item->>'description',(v_item->>'amount')::numeric);
    end loop;
  end if;
  update public.recurring_agreements set next_on = public.crm_next_occurrence(
    anchor_on,v_next,interval_unit,interval_count) where id = v_agreement.id;
  return v_id;
end $$;

create function public.crm_start_agreement(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_config jsonb) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_id uuid; v_result jsonb; v_anchor date;
  v_occurrence date; v_next date; v_total numeric;
begin
  v_result := public.crm_operation_reply(p_operation_id,'start_agreement',p_booking_id,p_config);
  if v_result is not null then return v_result; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.agreement_id is not null or v_booking.customer_id is null
    or v_booking.property_id is null or v_booking.status not in ('pending','confirmed') then
    raise exception 'Link a current job to a customer and property before starting recurrence'
      using errcode = '23514';
  end if;
  v_occurrence := coalesce(v_booking.confirmed_date,v_booking.preferred_date);
  v_anchor := (p_config->>'anchor_on')::date;
  v_next := (p_config->>'next_on')::date;
  if v_occurrence is null or v_anchor is null or v_occurrence <> v_anchor
    or v_next is null or v_next <= v_anchor then
    raise exception 'Choose the current visit as anchor and a later next date' using errcode = '22023';
  end if;
  v_total := public.crm_validate_items(p_config->'items_template');
  insert into public.recurring_agreements(customer_id,property_id,anchor_on,next_on,end_on,
    interval_unit,interval_count,price_per_visit,items_template)
  values(v_booking.customer_id,v_booking.property_id,v_anchor,v_next,
    nullif(p_config->>'end_on','')::date,p_config->>'interval_unit',
    (p_config->>'interval_count')::integer,v_total,p_config->'items_template')
  returning id into v_id;
  update public.bookings set agreement_id = v_id,occurrence_on = v_occurrence,
    one_time = false where id = p_booking_id;
  v_result := jsonb_build_object('booking_id',p_booking_id,'agreement_id',v_id);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'start_agreement',p_booking_id,p_config,v_result);
  return v_result;
end $$;

create function public.crm_job_command(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql
  security invoker set search_path = '' as $$
declare v_booking public.bookings; v_result jsonb; v_next uuid; v_date date;
  v_agreement_id uuid;
begin
  if p_action not in ('confirm','reschedule','skip','cancel') then
    raise exception 'Unsupported job action' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'job_' || p_action,p_booking_id,p_payload);
  if v_result is not null then return v_result; end if;
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
    update public.bookings set status = 'confirmed',confirmed_date = v_date,
      confirmed_time = nullif(p_payload->>'time',''),preferred_date = v_date
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
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next,
    'status',case when p_action in ('confirm','reschedule') then 'confirmed' else
      case when p_action = 'skip' then 'skipped' else 'canceled' end end);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'job_' || p_action,p_booking_id,p_payload,v_result);
  return v_result;
end $$;

create function public.crm_agreement_command(p_agreement_id uuid,p_expected_updated_at timestamptz,
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
    update public.recurring_agreements set status = 'active',next_on = v_next
      where id = p_agreement_id;
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

create function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_completed_on date) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_agreement_id uuid; v_next_id uuid;
  v_result jsonb; v_request jsonb;
begin
  if p_completed_on is null then raise exception 'Completion date required' using errcode = '22023'; end if;
  v_request := jsonb_build_object('completed_on',p_completed_on);
  v_result := public.crm_operation_reply(p_operation_id,'complete_job',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select agreement_id into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is not null then
    perform 1 from public.recurring_agreements where id = v_agreement_id for update;
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
  p_operation_id uuid) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return public.complete_job(p_booking_id,p_expected_updated_at,p_operation_id,
    (now() at time zone 'America/Chicago')::date);
end $$;

create or replace function public.create_job_from_quote(p_lead_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_job jsonb,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_existing public.bookings; v_id uuid; v_item jsonb;
  v_total numeric; v_request jsonb; v_draft jsonb;
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
    raise exception 'Lead changed since it was opened' using errcode = 'PT409';
  end if;
  if v_lead.quote_status <> 'accepted' or v_lead.accepted_quote_snapshot is null then
    raise exception 'Quote must be accepted first' using errcode = '23514';
  end if;
  v_total := public.crm_validate_items(p_items);
  v_draft := v_lead.accepted_quote_snapshot;
  insert into public.bookings(name,phone,email,address,lead_id,customer_id,property_id,
    status,preferred_date,price_per_visit,creation_operation_id,creation_request,
    accepted_quote_snapshot,job_total,manual_quote,one_time,notify_failed,attribution,
    gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,
    gbraid,wbraid,google_campaign_id,google_adgroup_id,google_ad_id,
    sq_ft,map_screenshot_url,addon_interest,last_mow,overgrowth_fee,notes,frequency)
  values(coalesce(nullif(p_job->>'name',''),v_lead.name,'Unknown'),v_lead.phone,
    v_lead.email,coalesce(nullif(p_job->>'address',''),v_lead.address),p_lead_id,
    v_lead.customer_id,v_lead.property_id,'pending',(p_job->>'preferred_date')::date,
    case when v_total = trunc(v_total) and v_total <= 2147483647
      then v_total::integer end,p_operation_id,v_request,
    jsonb_build_object('quote_draft',v_draft,'items',p_items,
      'total',v_total,'currency','USD','accepted_at',v_lead.quote_accepted_at),
    v_total,false,true,false,v_lead.attribution,v_lead.gclid,v_lead.utm_source,
    v_lead.utm_medium,v_lead.utm_campaign,v_lead.utm_term,v_lead.utm_content,
    v_lead.gbraid,v_lead.wbraid,v_lead.google_campaign_id,
    v_lead.google_adgroup_id,v_lead.google_ad_id,
    coalesce((p_job->>'sq_ft')::integer,
      (select sum((value->>'sqFt')::numeric)::integer from jsonb_array_elements(
        coalesce(v_draft->'sections','[]'::jsonb))),v_lead.sq_ft),
    coalesce(nullif(p_job->>'map_screenshot_url',''),nullif(v_lead.answers->>'map_screenshot_url','')),
    coalesce(v_draft->'addonInterest',v_lead.answers->'addon_interest'),
    coalesce(nullif(v_draft->>'lastMow',''),v_lead.answers->>'last_mow'),
    coalesce((v_draft->>'overgrowthFee')::integer,0),
    nullif(v_draft->>'notes',''),coalesce(nullif(p_job->>'frequency',''),
      nullif(v_draft->>'freq',''),v_lead.frequency))
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.job_items(booking_id,kind,description,amount)
      values(v_id,v_item->>'kind',v_item->>'description',(v_item->>'amount')::numeric);
  end loop;
  update public.leads set stage = 'booked' where id = p_lead_id;
  return jsonb_build_object('booking_id',v_id,'duplicate',false);
end $$;

revoke all on function public.crm_validate_items(jsonb),public.crm_guard_agreement_template(),
  public.crm_operation_reply(uuid,text,uuid,jsonb),public.crm_link_job(uuid,timestamptz,uuid,uuid,uuid,jsonb,jsonb),
  public.crm_replace_job_items(uuid,timestamptz,uuid,jsonb),
  public.crm_generate_next_job(uuid,date,date),public.crm_start_agreement(uuid,timestamptz,uuid,jsonb),
  public.crm_job_command(uuid,timestamptz,uuid,text,jsonb),
  public.crm_agreement_command(uuid,timestamptz,uuid,text,jsonb),
  public.complete_job(uuid,timestamptz,uuid,date) from public,anon,authenticated;
grant execute on function public.crm_validate_items(jsonb),
  public.crm_operation_reply(uuid,text,uuid,jsonb),
  public.crm_link_job(uuid,timestamptz,uuid,uuid,uuid,jsonb,jsonb),
  public.crm_replace_job_items(uuid,timestamptz,uuid,jsonb),
  public.crm_generate_next_job(uuid,date,date),public.crm_start_agreement(uuid,timestamptz,uuid,jsonb),
  public.crm_job_command(uuid,timestamptz,uuid,text,jsonb),
  public.crm_agreement_command(uuid,timestamptz,uuid,text,jsonb),
  public.complete_job(uuid,timestamptz,uuid,date) to service_role;

-- PostgREST retries SQLSTATE 40001. Surface stale versions as HTTP 409 instead.
create or replace function public.update_lead_workflow(p_lead_id uuid,p_expected_updated_at timestamptz,
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
    raise exception 'Lead changed since it was opened' using errcode = 'PT409';
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


create or replace function public.record_job_payment(p_booking_id uuid,p_operation_id uuid,
  p_amount numeric,p_paid_on date,p_method text,p_provenance text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_existing public.job_payments; v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount,2) then
    raise exception 'Payment must use exact cents' using errcode = '22023';
  end if;
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

