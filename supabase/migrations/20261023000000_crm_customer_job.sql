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
    nullif(btrim(p_job->>'notes'),''),false,v_first.attribution,v_first.gclid,v_first.utm_source,
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
