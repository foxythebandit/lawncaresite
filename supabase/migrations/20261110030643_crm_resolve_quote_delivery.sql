-- Keep staff closure distinct from a provider rejection or a sent receipt.
alter table public.sent_offers drop constraint sent_offers_state_check,
  add constraint sent_offers_state_check check (state in ('sending','unknown','failed','sent','review','closed'));

create function public.crm_finish_sent_offer_at(p_lead_id uuid,p_offer_id uuid,p_state text,
  p_provider_id text,p_actor_email text,p_verified_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.leads; o public.sent_offers; v_review boolean;
begin
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  select * into o from public.sent_offers where id = p_offer_id and lead_id = l.id for update;
  if not found then raise exception 'Quote attempt not found' using errcode = 'P0002'; end if;
  if o.sent_at is not null or o.state in ('failed','closed') then
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
    provider_id = p_provider_id,sent_at = coalesce(p_verified_at,clock_timestamp()) where id = o.id returning * into o;
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

create or replace function public.crm_finish_sent_offer(p_lead_id uuid,p_offer_id uuid,p_state text,
  p_provider_id text,p_actor_email text)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.crm_finish_sent_offer_at(p_lead_id,p_offer_id,p_state,p_provider_id,p_actor_email,null);
$$;

create function public.crm_review_expired_sent_offer(p_lead_id uuid,p_offer_id uuid,p_operation_id uuid,
  p_evidence text,p_provider_id text,p_sent_at timestamptz,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.leads; o public.sent_offers; v_result jsonb;
  v_evidence text := nullif(btrim(p_evidence),'');
  v_request jsonb := jsonb_build_object('lead_id',p_lead_id,'evidence',v_evidence,'provider_id',p_provider_id,
    'sent_at',p_sent_at,'actor',p_actor_email);
begin
  if v_evidence is null or length(v_evidence) > 1000 or p_actor_email is null
    or (p_provider_id is null) <> (p_sent_at is null)
    or (p_provider_id is not null and p_provider_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then
    raise exception 'Record the provider evidence and, for a verified send, its email ID and send time.' using errcode = '22023';
  end if;
  v_result := public.crm_operation_reply(p_operation_id,'expired_quote_review',p_offer_id,v_request);
  if v_result is not null then return v_result || '{"duplicate":true}'::jsonb; end if;
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  select * into o from public.sent_offers where id = p_offer_id and lead_id = l.id for update;
  if not found or o.state not in ('sending','unknown') then
    raise exception 'The quote attempt changed. Refresh to see its latest status.' using errcode = 'PT409';
  end if;
  if o.created_at > clock_timestamp() - interval '23 hours' then
    raise exception 'This attempt still has a safe retry window.' using errcode = '22023';
  end if;
  if p_sent_at is not null and (p_sent_at < o.created_at - interval '1 minute' or p_sent_at > clock_timestamp()) then
    raise exception 'Use the send time shown for this exact provider attempt.' using errcode = '22023';
  end if;
  if p_provider_id is null then
    update public.sent_offers set state = 'closed' where id = o.id;
    v_result := jsonb_build_object('state','closed','updated_at',l.updated_at);
  else
    v_result := public.crm_finish_sent_offer_at(l.id,o.id,'sent',p_provider_id,p_actor_email,p_sent_at);
  end if;
  insert into public.lead_activities(lead_id,kind,outcome,body,actor_email,data)
    values(l.id,'quote','delivery_review',
      case when p_provider_id is null then 'Closed an unconfirmed email attempt after provider review.'
        else 'Verified the original quote email in provider history.' end,p_actor_email,
      v_request || jsonb_build_object('offer_id',o.id,'state',v_result->>'state'));
  insert into public.crm_operations(id,action,target_id,request,result)
    values(p_operation_id,'expired_quote_review',o.id,v_request,v_result);
  return v_result;
end $$;

revoke all on function public.crm_finish_sent_offer_at(uuid,uuid,text,text,text,timestamptz),
  public.crm_review_expired_sent_offer(uuid,uuid,uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.crm_finish_sent_offer_at(uuid,uuid,text,text,text,timestamptz),
  public.crm_review_expired_sent_offer(uuid,uuid,uuid,text,text,timestamptz,text) to service_role;
