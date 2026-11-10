-- Staff-created job for an existing customer (one-off work, upsells, or the first
-- visit of a new mowing plan). Additive: reuses bookings/job_items and the same
-- creation-operation idempotency as create_job_from_quote.
create or replace function public.crm_create_customer_job(p_operation_id uuid, p_customer_id uuid,
  p_property_id uuid, p_property jsonb, p_job jsonb, p_items jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare v_customer public.customers; v_existing public.bookings; v_request jsonb;
  v_property_id uuid := p_property_id; v_address text; v_total numeric; v_id uuid;
  v_item jsonb; v_first public.bookings;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-job:' || p_operation_id::text,0));
  v_request := jsonb_build_object('customer_id',p_customer_id,'property_id',p_property_id,
    'property',p_property,'job',p_job,'items',p_items);
  select * into v_existing from public.bookings where creation_operation_id = p_operation_id;
  if found then
    if v_existing.creation_request is distinct from v_request then
      raise exception 'Job operation conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('booking_id',v_existing.id,'property_id',v_existing.property_id,'duplicate',true);
  end if;
  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if v_property_id is null then
    if p_property is null or nullif(btrim(p_property->>'address'),'') is null then
      raise exception 'Property address is required' using errcode = '22023';
    end if;
    insert into public.properties(customer_id,address)
      values(p_customer_id,btrim(p_property->>'address')) returning id into v_property_id;
  elsif p_property is not null then
    raise exception 'Choose existing property or create a new property' using errcode = '22023';
  end if;
  select address into v_address from public.properties where id = v_property_id and customer_id = p_customer_id;
  if not found then raise exception 'Property belongs to another customer' using errcode = '23514'; end if;
  if nullif(p_job->>'preferred_date','') is not null and (p_job->>'preferred_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Invalid visit date' using errcode = '22023';
  end if;
  v_total := public.crm_validate_items(p_items);
  -- Repeat work keeps the customer's original acquisition (first linked job).
  select * into v_first from public.bookings where customer_id = p_customer_id order by created_at limit 1;
  insert into public.bookings(name,phone,email,address,customer_id,property_id,status,preferred_date,
    price_per_visit,job_total,creation_operation_id,creation_request,accepted_quote_snapshot,
    manual_quote,one_time,frequency,notes,notify_failed,attribution,gclid,utm_source,utm_medium,
    utm_campaign,utm_term,utm_content,gbraid,wbraid,google_campaign_id,google_adgroup_id,google_ad_id)
  values(coalesce(v_customer.name,'Unknown'),coalesce(v_customer.phone,''),v_customer.email,v_address,
    p_customer_id,v_property_id,'pending',nullif(p_job->>'preferred_date','')::date,
    case when v_total = trunc(v_total) and v_total <= 2147483647 then v_total::integer end,
    v_total,p_operation_id,v_request,
    jsonb_build_object('source','staff_job','items',p_items,'total',v_total,'currency','USD','accepted_at',now()),
    true,coalesce((p_job->>'one_time')::boolean,true),nullif(p_job->>'frequency',''),
    nullif(btrim(p_job->>'notes'),''),false,coalesce(v_first.attribution,'{}'::jsonb),v_first.gclid,v_first.utm_source,
    v_first.utm_medium,v_first.utm_campaign,v_first.utm_term,v_first.utm_content,v_first.gbraid,
    v_first.wbraid,v_first.google_campaign_id,v_first.google_adgroup_id,v_first.google_ad_id)
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.job_items(booking_id,kind,description,amount)
      values(v_id,v_item->>'kind',v_item->>'description',(v_item->>'amount')::numeric);
  end loop;
  return jsonb_build_object('booking_id',v_id,'property_id',v_property_id,'duplicate',false);
end $$;

revoke all on function public.crm_create_customer_job(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_create_customer_job(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;

create or replace function public.crm_start_agreement(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_config jsonb) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_id uuid; v_result jsonb; v_anchor date;
  v_occurrence date; v_next date; v_total numeric; v_next_booking uuid; v_label uuid;
begin
  v_result := public.crm_operation_reply(p_operation_id,'start_agreement',p_booking_id,p_config);
  if v_result is not null then return v_result; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Job changed since it was opened' using errcode = 'PT409';
  end if;
  if v_booking.agreement_id is not null or v_booking.customer_id is null
    or v_booking.property_id is null or v_booking.status not in ('pending','confirmed','completed') then
    raise exception 'Link a current job to a customer and property before starting recurrence'
      using errcode = '23514';
  end if;
  v_occurrence := coalesce(v_booking.confirmed_date,v_booking.preferred_date,(v_booking.completed_at at time zone 'America/Chicago')::date);
  v_anchor := (p_config->>'anchor_on')::date;
  v_next := (p_config->>'next_on')::date;
  if v_occurrence is null or v_anchor is null or v_occurrence <> v_anchor
    or v_next is null or v_next <= v_anchor then
    raise exception 'Choose the current visit as anchor and a later next date' using errcode = '22023';
  end if;
  v_total := public.crm_validate_items(p_config->'items_template');
  v_label := v_booking.service_label_id;
  if v_label is null and exists(select 1 from jsonb_array_elements(p_config->'items_template') item
    where item->>'kind' = 'service' and lower(btrim(item->>'description')) in ('lawn care','mowing plan visit'))
    and not exists(select 1 from jsonb_array_elements(p_config->'items_template') item
      where item->>'kind' = 'service' and lower(btrim(item->>'description')) not in ('lawn care','mowing plan visit')) then
    select id into v_label from public.service_labels where semantic_key = 'mowing' and retired_at is null;
  end if;
  insert into public.recurring_agreements(customer_id,property_id,anchor_on,next_on,end_on,
    interval_unit,interval_count,price_per_visit,items_template,service_label_id)
  values(v_booking.customer_id,v_booking.property_id,v_anchor,v_next,
    nullif(p_config->>'end_on','')::date,p_config->>'interval_unit',
    (p_config->>'interval_count')::integer,v_total,p_config->'items_template',v_label)
  returning id into v_id;
  update public.bookings set agreement_id = v_id,occurrence_on = v_occurrence,original_occurrence_on = v_occurrence,
    one_time = false,service_label_id = v_label where id = p_booking_id;
  if v_booking.status in ('confirmed','completed') then
    v_next_booking := public.crm_generate_next_job(p_booking_id,v_occurrence,v_next);
  end if;
  if nullif(p_config->>'staff_user_id','') is not null then
    update public.agreement_schedule_revisions set staff_user_id = (p_config->>'staff_user_id')::uuid,operation_id = p_operation_id
      where agreement_id = v_id;
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'agreement_id',v_id,
    'next_booking_id',v_next_booking);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'start_agreement',p_booking_id,p_config,v_result);
  return v_result;
end $$;


-- Read the promised first and regular items without deriving an amount from
-- a later draft. The same read runs again on the locked request at confirmation.
create function public.crm_first_visit_terms(p_booking_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.bookings; a public.recurring_agreements; s jsonb; v_source text;
  v_first jsonb; v_regular jsonb; v_frequency text; v_first_total numeric; v_regular_total numeric; v_has_items boolean;
  v_mowing boolean := false; v_locked boolean := false;
  v_review boolean := false; v_multiple boolean := false;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then raise exception 'Visit request not found' using errcode = 'P0002'; end if;
  s := b.accepted_quote_snapshot;
  v_source := s->>'source';
  select jsonb_agg(jsonb_build_object('kind',kind,'description',description,'amount',amount::text) order by created_at,id)
    into v_first from public.job_items where booking_id = b.id;
  v_has_items := v_first is not null;
  v_frequency := coalesce(s->>'frequency',b.frequency);
  v_multiple := (case when jsonb_typeof(s->'rows') = 'array' then jsonb_array_length(s->'rows') > 1 else false end) or v_source = 'sent_offer_review';
  v_review := v_source = 'legacy_quote_review';
  if not coalesce(v_multiple,false) then
    if v_source = 'sent_offer' and jsonb_array_length(s->'rows') = 1 then
      v_first := s->'items';
      v_regular := s->'rows'->0->'regularItems';
      v_frequency := s->'rows'->0->>'freq';
      v_mowing := coalesce((s->>'mowing')::boolean,false);
      v_locked := true;
    elsif v_source in ('phone_call','staff_agreed_quote','website_booking') and s ? 'regular_items' then
      v_first := s->'items';
      v_regular := s->'regular_items';
      v_mowing := coalesce((s->>'mowing')::boolean,false);
      v_locked := true;
    elsif exists(select 1 from public.intake_events where booking_id = b.id and source = 'website-booking') then
      if v_first is null and b.price_per_visit > 0 then
        s := public.crm_website_booking_terms(to_jsonb(b));
        v_source := s->>'source';
        v_frequency := s->>'frequency';
        v_first := s->'items';
        v_regular := s->'regular_items';
        v_mowing := true;
        v_locked := true;
      else
        v_source := 'website_booking_review';
        v_review := true;
      end if;
    elsif v_first is null and coalesce(b.job_total,b.first_visit_price,b.price_per_visit) is not null
        and not coalesce(v_review,false) then
      v_first := jsonb_build_array(jsonb_build_object('kind','service','description','Saved visit price',
        'amount',coalesce(b.job_total,b.first_visit_price,b.price_per_visit)::text));
    end if;
  end if;
  v_frequency := case when coalesce(b.one_time,false) and not v_locked then 'onetime'
    else case lower(replace(btrim(v_frequency),'-',''))
      when 'weekly' then 'weekly' when 'biweekly' then 'biweekly'
      when 'monthly' then 'monthly' else 'onetime' end end;
  if b.agreement_id is not null then
    select * into a from public.recurring_agreements where id = b.agreement_id;
    v_regular := a.items_template;
    v_frequency := case when a.interval_unit = 'month' then 'monthly'
      when a.interval_count = 2 then 'biweekly' else 'weekly' end;
    v_locked := true;
  end if;
  if v_first is not null then v_first_total := public.crm_validate_items(v_first); end if;
  if coalesce(v_regular,v_first) is not null then v_regular_total := public.crm_validate_items(coalesce(v_regular,v_first)); end if;
  return jsonb_build_object('source',v_source,'first_items',v_first,'regular_items',coalesce(v_regular,v_first),
    'first_total',v_first_total,'regular_total',v_regular_total,'frequency',v_frequency,
    'locked',v_locked,'mowing',v_mowing,'needs_review',coalesce(v_review,false),
    'items_changed',v_locked and v_has_items and not public.crm_visit_items_match(b.id,v_first),
    'multiple',coalesce(v_multiple,false));
end $$;

create function public.crm_visit_items_match(p_booking_id uuid,p_items jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select jsonb_agg(jsonb_build_array(kind,description,amount) order by kind,description,amount)
    from public.job_items where booking_id = p_booking_id)
  is not distinct from (select jsonb_agg(jsonb_build_array(kind,description,amount) order by kind,description,amount)
    from jsonb_to_recordset(p_items) as item(kind text,description text,amount numeric));
$$;

create function public.crm_confirm_first_visit(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_lead_version timestamptz,p_operation_id uuid,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.bookings; l public.leads; a public.recurring_agreements; label public.service_labels;
  v_result jsonb; v_terms jsonb; v_items jsonb; v_regular jsonb;
  v_date date := (p_request->>'date')::date; v_time text; v_frequency text; v_unit text; v_count integer;
  v_customer uuid := (p_request->>'customer_id')::uuid; v_property uuid := (p_request->>'property_id')::uuid;
  v_label uuid; v_address text;
  v_total numeric; v_standard numeric; v_next date;
begin
  v_result := public.crm_operation_reply(p_operation_id,'confirm_first_visit',p_booking_id,p_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select * into b from public.bookings where id = p_booking_id;
  if not found then raise exception 'Visit request not found' using errcode = 'P0002'; end if;
  if b.lead_id is not null then
    select * into l from public.leads where id = b.lead_id for update;
    if l.updated_at is distinct from p_lead_version then
      raise exception 'The inquiry changed. Review the first visit again.' using errcode = 'PT409';
    end if;
  end if;
  if b.agreement_id is not null then
    select * into a from public.recurring_agreements where id = b.agreement_id for update;
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if b.status <> 'pending' or b.updated_at is distinct from p_expected_updated_at then
    raise exception 'The request changed. Review the first visit again.' using errcode = 'PT409';
  end if;
  if v_date is null then raise exception 'Choose the confirmed visit date' using errcode = '22023'; end if;
  v_time := public.crm_service_arrival(p_request->>'arrival',v_date);
  v_terms := public.crm_first_visit_terms(b.id);
  if (v_terms->>'multiple')::boolean then
    raise exception 'This quote has multiple promised services. Keep it in review and resolve those terms before confirming a series.' using errcode = '23514';
  end if;
  if ((v_terms->>'needs_review')::boolean or (v_terms->>'items_changed')::boolean)
    and p_request->>'reviewed_terms' is distinct from 'true' then
    raise exception 'Review the original quoted work and confirm the agreed price first.' using errcode = '23514';
  end if;
  v_items := nullif(v_terms->'first_items','null'::jsonb);
  v_regular := nullif(v_terms->'regular_items','null'::jsonb);
  if v_items is null then
    raise exception 'Save the agreed visit items and price before confirming.' using errcode = '23514';
  end if;
  v_total := public.crm_validate_items(v_items);
  v_standard := public.crm_validate_items(v_regular);
  v_frequency := coalesce(p_request->>'frequency',v_terms->>'frequency');
  if v_frequency not in ('onetime','weekly','biweekly','monthly') then
    raise exception 'Choose the agreed visit cadence' using errcode = '22023';
  end if;
  if (v_terms->>'locked')::boolean and v_frequency is distinct from v_terms->>'frequency' then
    raise exception 'The accepted terms specify this cadence. Review a new quote before changing it.' using errcode = '23514';
  end if;
  v_label := coalesce(b.service_label_id,a.service_label_id);
  if v_label is null and (v_terms->>'mowing')::boolean then
    select id into v_label from public.service_labels where semantic_key = 'mowing' and retired_at is null;
  end if;
  v_label := coalesce(v_label,(p_request->>'label_id')::uuid);
  if v_label is not null then
    select * into label from public.service_labels where id = v_label for share;
    if not found or (label.retired_at is not null and b.service_label_id is distinct from label.id
      and a.service_label_id is distinct from label.id) then
      raise exception 'Choose an active service label' using errcode = '23514';
    end if;
  elsif v_frequency <> 'onetime' or (v_terms->>'mowing')::boolean then
    raise exception 'Choose a label for this service' using errcode = '22023';
  end if;

  v_customer := coalesce(b.customer_id,v_customer);
  v_property := coalesce(b.property_id,v_property);
  if (b.customer_id is not null and p_request->>'customer_id' is distinct from b.customer_id::text)
    or (b.property_id is not null and p_request->>'property_id' is distinct from b.property_id::text)
    or (l.customer_id is not null and l.customer_id is distinct from v_customer)
    or (l.property_id is not null and l.property_id is distinct from v_property) then
    raise exception 'This request already has a customer or property link. Review that identity first.' using errcode = '23514';
  end if;
  if v_customer is not null then
    perform 1 from public.customers where id = v_customer for update;
    if not found then raise exception 'Choose an existing customer' using errcode = '23514'; end if;
  end if;
  if v_property is not null then
    select address into v_address from public.properties where id = v_property and customer_id = v_customer for share;
    if not found then raise exception 'Choose a property belonging to the reviewed customer' using errcode = '23514'; end if;
  else
    v_address := nullif(btrim(p_request->>'address'),'');
  end if;
  if v_address is null or length(v_address) > 500 then
    raise exception 'Enter the reviewed property address' using errcode = '22023';
  end if;
  if (v_terms->>'locked')::boolean and lower(btrim(b.address)) is distinct from lower(v_address) then
    raise exception 'The property does not match the accepted terms. Review the quote for this address.' using errcode = '23514';
  end if;
  if a.id is not null and (a.customer_id is distinct from v_customer or a.property_id is distinct from v_property
    or a.status <> 'active' or a.generation_starts_on is not null or a.schedule_review_reason is not null) then
    raise exception 'Review the existing service schedule before confirming this visit.' using errcode = '23514';
  end if;
  if b.customer_id is null or b.property_id is null then
    v_result := public.crm_link_job(b.id,b.updated_at,gen_random_uuid(),v_customer,v_property,
      case when v_customer is null then jsonb_build_object('name',coalesce(nullif(btrim(p_request->>'name'),''),nullif(btrim(b.name),''),v_address),
        'phone',b.phone,'email',b.email) end,
      case when v_property is null then jsonb_build_object('address',v_address) end);
    v_customer := (v_result->>'customer_id')::uuid;
    v_property := (v_result->>'property_id')::uuid;
  end if;
  if a.id is not null then
    update public.recurring_agreements set service_label_id = v_label,anchor_on = v_date,
      next_on = case when next_on > v_date then next_on else public.crm_next_occurrence(v_date,v_date,interval_unit,interval_count) end
      where id = a.id;
  end if;
  if not public.crm_visit_items_match(b.id,v_items) then
    if b.payment_link is not null or b.amount_charged is not null
      or exists(select 1 from public.job_payments where booking_id = b.id) then
      raise exception 'Review the existing payment or payment link before changing this visit’s quoted items.' using errcode = '23514';
    end if;
    perform public.crm_replace_job_items(b.id,(select updated_at from public.bookings where id = b.id),gen_random_uuid(),v_items);
  end if;
  update public.bookings set address = v_address,service_label_id = v_label,one_time = v_frequency = 'onetime',
    price_per_visit = case when (v_terms->>'locked')::boolean
      then case when v_standard = trunc(v_standard) and v_standard <= 2147483647 then v_standard::integer end
      else b.price_per_visit end,
    first_visit_price = case when (v_terms->>'locked')::boolean
      then case when v_total = trunc(v_total) and v_total <= 2147483647 then v_total::integer end
      else b.first_visit_price end,
    frequency = v_frequency, accepted_quote_snapshot = coalesce(accepted_quote_snapshot,
      jsonb_build_object('source',coalesce(v_terms->>'source','staff_review'),'items',v_items,'regular_items',v_regular,
        'total',v_total,'currency','USD','frequency',v_frequency,'mowing',(v_terms->>'mowing')::boolean,'accepted_at',now()))
    where id = b.id returning * into b;
  perform public.crm_job_command(b.id,b.updated_at,gen_random_uuid(),'confirm',jsonb_build_object('date',v_date,'time',v_time));
  if v_frequency <> 'onetime' and a.id is null then
    v_unit := case when v_frequency = 'monthly' then 'month' else 'week' end;
    v_count := case when v_frequency = 'biweekly' then 2 else 1 end;
    v_next := public.crm_next_occurrence(v_date,v_date,v_unit,v_count);
    v_result := public.crm_start_agreement(b.id,(select updated_at from public.bookings where id = b.id),gen_random_uuid(),
      jsonb_build_object('anchor_on',v_date,'next_on',v_next,'interval_unit',v_unit,'interval_count',v_count,
        'items_template',v_regular,'staff_user_id',p_request->>'staff_user_id'));
    a.id := (v_result->>'agreement_id')::uuid;
  end if;
  if (v_terms->>'mowing')::boolean then
    perform public.crm_register_intro(b.id,v_items,v_regular);
  end if;
  if l.id is not null then
    update public.leads set customer_id = coalesce(customer_id,v_customer),
      property_id = coalesce(property_id,v_property),stage = 'booked' where id = l.id;
  end if;
  v_result := jsonb_build_object('booking_id',b.id,'customer_id',v_customer,'property_id',v_property,
    'agreement_id',a.id,'duplicate',false);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'confirm_first_visit',b.id,p_request,v_result);
  return v_result;
end $$;

revoke all on function public.crm_first_visit_terms(uuid),public.crm_visit_items_match(uuid,jsonb),
  public.crm_confirm_first_visit(uuid,timestamptz,timestamptz,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_first_visit_terms(uuid),public.crm_visit_items_match(uuid,jsonb),
  public.crm_confirm_first_visit(uuid,timestamptz,timestamptz,uuid,jsonb) to service_role;

-- Staff can preserve a phone agreement or explicit quote acceptance as a
-- request before final customer/property review. There is no scheduled visit yet.
create function public.crm_staff_quote_request(p_lead_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_terms jsonb,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.leads; b public.bookings; o public.sent_offers; v_result jsonb; v_source text;
  v_items jsonb; v_regular jsonb; v_total numeric; v_standard numeric; v_frequency text; v_address text; v_snapshot jsonb;
  v_request jsonb := jsonb_build_object('terms',p_terms,'actor',p_actor_email);
begin
  v_result := public.crm_operation_reply(p_operation_id,'staff_quote_request',p_lead_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Inquiry not found' using errcode = 'P0002'; end if;
  if l.updated_at is distinct from p_expected_updated_at then
    raise exception 'The inquiry changed. Review the price again.' using errcode = 'PT409';
  end if;
  select * into b from public.bookings where lead_id = l.id and status in ('pending','confirmed','completed')
    and schedule_revision_id is null order by created_at desc limit 1;
  if found then
    raise exception 'Open the existing visit to review its agreed terms.' using errcode = '23514';
  end if;
  select * into o from public.sent_offers where lead_id = l.id and state = 'sent' and replaced_by is null
    order by version desc limit 1;
  if found then
    if o.accepted_booking_id is not null then
      raise exception 'This sent quote already has an acceptance. Agree a new service or send a separate proposal.' using errcode = '23514';
    end if;
    if p_terms->>'offer_id' is distinct from o.id::text or jsonb_array_length(o.terms->'rows') <> 1 then
      raise exception 'Review the current sent offer before recording acceptance.' using errcode = 'PT409';
    end if;
    v_source := 'sent_offer';
    v_items := o.terms->'rows'->0->'firstItems';
    v_regular := o.terms->'rows'->0->'regularItems';
    v_frequency := o.terms->'rows'->0->>'freq';
    v_address := o.terms->>'address';
    v_snapshot := jsonb_build_object('source',v_source,'offer_id',o.id,'version',o.version,
      'rows',o.terms->'rows','mowing',o.terms->'mowing');
  else
    v_source := p_terms->>'source';
    if v_source not in ('phone_call','staff_agreed_quote') then
      raise exception 'Review the saved quote or phone agreement first.' using errcode = '22023';
    end if;
    v_items := p_terms->'items';
    v_regular := p_terms->'regular_items';
    v_frequency := p_terms->>'frequency';
    v_address := l.address;
    v_snapshot := jsonb_build_object('source',v_source,'regular_items',v_regular,'frequency',v_frequency,'mowing',p_terms->'mowing',
      'quote_draft',case when v_source = 'staff_agreed_quote' then p_terms->'quote_draft' end);
  end if;
  if v_frequency not in ('onetime','weekly','biweekly','monthly') or nullif(btrim(v_address),'') is null then
    raise exception 'Choose an agreed service and property address' using errcode = '22023';
  end if;
  v_total := public.crm_validate_items(v_items);
  v_standard := public.crm_validate_items(v_regular);
  v_snapshot := v_snapshot || jsonb_build_object('address',v_address,'items',v_items,
    'total',v_total,'currency','USD','accepted_at',now());
  v_result := public.record_intake_v3('staff-booking','staff-' || p_operation_id::text,md5(v_request::text),'{}',
    jsonb_build_object('name',coalesce(nullif(btrim(l.name),''),v_address),'phone',l.phone,'email',l.email,
      'address',v_address,'sq_ft',l.sq_ft,'one_time',v_frequency = 'onetime','frequency',v_frequency,
      'manual_quote',v_source = 'phone_call',
      'preferred_date',p_terms->>'date','price_per_visit',case when v_standard = trunc(v_standard) then v_standard::integer end,
      'first_visit_price',case when v_total = trunc(v_total) then v_total::integer end,
      'job_total',v_total,'accepted_quote_snapshot',v_snapshot,'map_screenshot_url',l.map_screenshot_url),l.id,array[]::text[]);
  insert into public.job_items(booking_id,kind,description,amount)
    select (v_result->>'booking_id')::uuid,value->>'kind',value->>'description',(value->>'amount')::numeric
    from jsonb_array_elements(v_items);
  if o.id is not null then
    update public.sent_offers set accepted_booking_id = (v_result->>'booking_id')::uuid where id = o.id;
  end if;
  update public.leads set board_column = 'booking_request',stage = 'booked',
    quote_status = case when v_source = 'phone_call' then quote_status else 'accepted' end,
    quote_accepted_at = case when v_source = 'phone_call' then quote_accepted_at else coalesce(quote_accepted_at,now()) end,
    accepted_quote_snapshot = case when v_source = 'phone_call' then accepted_quote_snapshot
      else coalesce(accepted_quote_snapshot,case when o.id is not null then o.terms->'draft' || jsonb_build_object('sent_offer',v_snapshot) else l.quote_draft end) end
    where id = l.id;
  insert into public.lead_activities(lead_id,kind,outcome,body,actor_email,data)
    values(l.id,'quote','staff_request','Agreed service recorded for first-visit review.',p_actor_email,
      jsonb_build_object('booking_id',v_result->>'booking_id','accepted_quote',v_snapshot));
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'staff_quote_request',l.id,v_request,v_result);
  return v_result;
end $$;

create function public.crm_record_booked_call(p_lead_id uuid,p_operation_id uuid,p_detail jsonb,
  p_terms jsonb,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.leads; b public.bookings; v_call jsonb; v_result jsonb; v_visit uuid; v_child uuid;
  v_request jsonb := jsonb_build_object('detail',p_detail,'actor',p_actor_email);
begin
  v_result := public.crm_operation_reply(p_operation_id,'booked_call',p_lead_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  v_call := public.crm_log_call(p_lead_id,p_operation_id,'booked',p_detail,p_actor_email);
  select * into l from public.leads where id = p_lead_id for update;
  select * into b from public.bookings where lead_id = l.id and status in ('pending','confirmed','completed')
    and schedule_revision_id is null order by created_at desc limit 1 for update;
  if found then
    v_visit := b.id;
    if b.status = 'pending' then
      -- Keep the customer’s preference and original accepted prices.
      update public.bookings set preferred_date = coalesce(preferred_date,(p_detail->>'first_visit_on')::date)
        where id = b.id;
      update public.leads set board_column = 'booking_request' where id = l.id;
    end if;
  else
    v_child := gen_random_uuid();
    v_result := public.crm_staff_quote_request(l.id,l.updated_at,v_child,
      p_terms || jsonb_build_object('date',p_detail->>'first_visit_on'),p_actor_email);
    v_visit := (v_result->>'booking_id')::uuid;
  end if;
  v_result := v_call || jsonb_build_object('booking_id',v_visit,
    'board_column',(select board_column from public.leads where id = l.id),
    'request_pending',exists(select 1 from public.bookings where id = v_visit and status = 'pending'),'duplicate',false);
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'booked_call',l.id,v_request,v_result);
  return v_result;
end $$;

revoke all on function public.crm_staff_quote_request(uuid,timestamptz,uuid,jsonb,text),
  public.crm_record_booked_call(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_staff_quote_request(uuid,timestamptz,uuid,jsonb,text),
  public.crm_record_booked_call(uuid,uuid,jsonb,jsonb,text) to service_role;

create or replace function public.update_lead_workflow(p_lead_id uuid,p_expected_updated_at timestamptz,
  p_patch jsonb,p_activity jsonb,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_kind text; v_new_status text; v_draft_revision boolean;
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
  v_draft_revision := v_lead.quote_status = 'accepted' and p_patch ? 'quote_draft';
  if v_lead.quote_status = 'accepted' and not v_draft_revision
    and p_patch->>'quote_status' not in ('accepted','canceled') then
    raise exception 'Accepted quote is immutable' using errcode = '23514';
  end if;
  if p_patch ? 'phone' and nullif(btrim(p_patch->>'phone'),'') is null then
    raise exception 'Phone is required' using errcode = '23514';
  end if;
  if p_patch ? 'address' and nullif(btrim(p_patch->>'address'),'') is null then
    raise exception 'Address is required' using errcode = '23514';
  end if;
  v_new_status := case when v_draft_revision then 'accepted' else coalesce(p_patch->>'quote_status',v_lead.quote_status) end;
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
    stage = case when v_draft_revision then stage when p_patch ? 'stage' then p_patch->>'stage' else stage end,
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
