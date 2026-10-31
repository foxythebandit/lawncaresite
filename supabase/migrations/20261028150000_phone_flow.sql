-- Press-1 phone flow (docs/ops-plan/PLAN.md 7.2, 7.2b, 7.3, 7.7b). Additive: builds on
-- 20261028120000_crm_board_phone.sql. Each Twilio webhook makes one RPC call.

-- Alerts the flow deliberately does not place (TEST lead, no valid phone, too old to ring).
alter table public.staff_alerts drop constraint staff_alerts_state_check;
alter table public.staff_alerts add constraint staff_alerts_state_check check (state in
  ('pending','sending','accepted','delivered','failed','unknown','disabled','skipped'));

-- Staff texts other than the intake alert itself (PLAN.md 7.3): map image, claimed, nobody
-- took it, booked online, call outcome, log-your-call reminder, dial-yourself number.
-- dedupe_key makes every send idempotent across Twilio retries and concurrent requests.
create table public.staff_texts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  event_id uuid references public.intake_events(id) on delete set null,
  kind text not null check (kind in ('map','claimed','not_taken','booked_online','outcome','reminder','call_now')),
  recipient text not null check (recipient ~ '^\+[1-9][0-9]{6,14}$'),
  body text not null default '',
  has_media boolean not null default false,
  state text not null default 'pending' check (state in ('pending','accepted','delivered','failed','unknown','disabled')),
  provider_sid text unique check (provider_sid is null or provider_sid ~ '^(SM|MM)[0-9a-f]{32}$'),
  provider_status text,
  error_code text,
  attempts integer not null default 1 check (attempts between 1 and 5),
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_texts_lead_idx on public.staff_texts(lead_id, created_at desc);
create index staff_texts_event_idx on public.staff_texts(event_id);
alter table public.staff_texts enable row level security;
revoke all on public.staff_texts from public, anon, authenticated;
grant select, insert, update on public.staff_texts to service_role;

-- Intake for a known lead (E10, 7.7 check 7). Same transaction as the intake: a claimed lead
-- gets no alert rows (the caller texts only the claimer); an unclaimed one gets the normal
-- sms + voice alert to both, worded as a booking request when the event has a booking.
create function public.record_intake_v3(p_source text,p_submission text,p_hash text,
  p_lead jsonb,p_booking jsonb,p_existing_lead uuid,p_recipients text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_event uuid; v_taken text;
begin
  v_result := public.record_intake_v2(p_source,p_submission,p_hash,p_lead,p_booking,p_existing_lead,p_recipients);
  if p_existing_lead is null or p_source = 'staff-booking' then return v_result; end if;
  select taken_by_phone into v_taken from public.leads where id = (v_result->>'lead_id')::uuid;
  v_result := v_result || jsonb_build_object('claimed_by_phone', v_taken);
  if (v_result->>'duplicate')::boolean or v_taken is not null then return v_result; end if;
  v_event := (v_result->>'event_id')::uuid;
  update public.intake_events set alert_version = 2 where id = v_event;
  if cardinality(p_recipients) = 2
    and p_recipients[1] is distinct from p_recipients[2]
    and p_recipients[1] ~ '^\+[1-9][0-9]{6,14}$'
    and p_recipients[2] ~ '^\+[1-9][0-9]{6,14}$' then
    insert into public.staff_alerts(event_id,recipient,channel)
      select v_event,recipient,channel
      from unnest(p_recipients) recipient cross join (values ('sms'),('voice')) channels(channel)
      on conflict (event_id,recipient,channel) do nothing;
  else
    -- Same as record_intake_v2: dispatch marks it disabled until two recipients are set.
    insert into public.staff_alerts(event_id,recipient,channel) values(v_event,'','voice')
      on conflict (event_id,recipient,channel) do nothing;
  end if;
  return v_result;
end $$;

-- One alert leg row per (event, staff phone). A row without a call SID may be (re)placed.
create function public.crm_alert_leg_start(p_lead_id uuid,p_event_id uuid,p_staff_name text,p_staff_phone text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_leg public.lead_calls;
begin
  insert into public.lead_calls(lead_id,event_id,leg,staff_name,staff_phone,to_phone)
    values(p_lead_id,p_event_id,'alert',p_staff_name,p_staff_phone,p_staff_phone)
    on conflict (event_id,staff_phone) where leg = 'alert' do nothing;
  select * into v_leg from public.lead_calls
    where event_id = p_event_id and staff_phone = p_staff_phone and leg = 'alert' for update;
  if v_leg.lead_id <> p_lead_id then raise exception 'Alert leg conflict' using errcode = '23505'; end if;
  if v_leg.call_sid is null then
    update public.lead_calls set status = 'queued', result = null, error_code = null, ended_at = null
      where id = v_leg.id;
  end if;
  return jsonb_build_object('id',v_leg.id,'call_sid',v_leg.call_sid);
end $$;

-- Twilio status callback for an alert leg (R5, E3, E6). Serialized per event, so when the
-- last leg finishes exactly one callback sees every leg finished and marks "Not taken" once
-- per event (no timers). Returns not_taken = true to the one caller that should text both.
create function public.crm_alert_leg_status(p_call_id uuid,p_call_sid text,p_status text,p_duration integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_leg public.lead_calls; v_event public.intake_events; v_done text[] := array['completed','busy','no-answer','failed','canceled'];
  v_lead uuid;
begin
  if p_status not in ('queued','initiated','ringing','in-progress','completed','busy','no-answer','failed','canceled')
    or coalesce(p_call_sid,'') !~ '^CA[0-9a-f]{32}$' then
    raise exception 'Unsupported call status' using errcode = '22023';
  end if;
  select * into v_leg from public.lead_calls where id = p_call_id and leg = 'alert';
  if not found or v_leg.call_sid is distinct from p_call_sid and v_leg.call_sid is not null then
    return jsonb_build_object('ignored',true,'not_taken',false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('alert-legs:' || coalesce(v_leg.event_id::text, v_leg.id::text),0));
  update public.lead_calls set call_sid = p_call_sid,
    status = case when status = any(v_done) then status else p_status end,
    answered_at = case when p_status = 'in-progress' then coalesce(answered_at, now()) else answered_at end,
    ended_at = case when p_status = any(v_done) then coalesce(ended_at, now()) else ended_at end,
    duration_seconds = case when p_status = any(v_done) and p_duration is not null then greatest(p_duration,0) else duration_seconds end,
    result = coalesce(result, case p_status when 'busy' then 'busy' when 'no-answer' then 'no_answer'
      when 'failed' then 'failed' when 'canceled' then 'canceled' when 'completed' then 'answered' end)
    where id = p_call_id returning * into v_leg;
  if not (p_status = any(v_done)) then return jsonb_build_object('ignored',false,'not_taken',false); end if;
  update public.staff_alerts set state = case when p_status = 'completed' then 'delivered' else 'failed' end,
    provider_status = p_status, updated_at = now()
    where provider_sid = p_call_sid and channel = 'voice';
  if v_leg.event_id is null
    or exists (select 1 from public.lead_calls where event_id = v_leg.event_id and leg = 'alert'
      and not (status = any(v_done)))
    or exists (select 1 from public.staff_alerts where event_id = v_leg.event_id and channel = 'voice'
      and state in ('pending','sending')) then
    return jsonb_build_object('ignored',false,'not_taken',false);
  end if;
  select * into v_event from public.intake_events where id = v_leg.event_id;
  update public.leads set not_taken_at = now()
    where id = v_leg.lead_id and taken_by_phone is null
      and (not_taken_at is null or not_taken_at < v_event.created_at)
    returning id into v_lead;
  if v_lead is null then return jsonb_build_object('ignored',false,'not_taken',false); end if;
  insert into public.lead_activities(lead_id,kind,outcome,data)
    values(v_lead,'alert','not_taken',jsonb_build_object('event_id',v_leg.event_id));
  return jsonb_build_object('ignored',false,'not_taken',true,'lead_id',v_lead,'event_id',v_leg.event_id);
end $$;

-- Keypress on an alert leg (7.2b, R1-R3). Digit 2 passes once; digit 1 runs the atomic
-- claim. Returns what the reply needs (winner, dial, the customer's number, the other legs
-- to cancel) in one round trip (R4).
create function public.crm_alert_press(p_call_id uuid,p_call_sid text,p_digit text,p_caller_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_leg public.lead_calls; v_claim jsonb; v_phone text; v_others jsonb; v_id uuid;
begin
  if p_digit not in ('1','2') or coalesce(p_call_sid,'') !~ '^CA[0-9a-f]{32}$'
    or (p_caller_id is not null and p_caller_id !~ '^\+[1-9][0-9]{6,14}$') then
    raise exception 'Unsupported keypress' using errcode = '22023';
  end if;
  select * into v_leg from public.lead_calls where id = p_call_id and leg = 'alert';
  if not found or (v_leg.call_sid is not null and v_leg.call_sid <> p_call_sid) then
    raise exception 'Unknown alert leg' using errcode = 'P0002';
  end if;
  if v_leg.call_sid is null then update public.lead_calls set call_sid = p_call_sid where id = p_call_id; end if;
  if p_digit = '2' then
    update public.lead_calls set result = 'passed', digits = '2'
      where id = p_call_id and (result is null or result = 'answered') returning id into v_id;
    if v_id is not null then
      insert into public.lead_activities(lead_id,kind,outcome,data)
        values(v_leg.lead_id,'alert','passed',jsonb_build_object('staff',coalesce(v_leg.staff_name,'staff'),'call_id',v_leg.id));
    end if;
    return jsonb_build_object('passed',true,'lead_id',v_leg.lead_id,'event_id',v_leg.event_id);
  end if;
  v_claim := public.crm_claim_lead(v_leg.lead_id,coalesce(nullif(btrim(v_leg.staff_name),''),v_leg.staff_phone),
    v_leg.staff_phone,p_call_sid);
  update public.lead_calls set digits = '1',
    result = case when (v_claim->>'won')::boolean then 'claimed' else 'lost_race' end,
    caller_id = case when (v_claim->>'dial')::boolean then p_caller_id else caller_id end
    where id = p_call_id;
  select phone into v_phone from public.leads where id = v_leg.lead_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'call_sid',call_sid,'status',status,'staff_phone',staff_phone)),'[]'::jsonb)
    into v_others from public.lead_calls
    where event_id = v_leg.event_id and leg = 'alert' and id <> p_call_id and call_sid is not null
      and status not in ('completed','busy','no-answer','failed','canceled');
  return v_claim || jsonb_build_object('passed',false,'lead_id',v_leg.lead_id,'event_id',v_leg.event_id,
    'staff_name',v_leg.staff_name,'staff_phone',v_leg.staff_phone,'customer_phone',v_phone,'others',v_others);
end $$;

-- Dial action of the winner's leg (7.2, E4, R11). Wraps crm_finish_customer_leg (applied once
-- per DialCallSid) and attaches a recording that arrived before the dial result.
create function public.crm_phone_finish_dial(p_alert_call_id uuid,p_parent_call_sid text,
  p_dial_call_sid text,p_result text,p_duration integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_leg public.lead_calls; v_to text; v_finish jsonb; v_rec text; v_rec_secs integer;
begin
  select * into v_leg from public.lead_calls where id = p_alert_call_id and leg = 'alert' for update;
  if not found or v_leg.call_sid is distinct from p_parent_call_sid then
    raise exception 'Unknown alert leg' using errcode = 'P0002';
  end if;
  select coalesce(phone,'') into v_to from public.leads where id = v_leg.lead_id;
  v_finish := public.crm_finish_customer_leg(v_leg.lead_id,p_dial_call_sid,p_parent_call_sid,
    v_leg.staff_name,v_leg.staff_phone,v_to,v_leg.caller_id,p_result,p_duration);
  if v_leg.recording_sid is not null then
    v_rec := v_leg.recording_sid; v_rec_secs := v_leg.recording_duration_seconds;
    update public.lead_calls set recording_sid = null, recording_duration_seconds = null where id = v_leg.id;
    update public.lead_calls set recording_sid = v_rec, recording_duration_seconds = v_rec_secs
      where call_sid = p_dial_call_sid and leg = 'customer' and recording_sid is null;
  end if;
  return v_finish;
end $$;

-- Recording status callback (P3, R13). Stored on the customer leg; if the dial result has not
-- arrived yet, held on the alert leg until crm_phone_finish_dial moves it.
create function public.crm_phone_recording(p_alert_call_id uuid,p_call_sid text,p_recording_sid text,p_duration integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_leg public.lead_calls; v_id uuid;
begin
  if coalesce(p_recording_sid,'') !~ '^RE[0-9a-f]{32}$' or coalesce(p_call_sid,'') !~ '^CA[0-9a-f]{32}$' then
    raise exception 'Unsupported recording' using errcode = '22023';
  end if;
  select * into v_leg from public.lead_calls where id = p_alert_call_id and leg = 'alert' for update;
  if not found then raise exception 'Unknown alert leg' using errcode = 'P0002'; end if;
  if exists (select 1 from public.lead_calls where recording_sid = p_recording_sid) then
    return jsonb_build_object('stored',false);
  end if;
  update public.lead_calls set recording_sid = p_recording_sid, recording_duration_seconds = greatest(coalesce(p_duration,0),0)
    where id = (select id from public.lead_calls where leg = 'customer' and parent_call_sid = v_leg.call_sid
      and recording_sid is null and p_call_sid in (call_sid, parent_call_sid) order by created_at desc limit 1)
    returning id into v_id;
  if v_id is null then
    update public.lead_calls set recording_sid = p_recording_sid, recording_duration_seconds = greatest(coalesce(p_duration,0),0)
      where id = v_leg.id and recording_sid is null returning id into v_id;
  end if;
  return jsonb_build_object('stored',v_id is not null,'call_id',v_id);
end $$;

-- "Log your call" reminders due 30 minutes after a talked call (S20, R6). Claims each due lead
-- once (conditional update, skip locked) and returns who to text.
create function public.crm_phone_due_reminders(p_limit integer)
returns table(lead_id uuid,needs_call_log_at timestamptz,taken_by_phone text)
language sql security invoker set search_path = '' as $$
  update public.leads l set call_log_reminded_at = now()
  from (select id from public.leads
    where needs_call_log_at < now() - interval '30 minutes' and call_log_reminded_at is null
      and taken_by_phone is not null
    order by needs_call_log_at limit least(greatest(coalesce(p_limit,20),1),50)
    for update skip locked) due
  where l.id = due.id
  returning l.id, l.needs_call_log_at, l.taken_by_phone
$$;

revoke all on function public.record_intake_v3(text,text,text,jsonb,jsonb,uuid,text[]),
  public.crm_alert_leg_start(uuid,uuid,text,text),public.crm_alert_leg_status(uuid,text,text,integer),
  public.crm_alert_press(uuid,text,text,text),public.crm_phone_finish_dial(uuid,text,text,text,integer),
  public.crm_phone_recording(uuid,text,text,integer),public.crm_phone_due_reminders(integer)
  from public,anon,authenticated;
grant execute on function public.record_intake_v3(text,text,text,jsonb,jsonb,uuid,text[]),
  public.crm_alert_leg_start(uuid,uuid,text,text),public.crm_alert_leg_status(uuid,text,text,integer),
  public.crm_alert_press(uuid,text,text,text),public.crm_phone_finish_dial(uuid,text,text,text,integer),
  public.crm_phone_recording(uuid,text,text,integer),public.crm_phone_due_reminders(integer)
  to service_role;
