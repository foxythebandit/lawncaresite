-- Only events created through v2 may expand a pending intent into voice alerts.
alter table public.leads
  add column gbraid text,
  add column wbraid text,
  add column google_campaign_id text,
  add column google_adgroup_id text,
  add column google_ad_id text;
alter table public.bookings
  add column gbraid text,
  add column wbraid text,
  add column google_campaign_id text,
  add column google_adgroup_id text,
  add column google_ad_id text;
alter table public.intake_events add column alert_version smallint not null default 1
  check (alert_version in (1,2));

create function public.record_intake_v2(p_source text,p_submission text,p_hash text,
  p_lead jsonb,p_booking jsonb,p_existing_lead uuid,p_recipients text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_event uuid;
begin
  v_result := public.record_intake(p_source,p_submission,p_hash,p_lead,p_booking,p_existing_lead);
  if (v_result->>'duplicate')::boolean then return v_result; end if;
  v_event := (v_result->>'event_id')::uuid;
  if v_result->>'booking_id' is not null then
    update public.bookings b set
      gbraid = l.gbraid,wbraid = l.wbraid,
      google_campaign_id = l.google_campaign_id,
      google_adgroup_id = l.google_adgroup_id,
      google_ad_id = l.google_ad_id
    from public.leads l
    where b.id = (v_result->>'booking_id')::uuid and l.id = b.lead_id;
  end if;
  if p_existing_lead is not null then
    -- A later booking of the same inquiry does not trigger another new-lead alert.
    delete from public.staff_alerts where event_id = v_event and recipient = '';
    return v_result;
  end if;
  update public.intake_events set alert_version = 2 where id = v_event;
  insert into public.staff_alerts(event_id,recipient,channel)
    values(v_event,'','voice');
  if cardinality(p_recipients) = 2
    and p_recipients[1] is distinct from p_recipients[2]
    and p_recipients[1] ~ '^\+[1-9][0-9]{6,14}$'
    and p_recipients[2] ~ '^\+[1-9][0-9]{6,14}$' then
    insert into public.staff_alerts(event_id,recipient,channel)
      select v_event,recipient,channel
      from unnest(p_recipients) recipient cross join (values ('sms'),('voice')) channels(channel);
    delete from public.staff_alerts where event_id = v_event and recipient = '';
  end if;
  return v_result;
end $$;
revoke all on function public.record_intake_v2(text,text,text,jsonb,jsonb,uuid,text[])
  from public,anon,authenticated;
grant execute on function public.record_intake_v2(text,text,text,jsonb,jsonb,uuid,text[]) to service_role;
