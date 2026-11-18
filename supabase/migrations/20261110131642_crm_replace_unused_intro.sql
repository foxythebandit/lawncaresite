-- The original allocation remains historical. A separate pointer records
-- the actual visit that explicitly replaced an unused offer.
alter table public.crm_intro_grants add column replaced_by_booking_id uuid unique references public.bookings(id),
  add constraint crm_intro_replacement_closed check (replaced_by_booking_id is null
    or (consumed_on is not null and replaced_by_booking_id <> allocated_booking_id));

create or replace function public.crm_intro_before_complete(p_source uuid,p_booking_id uuid,p_completed_on date,p_review text,p_staff_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare g public.crm_intro_grants; b public.bookings; allocated public.bookings; source public.bookings;
  v_earlier uuid; v_earlier_on date; v_projected record; v_agreements uuid[]; v_message text; v_token text; v_intro numeric; v_move boolean := false;
  v_extra_review boolean := coalesce(p_review ~ '^(replace|separate):',false);
  v_items jsonb; v_blocked text; v_restored numeric; v_replace text; v_separate text;
  v_earlier_detail jsonb; v_resolution text;
begin
  if p_source is null then
    if v_extra_review then raise exception 'The introductory review changed.' using errcode = 'PT409'; end if;
    return null;
  end if;
  select * into g from public.crm_intro_grants where source_booking_id = p_source;
  select * into b from public.bookings where id = p_booking_id;
  select * into allocated from public.bookings where id = g.allocated_booking_id;
  select * into source from public.bookings where id = g.source_booking_id;
  if b.intro_parked_price is not null then
    raise exception 'This restored visit still has the earlier introductory price. Review its payment link or payment before recording completion.'
      using errcode = '23514';
  end if;
  if v_extra_review and (g.consumed_on is not null or b.extra_for_agreement_id is null
      or public.crm_intro_extra_matches(b.id,g.first_items)) then
    raise exception 'The introductory review changed.' using errcode = 'PT409';
  end if;
  if g.replaced_by_booking_id is not null then return null; end if;
  v_intro := public.crm_validate_items(g.first_items);

  if g.consumed_on is not null then
    if p_completed_on >= g.consumed_on then return null; end if;
    v_message := 'This completion is earlier than the visit that used the introductory price. Review both saved amounts before recording the actual date. Both prices will stay as recorded.';
  else
    select array_agg(id) into v_agreements from public.recurring_agreements
      where id = source.agreement_id or intro_source_booking_id = g.source_booking_id;
    select e.id,e.confirmed_date into v_earlier,v_earlier_on from public.bookings e where e.id <> b.id
      and e.customer_id = g.customer_id and e.property_id = b.property_id
      and e.status = 'confirmed' and e.confirmed_date < p_completed_on
      and (e.id = source.id or coalesce(e.agreement_id,e.extra_for_agreement_id) = any(v_agreements))
      order by e.confirmed_date,e.id limit 1;
    select a.id,s.revision_id,s.service_on into v_projected
      from unnest(v_agreements) a(id)
      cross join lateral public.crm_schedule_first_projected_slot(a.id,null,least(p_completed_on - 1,v_earlier_on)) s
      order by s.service_on,a.id limit 1;
    if v_earlier is not null or v_projected.id is not null then
      v_earlier_detail := case when v_projected.id is not null and
          (v_earlier_on is null or v_projected.service_on < v_earlier_on) then jsonb_build_object(
            'earlierOccurrence',jsonb_build_object('agreementId',v_projected.id,'revisionId',v_projected.revision_id,'on',v_projected.service_on))
          else jsonb_build_object('earlierVisitId',v_earlier) end;
    end if;
    if b.extra_for_agreement_id is not null and not public.crm_intro_extra_matches(b.id,g.first_items) then
      -- The agreement and grant are already locked by complete_job. Lock the
      -- holder too so its review and protection checks serialize with payments.
      select * into allocated from public.bookings where id = g.allocated_booking_id for update;
      select jsonb_agg(jsonb_build_object('kind',kind,'description',description,'amount',amount::text) order by created_at,id)
        into v_items from public.job_items where booking_id = b.id;
      v_blocked := case
        when public.crm_intro_fixed_price(allocated.id) then
          'The original introductory amount is protected by a payment, a payment link, or completed work. Review that visit before replacing the offer.'
        when not public.crm_visit_items_match(allocated.id,g.first_items)
          or allocated.status not in ('confirmed','canceled','skipped') then
          'Review the saved introductory items on the original priced visit before replacing the offer.'
        when v_earlier_detail is not null then
          'Resolve the earlier scheduled mow before replacing the introductory offer.'
      end;
      v_restored := case when v_blocked is null and allocated.status = 'confirmed'
        then public.crm_validate_items(g.standard_items) end;
      v_token := md5(jsonb_build_array(g.source_booking_id,g.first_items,g.standard_items,g.standard_price_override,
        allocated.id,allocated.updated_at,allocated.status,allocated.job_total,b.id,b.updated_at,b.job_total,v_items,
        p_completed_on,v_blocked,v_earlier_detail)::text);
      v_separate := 'separate:' || v_token;
      v_replace := case when v_blocked is null then 'replace:' || v_token end;
      if p_review is distinct from v_separate and (v_replace is null or p_review is distinct from v_replace) then
        raise exception 'This extra visit has different work items from the introductory offer. Review how they relate before marking it done.'
          using errcode = 'PT422', detail = (coalesce(v_earlier_detail,'{}'::jsonb) || jsonb_build_object(
            'extraReview',jsonb_build_object('separateToken',v_separate,'replaceToken',v_replace,'replaceBlocked',v_blocked,
              'priorBookingId',allocated.id,'originalItems',g.first_items,'originalAmount',v_intro,
              'visitItems',v_items,'visitAmount',b.job_total,'restoredAmount',v_restored)))::text;
      end if;
      if p_staff_user_id is null then
        raise exception 'Staff review is required to record how this extra relates to the offer.' using errcode = '22023';
      end if;
      v_resolution := 'separate_work';
      if p_review = v_replace then
        if allocated.status = 'confirmed' then
          perform public.crm_intro_reprice(allocated.id,g.standard_items,g.standard_price_override);
        else
          -- Retain canceled history, but restore the standard amount if a
          -- pause-canceled visit later returns to the schedule.
          update public.bookings set intro_parked_price = jsonb_build_object(
            'items',g.standard_items,'price_override',g.standard_price_override) where id = allocated.id;
        end if;
        update public.crm_intro_grants set consumed_on = p_completed_on,replaced_by_booking_id = b.id
          where source_booking_id = p_source;
        v_resolution := 'replaced';
      end if;
      return jsonb_build_object('disposition',v_resolution,'source_booking_id',g.source_booking_id,
        'prior_booking_id',allocated.id,'completed_booking_id',b.id,'original_items',g.first_items,
        'original_amount',v_intro,'visit_items',v_items,'visit_amount',b.job_total,
        'restored_amount',case when v_resolution = 'replaced' then v_restored end);
    end if;
    if v_earlier_detail is not null then
      raise exception 'Resolve the earlier scheduled mow first. Record its completion if it happened, or skip it if it did not.'
        using errcode = 'PT422', detail = v_earlier_detail::text;
    end if;
    if not public.crm_visit_items_match(allocated.id,g.first_items) then
      raise exception 'Review the saved introductory items on the visit that holds the introductory price.'
        using errcode = 'PT422', detail = jsonb_build_object('earlierVisitId',allocated.id)::text;
    end if;
    if allocated.id = b.id then
      update public.crm_intro_grants set consumed_on = p_completed_on where source_booking_id = p_source;
      return null;
    end if;
    if public.crm_intro_fixed_price(allocated.id) or public.crm_intro_fixed_price(b.id) then
      raise exception 'A payment or payment link fixes one of these amounts. Review it before moving the introductory price.'
        using errcode = 'PT422', detail = jsonb_build_object('earlierVisitId',allocated.id,'allocatedAmount',allocated.job_total,
          'allocatedOn',allocated.confirmed_date,'visitAmount',b.job_total,'introAmount',v_intro)::text;
    end if;
    v_move := true;
    v_message := 'This will be the first completed mow. Review the saved introductory items and both visit prices before moving the offer to this visit.';
  end if;

  v_token := md5(jsonb_build_array(g.source_booking_id,g.consumed_on,allocated.id,allocated.updated_at,
    coalesce(b.agreement_id,b.id),b.occurrence_on,b.confirmed_date,b.job_total,b.schedule_revision_id,p_completed_on,
    v_intro,v_move)::text);
  if p_review is distinct from v_token then
    raise exception '%', v_message using errcode = 'PT422',
      detail = jsonb_build_object('token',v_token,'allocatedAmount',allocated.job_total,
        'allocatedOn',coalesce(g.consumed_on,allocated.confirmed_date),'visitAmount',b.job_total,
        'introAmount',v_intro,'replacementAmount',case when v_move then public.crm_validate_items(g.standard_items) end,
        'move',v_move)::text;
  end if;
  if v_move then
    if not public.crm_intro_move(p_source,b.id,true) then
      raise exception 'The introductory price could not be moved. Review the saved amounts and payment links.' using errcode = '23514';
    end if;
    update public.crm_intro_grants set consumed_on = p_completed_on where source_booking_id = p_source;
  end if;
  return null;
end $$;

create or replace function public.crm_intro_before_complete(p_source uuid,p_booking_id uuid,p_completed_on date,p_review text)
returns void language sql security invoker set search_path = '' as $$
  select public.crm_intro_before_complete(p_source,p_booking_id,p_completed_on,p_review,null);
$$;

create or replace function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_completed_on date,p_intro_review text,p_staff_user_id uuid) returns jsonb language plpgsql security invoker
  set search_path = '' as $$
declare v_booking public.bookings; v_agreement_id uuid; v_next_id uuid;
  v_result jsonb; v_request jsonb; v_intro uuid; v_resolution jsonb;
begin
  if p_completed_on is null then raise exception 'Completion date required' using errcode = '22023'; end if;
  v_request := jsonb_strip_nulls(jsonb_build_object('completed_on',p_completed_on,'intro_review',p_intro_review,
    'staff_user_id',case when p_intro_review ~ '^(replace|separate):' then p_staff_user_id end));
  v_result := public.crm_operation_reply(p_operation_id,'complete_job',p_booking_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select coalesce(agreement_id,extra_for_agreement_id) into v_agreement_id from public.bookings where id = p_booking_id;
  if v_agreement_id is not null then
    perform 1 from public.recurring_agreements where id = v_agreement_id for update;
  end if;
  v_intro := public.crm_intro_for_visit(p_booking_id);
  if v_intro is not null then
    perform 1 from public.crm_intro_grants where source_booking_id = v_intro for update;
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
  if v_booking.agreement_id is null and not coalesce(v_booking.one_time,false)
    and nullif(btrim(v_booking.frequency),'') is not null
    and btrim(v_booking.frequency) !~* '^(one[ -]?time|single|once)$' then
    raise exception 'Link customer and start an agreement, or mark this visit one-time before completion'
      using errcode = '23514';
  end if;
  v_resolution := public.crm_intro_before_complete(v_intro,p_booking_id,p_completed_on,p_intro_review,p_staff_user_id);
  update public.bookings set status = 'completed',
    completed_at = p_completed_on::timestamp at time zone 'America/Chicago',
    completion_operation_id = p_operation_id where id = p_booking_id;
  if v_booking.agreement_id is not null then
    v_next_id := public.crm_generate_next_job(p_booking_id,v_booking.occurrence_on);
  elsif v_resolution->>'disposition' = 'separate_work' then
    perform public.crm_intro_sync(v_agreement_id);
  end if;
  v_result := jsonb_build_object('booking_id',p_booking_id,'next_booking_id',v_next_id,
    'duplicate',false);
  if v_resolution is not null then v_result := v_result || jsonb_build_object('intro_resolution',v_resolution); end if;
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'complete_job',p_booking_id,v_request,v_result);
  return v_result;
end $$;

create or replace function public.complete_job(p_booking_id uuid,p_expected_updated_at timestamptz,
  p_operation_id uuid,p_completed_on date,p_intro_review text) returns jsonb
language sql security invoker set search_path = '' as $$
  select public.complete_job(p_booking_id,p_expected_updated_at,p_operation_id,p_completed_on,p_intro_review,null);
$$;

revoke all on function public.crm_intro_before_complete(uuid,uuid,date,text,uuid),
  public.complete_job(uuid,timestamptz,uuid,date,text,uuid) from public,anon,authenticated;
grant execute on function public.crm_intro_before_complete(uuid,uuid,date,text,uuid),
  public.complete_job(uuid,timestamptz,uuid,date,text,uuid) to service_role;
