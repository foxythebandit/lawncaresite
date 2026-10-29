-- Log call "Booked" charges the first visit 30% off, like a website booking (Caelan, 29 Oct).
-- The app sends the plan price as a service line plus a "First visit 30% off" discount line, so
-- job_total is the first-visit price, and p_job.price_per_visit carries the plan price that later
-- visits charge. Without price_per_visit the function behaves as before (price = job total).
create or replace function public.crm_create_call_job(p_lead_id uuid,p_operation_id uuid,p_job jsonb,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_existing public.bookings; v_id uuid; v_item jsonb;
  v_total numeric; v_request jsonb; v_date date; v_freq text; v_first integer;
  v_open public.bookings; v_result jsonb; v_per numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('call-job:' || p_operation_id::text,0));
  v_request := jsonb_build_object('lead_id',p_lead_id,'job',p_job,'items',p_items);
  select * into v_existing from public.bookings where creation_operation_id = p_operation_id;
  if found then
    if v_existing.creation_request is distinct from v_request then
      raise exception 'Job operation conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('booking_id',v_existing.id,'duplicate',true);
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'call_job',p_lead_id,v_request);
  if v_result is not null then return v_result || jsonb_build_object('duplicate',true); end if;
  if coalesce(p_job->>'first_visit_on','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_job->>'frequency','') not in ('weekly','biweekly','monthly','onetime')
    or (p_job ? 'first_visit_price' and jsonb_typeof(p_job->'first_visit_price') <> 'number')
    or (p_job ? 'price_per_visit' and jsonb_typeof(p_job->'price_per_visit') <> 'number') then
    raise exception 'Invalid phone booking' using errcode = '22023';
  end if;
  v_date := (p_job->>'first_visit_on')::date;
  v_freq := p_job->>'frequency';
  v_first := (p_job->>'first_visit_price')::integer;
  v_per := (p_job->>'price_per_visit')::numeric;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  v_total := public.crm_validate_items(p_items);
  -- The plan price, when the items also carry a first-visit discount; else the job total as before.
  v_per := coalesce(v_per,v_total);
  -- An open request is confirmed; a lead that already has a confirmed or completed visit (its
  -- own, or one in the plan it started) keeps it, so a second Booked call never adds a job.
  select * into v_open from public.bookings where lead_id = p_lead_id and agreement_id is null
    and occurrence_on is null and status = 'pending' order by created_at desc limit 1 for update;
  if not found then
    select * into v_open from public.bookings where lead_id = p_lead_id
      and status in ('confirmed','completed') order by created_at limit 1;
  end if;
  if found then
    if v_open.status = 'pending' then
      update public.bookings set status = 'confirmed', confirmed_date = v_date,
        preferred_date = coalesce(preferred_date,v_date),
        price_per_visit = case when v_per = trunc(v_per) and v_per <= 2147483647
          then v_per::integer else price_per_visit end,
        first_visit_price = coalesce(v_first,first_visit_price),
        frequency = v_freq, one_time = v_freq = 'onetime', job_total = v_total,
        manual_quote = true -- priced by phone, like a new call job
        where id = v_open.id;
      delete from public.job_items where booking_id = v_open.id;
      for v_item in select value from jsonb_array_elements(p_items) loop
        insert into public.job_items(booking_id,kind,description,amount)
          values(v_open.id,v_item->>'kind',v_item->>'description',(v_item->>'amount')::numeric);
      end loop;
    end if;
    update public.leads set stage = 'booked' where id = p_lead_id;
    v_result := jsonb_build_object('booking_id',v_open.id,'reused',v_open.status);
    insert into public.crm_operations(id,action,target_id,request,result)
      values(p_operation_id,'call_job',p_lead_id,v_request,v_result);
    return v_result || jsonb_build_object('duplicate',false);
  end if;
  insert into public.bookings(name,phone,email,address,lead_id,customer_id,property_id,
    status,preferred_date,confirmed_date,price_per_visit,first_visit_price,creation_operation_id,
    creation_request,accepted_quote_snapshot,job_total,manual_quote,one_time,notify_failed,
    attribution,gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,
    gbraid,wbraid,google_campaign_id,google_adgroup_id,google_ad_id,
    sq_ft,map_screenshot_url,frequency)
  values(coalesce(nullif(btrim(v_lead.name),''),'Unknown'),v_lead.phone,v_lead.email,v_lead.address,
    p_lead_id,v_lead.customer_id,v_lead.property_id,'confirmed',v_date,v_date,
    case when v_per = trunc(v_per) and v_per <= 2147483647 then v_per::integer end,
    v_first,p_operation_id,v_request,
    jsonb_build_object('source','phone_call','items',p_items,'total',v_total,'currency','USD',
      'frequency',v_freq,'accepted_at',now()),
    v_total,true,v_freq = 'onetime',false,v_lead.attribution,v_lead.gclid,v_lead.utm_source,
    v_lead.utm_medium,v_lead.utm_campaign,v_lead.utm_term,v_lead.utm_content,
    v_lead.gbraid,v_lead.wbraid,v_lead.google_campaign_id,v_lead.google_adgroup_id,v_lead.google_ad_id,
    v_lead.sq_ft,v_lead.map_screenshot_url,v_freq)
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.job_items(booking_id,kind,description,amount)
      values(v_id,v_item->>'kind',v_item->>'description',(v_item->>'amount')::numeric);
  end loop;
  update public.leads set stage = 'booked' where id = p_lead_id;
  return jsonb_build_object('booking_id',v_id,'duplicate',false);
end $$;
revoke all on function public.crm_create_call_job(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_create_call_job(uuid,uuid,jsonb,jsonb) to service_role;
