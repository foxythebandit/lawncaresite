-- Honor the explicitly selected first visit, then resume the anchored cadence.
create or replace function public.crm_generate_next_job(p_booking_id uuid,p_after date,p_force_on date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_booking public.bookings; v_agreement public.recurring_agreements;
  v_next date; v_id uuid; v_item jsonb; v_total numeric; v_last_mow text;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.agreement_id is null then return null; end if;
  select * into v_agreement from public.recurring_agreements
    where id = v_booking.agreement_id for update;
  if v_agreement.status <> 'active' then return null; end if;
  v_next := coalesce(p_force_on,case when v_agreement.next_on > p_after
    then v_agreement.next_on else public.crm_next_occurrence(
      v_agreement.anchor_on,p_after,v_agreement.interval_unit,v_agreement.interval_count) end);
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
