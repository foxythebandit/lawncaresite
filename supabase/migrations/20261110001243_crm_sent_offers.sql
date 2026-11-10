-- Preserve the exact website amount and included overgrowth on the request.
create function public.crm_website_booking_terms(p_booking jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_price numeric := (p_booking->>'price_per_visit')::numeric;
  v_fee numeric := coalesce((p_booking->>'overgrowth_fee')::numeric,0);
  v_total numeric := coalesce((p_booking->>'first_visit_price')::numeric,v_price + v_fee);
  v_regular jsonb; v_first jsonb; v_freq text;
begin
  if v_price is null or v_price <= 0 then return null; end if;
  v_freq := case when p_booking->>'one_time' = 'true' then 'onetime'
    else case lower(replace(btrim(p_booking->>'frequency'),'-',''))
      when 'weekly' then 'weekly' when 'biweekly' then 'biweekly'
      when 'monthly' then 'monthly' else 'onetime' end end;
  v_regular := jsonb_build_array(jsonb_build_object('kind','service','description','Lawn care','amount',v_price::text));
  v_first := v_regular;
  if v_fee > 0 then
    v_first := v_first || jsonb_build_array(jsonb_build_object('kind','service','description','First-visit overgrowth','amount',v_fee::text));
  end if;
  if v_total < v_price + v_fee then
    v_first := v_first || jsonb_build_array(jsonb_build_object('kind','discount','description','Introductory mowing discount',
      'amount',(v_total - v_price - v_fee)::text));
  elsif v_total > v_price + v_fee then
    v_first := jsonb_build_array(jsonb_build_object('kind','service','description','Quoted first visit','amount',v_total::text));
  end if;
  return jsonb_build_object('source','website_booking','frequency',v_freq,'mowing',true,
    'items',v_first,'regular_items',v_regular,'total',v_total,'currency','USD','accepted_at',now());
end $$;
revoke all on function public.crm_website_booking_terms(jsonb) from public,anon,authenticated;
grant execute on function public.crm_website_booking_terms(jsonb) to service_role;

-- Composite intake inserts need explicit values for new visit intent columns.
create or replace function public.record_intake(p_source text, p_submission text, p_hash text, p_lead jsonb, p_booking jsonb default null, p_existing_lead uuid default null)
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
    if p_source = 'website-booking' and not (p_booking ? 'accepted_quote_snapshot') then
      p_booking := p_booking || jsonb_build_object('accepted_quote_snapshot',public.crm_website_booking_terms(p_booking));
    end if;
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
      jsonb_build_object('notify_failed',false,'manual_quote',false,'one_time',false,
        'date_override',false,'time_override',false,'price_override',false,'retain_visit',false) || p_booking || jsonb_build_object('id',v_booking,'created_at',now(),'status','pending','lead_id',v_lead,
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
-- Freeze terms and the server-rendered provider request before crossing the email boundary.
create table public.sent_offers (
  id uuid primary key,
  lead_id uuid not null references public.leads(id),
  version integer not null check (version > 0),
  terms jsonb not null check (jsonb_typeof(terms) = 'object'),
  message jsonb not null check (jsonb_typeof(message) = 'object'),
  channel text not null default 'email' check (channel = 'email'),
  recipient text not null,
  state text not null default 'sending' check (state in ('sending','unknown','failed','sent','review')),
  provider_id text unique,
  sent_at timestamptz,
  replaces_id uuid references public.sent_offers(id),
  replaced_by uuid references public.sent_offers(id),
  accepted_booking_id uuid unique references public.bookings(id),
  created_at timestamptz not null default now(),
  unique(lead_id,version),
  check ((state in ('sent','review')) = (sent_at is not null and provider_id is not null))
);
create index sent_offers_replaces_idx on public.sent_offers(replaces_id);
create index sent_offers_replaced_by_idx on public.sent_offers(replaced_by);
alter table public.sent_offers enable row level security;
revoke all on public.sent_offers from public,anon,authenticated;
grant select,insert,update on public.sent_offers to service_role;

create function public.crm_guard_sent_offer() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.id,new.lead_id,new.version,new.terms,new.message,new.channel,new.recipient,new.replaces_id,new.created_at)
    is distinct from (old.id,old.lead_id,old.version,old.terms,old.message,old.channel,old.recipient,old.replaces_id,old.created_at)
    or (old.sent_at is not null and (new.sent_at,new.provider_id,new.state)
      is distinct from (old.sent_at,old.provider_id,old.state))
    or (old.replaced_by is not null and new.replaced_by is distinct from old.replaced_by)
    or (old.accepted_booking_id is not null and new.accepted_booking_id is distinct from old.accepted_booking_id) then
    raise exception 'Sent offer facts are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger crm_sent_offer_guard before update on public.sent_offers
  for each row execute function public.crm_guard_sent_offer();

create function public.crm_prepare_sent_offer(p_lead_id uuid,p_version timestamptz,p_offer_id uuid,
  p_replaces uuid,p_terms jsonb,p_message jsonb,p_recipient text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.leads; o public.sent_offers; v_current uuid; v_next integer;
begin
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  select * into o from public.sent_offers where id = p_offer_id;
  if found then
    if (o.lead_id,o.replaces_id,o.terms,o.message,o.recipient)
      is distinct from (p_lead_id,p_replaces,p_terms,p_message,p_recipient) then
      raise exception 'Send attempt changed; open a new preview' using errcode = '23505';
    end if;
    return to_jsonb(o);
  end if;
  if l.updated_at is distinct from p_version or l.quote_draft is distinct from p_terms->'draft' then
    raise exception 'This lead changed. Review the quote again.' using errcode = 'PT409';
  end if;
  if exists(select 1 from public.sent_offers where lead_id = l.id and state in ('sending','unknown')) then
    raise exception 'Check the previous email attempt before sending another quote.' using errcode = 'PT409';
  end if;
  select id into v_current from public.sent_offers where lead_id = l.id and state = 'sent'
    and replaced_by is null order by version desc limit 1;
  if v_current is distinct from p_replaces then
    raise exception 'The current quote changed. Open a new preview.' using errcode = 'PT409';
  end if;
  select coalesce(max(version),0) + 1 into v_next from public.sent_offers where lead_id = l.id;
  insert into public.sent_offers(id,lead_id,version,terms,message,recipient,replaces_id)
    values(p_offer_id,l.id,v_next,p_terms,p_message,p_recipient,p_replaces) returning * into o;
  return to_jsonb(o) || '{"new_attempt":true}'::jsonb;
end $$;

-- Acceptance and send finalization serialize on the lead. If the earlier
-- offer was accepted while email was in flight, neither agreement is rewritten.
create function public.crm_finish_sent_offer(p_lead_id uuid,p_offer_id uuid,p_state text,
  p_provider_id text,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.leads; o public.sent_offers; v_review boolean;
begin
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  select * into o from public.sent_offers where id = p_offer_id and lead_id = l.id for update;
  if not found then raise exception 'Quote attempt not found' using errcode = 'P0002'; end if;
  if o.sent_at is not null or o.state = 'failed' then
    return jsonb_build_object('state',o.state,'updated_at',l.updated_at);
  end if;
  if p_state in ('unknown','failed') then
    if o.state = 'unknown' then p_state := 'unknown'; end if;
    update public.sent_offers set state = p_state where id = o.id;
    return jsonb_build_object('state',p_state,'updated_at',l.updated_at);
  end if;
  if p_state <> 'sent' or nullif(p_provider_id,'') is null then
    raise exception 'Provider acceptance is required' using errcode = '22023';
  end if;
  v_review := l.quote_status = 'accepted'
    or exists(select 1 from public.sent_offers where lead_id = l.id and accepted_booking_id is not null)
    or exists(select 1 from public.bookings b where b.lead_id = l.id and b.status in ('confirmed','completed'));
  update public.sent_offers set state = case when v_review then 'review' else 'sent' end,
    provider_id = p_provider_id,sent_at = clock_timestamp() where id = o.id returning * into o;
  if o.replaces_id is not null and not v_review then
    update public.sent_offers set replaced_by = o.id where id = o.replaces_id and accepted_booking_id is null;
  end if;
  insert into public.lead_activities(lead_id,kind,outcome,body,actor_email,data)
    values(l.id,'quote','emailed',
      case when v_review then 'Emailed a new proposal for staff review.' else 'Emailed quote to ' || o.recipient || '.' end,
      p_actor_email,jsonb_build_object('offer_id',o.id,'version',o.version));
  select updated_at into l.updated_at from public.leads where id = l.id;
  return jsonb_build_object('state',o.state,'updated_at',l.updated_at);
end $$;

-- All request paths share the intake transaction, including original
-- acquisition and the existing staff alert routing.
create function public.crm_accept_sent_offer(p_lead_id uuid,p_offer_id uuid,p_hash text,
  p_request jsonb,p_recipients text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.leads; o public.sent_offers; e public.intake_events; b public.bookings;
  v_key text := case when p_offer_id is null then 'legacy-' || p_lead_id::text else 'offer-' || p_offer_id::text end;
  v_row jsonb; v_items jsonb; v_item jsonb; v_snapshot jsonb; v_result jsonb;
  v_total numeric; v_regular numeric; v_frequency text; v_date date;
  v_email text; v_address text; v_one_time boolean := true;
begin
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if p_offer_id is not null then
    select * into o from public.sent_offers where id = p_offer_id and lead_id = l.id for update;
    if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  end if;
  select * into e from public.intake_events where source = 'quote-booking' and submission_id = v_key;
  if found then
    if e.payload_hash is distinct from p_hash then
      raise exception 'A request is already saved. Contact us to change it.' using errcode = 'PT409';
    end if;
    return jsonb_build_object('lead_id',l.id,'event_id',e.id,'booking_id',e.booking_id,'duplicate',true);
  end if;
  if p_offer_id is not null then
    if o.state <> 'sent' or o.replaced_by is not null then
      raise exception 'This quote is no longer open. Reload the link to review it.' using errcode = 'PT409';
    end if;
    if l.quote_status = 'accepted' or exists(select 1 from public.bookings
      where lead_id = l.id and status in ('pending','confirmed','completed')) then
      raise exception 'There is already a visit request. Contact us to review this quote.' using errcode = 'PT409';
    end if;
    v_address := o.terms->>'address';
    if jsonb_array_length(o.terms->'rows') = 1 then
      v_row := o.terms->'rows'->0;
      if v_row->>'freq' is distinct from p_request->>'frequency' then
        raise exception 'Choose the quoted service' using errcode = '22023';
      end if;
      v_items := v_row->'firstItems';
      v_total := public.crm_validate_items(v_items);
      v_regular := public.crm_validate_items(v_row->'regularItems');
      v_frequency := v_row->>'freq';
      v_one_time := v_frequency = 'onetime';
    elsif p_request->>'frequency' is not null then
      raise exception 'This quote needs staff review before choosing the first service' using errcode = '22023';
    end if;
    v_snapshot := jsonb_build_object('source',case when v_row is null then 'sent_offer_review' else 'sent_offer' end,
      'offer_id',o.id,'version',o.version,'rows',o.terms->'rows','mowing',o.terms->'mowing',
      'address',v_address,'items',v_items,'total',v_total,'currency','USD','accepted_at',now());
  else
    -- An older URL can continue the inquiry. A later mutable draft is not evidence of sent terms.
    select * into b from public.bookings where lead_id = l.id
      and status in ('pending','confirmed','completed') order by created_at limit 1;
    if found then
      return jsonb_build_object('lead_id',l.id,'booking_id',b.id,'duplicate',true);
    end if;
    v_address := l.address;
    v_snapshot := jsonb_strip_nulls(jsonb_build_object('source','legacy_quote_review','address',v_address,
      'historical_acceptance',l.accepted_quote_snapshot));
  end if;
  if nullif(btrim(v_address),'') is null then
    raise exception 'Please contact us to verify the property' using errcode = '22023';
  end if;
  v_date := (p_request->>'date')::date;
  if v_date < (now() at time zone 'America/Chicago')::date then
    raise exception 'Choose a preferred date from today on' using errcode = '22023';
  end if;
  v_email := coalesce(nullif(p_request->>'email',''),o.recipient,l.email);
  v_result := public.record_intake_v3('quote-booking',v_key,p_hash,'{}',jsonb_build_object(
    'name',coalesce(nullif(btrim(l.name),''),'Online quote customer'),'phone',l.phone,'email',v_email,
    'address',v_address,'sq_ft',o.terms->>'sqFt','one_time',v_one_time,'frequency',v_frequency,
    'preferred_date',v_date,'preferred_time',p_request->>'arrival','customer_notes',p_request->>'notes',
    'price_per_visit',case when v_regular = trunc(v_regular) then v_regular::integer end,
    'first_visit_price',case when v_total = trunc(v_total) then v_total::integer end,
    'job_total',v_total,'accepted_quote_snapshot',v_snapshot),l.id,p_recipients);
  for v_item in select value from jsonb_array_elements(v_items) loop
    insert into public.job_items(booking_id,kind,description,amount) values(
      (v_result->>'booking_id')::uuid,v_item->>'kind',v_item->>'description',(v_item->>'amount')::numeric);
  end loop;
  if o.id is not null then
    update public.sent_offers set accepted_booking_id = (v_result->>'booking_id')::uuid where id = o.id;
    update public.leads set stage = 'booked',quote_status = 'accepted',quote_accepted_at = now(),
      accepted_quote_snapshot = o.terms->'draft' || jsonb_build_object('sent_offer',v_snapshot) where id = l.id;
  else
    update public.leads set stage = 'booked' where id = l.id;
  end if;
  insert into public.lead_activities(lead_id,kind,outcome,body,data)
    values(l.id,'quote',case when o.id is null then 'legacy_quote_review' else 'booked_online' end,
      case when o.id is null then 'Preferred visit requested from an older link. Review the quoted terms.' else 'Customer accepted the sent offer and requested a first visit.' end,
      jsonb_build_object('offer_id',o.id,'booking_id',v_result->>'booking_id'));
  return v_result;
end $$;

revoke all on function public.crm_guard_sent_offer(),
  public.crm_prepare_sent_offer(uuid,timestamptz,uuid,uuid,jsonb,jsonb,text),
  public.crm_finish_sent_offer(uuid,uuid,text,text,text),
  public.crm_accept_sent_offer(uuid,uuid,text,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.crm_guard_sent_offer(),
  public.crm_prepare_sent_offer(uuid,timestamptz,uuid,uuid,jsonb,jsonb,text),
  public.crm_finish_sent_offer(uuid,uuid,text,text,text),
  public.crm_accept_sent_offer(uuid,uuid,text,jsonb,text[]) to service_role;
