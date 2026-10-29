-- Lead board, call log and press-1 phone flow (docs/ops-plan/PLAN.md sections 3, 4 and 7).
-- Additive only: existing leads keep every value and start in the New column. The one-time
-- placement of existing leads (S8) is scripts/place-leads-on-board.mjs, run after review.

-- Six characters from the random bytes of a v4 UUID (strong randomness; 256 is a multiple of 32).
create function public.crm_short_code() returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',1 + get_byte(b,i) % 32,1),'' order by i)
  from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0,5) i
$$;

alter table public.leads
  add column board_column text not null default 'new' check (board_column in
    ('new','in_talks','quoted','booking_request','customer','closed')),
  add column board_moved_at timestamptz,
  add column call_attempts integer not null default 0 check (call_attempts >= 0),
  add column quoted_reason text check (quoted_reason in ('start_later','budget','thinking',
    'checking_with_someone','comparing_quotes','wants_lower_price','other')),
  add column closed_reason text check (closed_reason in ('price','has_someone_else','never_responded',
    'outside_area','just_checking_prices','spam_duplicate','bad_number','other')),
  add column check_back_on date,
  add column first_visit_on date,
  add column customer_canceled_at timestamptz,
  add column phone_price_cents integer check (phone_price_cents between 0 and 10000000),
  add column phone_frequency text check (phone_frequency in ('weekly','biweekly','monthly','onetime')),
  add column phone_price_at timestamptz,
  add column website_price_cents integer check (website_price_cents between 0 and 10000000),
  add column website_first_visit_cents integer check (website_first_visit_cents between 0 and 10000000),
  add column website_frequency text check (website_frequency in ('weekly','biweekly','monthly','onetime')),
  add column website_price_at timestamptz,
  add column lawn_tracing jsonb check (lawn_tracing is null or (jsonb_typeof(lawn_tracing) = 'array'
    and pg_column_size(lawn_tracing) <= 200000)),
  add column quote_emailed_at timestamptz,
  add column short_code text,
  add column taken_by text check (taken_by is null or length(taken_by) between 1 and 40),
  add column taken_by_phone text check (taken_by_phone is null or taken_by_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column taken_at timestamptz,
  add column customer_dial_call_sid text,
  add column not_taken_at timestamptz,
  add column needs_call_log_at timestamptz,
  add column call_log_reminded_at timestamptz,
  add constraint leads_taken_together check ((taken_by is null) = (taken_by_phone is null));

-- record_intake inserts through jsonb_populate_record, which passes NULL rather than column
-- defaults, so fill the new NOT NULL columns here.
create function public.crm_leads_board_defaults() returns trigger language plpgsql
  set search_path = '' as $$
begin
  new.board_column := coalesce(new.board_column, 'new');
  new.call_attempts := coalesce(new.call_attempts, 0);
  return new;
end $$;
create trigger crm_leads_board_defaults before insert on public.leads
  for each row execute function public.crm_leads_board_defaults();

-- Backfill short links without touching updated_at on existing leads.
alter table public.leads disable trigger crm_leads_touch;
do $$
declare v_id uuid; v_code text;
begin
  for v_id in select id from public.leads where short_code is null loop
    loop
      v_code := public.crm_short_code();
      exit when not exists (select 1 from public.leads where short_code = v_code);
    end loop;
    update public.leads set short_code = v_code where id = v_id;
  end loop;
end $$;
update public.leads l set quote_emailed_at = a.at
  from (select lead_id, max(occurred_at) as at from public.lead_activities
    where kind = 'quote' and outcome = 'emailed' group by lead_id) a
  where a.lead_id = l.id;
alter table public.leads enable trigger crm_leads_touch;
alter table public.leads alter column short_code set not null;
create unique index leads_short_code_key on public.leads(short_code);
create index leads_board_idx on public.leads(board_column, created_at desc);
create index leads_needs_call_log_idx on public.leads(needs_call_log_at)
  where needs_call_log_at is not null and call_log_reminded_at is null;

create function public.crm_leads_short_code() returns trigger language plpgsql
  set search_path = '' as $$
declare v_code text;
begin
  if new.short_code is null then
    loop
      v_code := public.crm_short_code();
      exit when not exists (select 1 from public.leads where short_code = v_code);
    end loop;
    new.short_code := v_code;
  end if;
  return new;
end $$;
create trigger crm_leads_short_code before insert on public.leads
  for each row execute function public.crm_leads_short_code();

-- History rows from the board, alert calls and bridged customer calls. operation_id makes
-- Log call retries idempotent.
alter table public.lead_activities drop constraint lead_activities_kind_check;
alter table public.lead_activities add constraint lead_activities_kind_check
  check (kind in ('note','call','stage','quote','follow_up','board','alert','phone'));
alter table public.lead_activities add column operation_id uuid unique;

-- One row per Twilio call leg: each staff alert ring and each bridged customer call.
create table public.lead_calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  event_id uuid references public.intake_events(id) on delete set null,
  leg text not null check (leg in ('alert','customer')),
  staff_name text,
  staff_phone text not null check (staff_phone ~ '^\+[1-9][0-9]{6,14}$'),
  to_phone text not null,
  caller_id text,
  call_sid text unique check (call_sid is null or call_sid ~ '^CA[0-9a-f]{32}$'),
  parent_call_sid text,
  status text not null default 'queued',
  result text check (result in ('answered','busy','no_answer','failed','canceled','passed','claimed',
    'lost_race','talked','hung_up_early')),
  digits text check (digits is null or digits ~ '^[0-9*#]{1,4}$'),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  recording_sid text unique check (recording_sid is null or recording_sid ~ '^RE[0-9a-f]{32}$'),
  recording_duration_seconds integer check (recording_duration_seconds >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_calls_lead_idx on public.lead_calls(lead_id, created_at desc);
create unique index lead_calls_alert_leg_key on public.lead_calls(event_id, staff_phone)
  where leg = 'alert';
create trigger crm_lead_calls_touch before insert or update on public.lead_calls
  for each row execute function public.crm_touch_updated_at();
alter table public.lead_calls enable row level security;
revoke all on public.lead_calls from public, anon, authenticated;
grant select, insert, update on public.lead_calls to service_role;

-- Automatic board moves. Explicit moves in the same statement always win; automatic moves
-- only go forward (S1).
create function public.crm_leads_board_sync() returns trigger language plpgsql
  set search_path = '' as $$
begin
  if new.stage is distinct from old.stage and new.board_column = old.board_column then
    if new.stage = 'lost' then
      if new.board_column = 'customer' then
        new.customer_canceled_at := coalesce(new.customer_canceled_at, now());
      else
        new.board_column := 'closed';
        new.closed_reason := coalesce(new.closed_reason,'other');
      end if;
    elsif new.stage = 'quoted' and new.board_column in ('new','in_talks') then
      new.board_column := 'quoted';
    end if;
  end if;
  if new.board_column is distinct from old.board_column then new.board_moved_at := now(); end if;
  return new;
end $$;
create trigger crm_leads_board_sync before update on public.leads
  for each row execute function public.crm_leads_board_sync();

create function public.crm_bookings_board_sync() returns trigger language plpgsql
  set search_path = '' as $$
begin
  if new.lead_id is null then return null; end if;
  if new.status in ('confirmed','completed')
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    -- Plan visits keep a customer current, but never pull a card staff closed back out.
    update public.leads set board_column = 'customer', customer_canceled_at = null
      where id = new.lead_id and (board_column <> 'customer' or customer_canceled_at is not null)
        and not (new.agreement_id is not null and board_column = 'closed');
  elsif tg_op = 'INSERT' and new.status = 'pending' and new.agreement_id is null then
    -- Online booking, emailed-quote booking or a staff job still waiting for a date.
    update public.leads set board_column = 'booking_request'
      where id = new.lead_id and board_column in ('new','in_talks','quoted','closed');
  elsif tg_op = 'UPDATE' and new.status = 'canceled' and old.status is distinct from 'canceled'
    and not exists (select 1 from public.bookings where lead_id = new.lead_id and id <> new.id
      and status in ('pending','confirmed')) then
    -- Customers keep their card with a Canceled chip (S9); a dropped request goes back to Quoted.
    update public.leads set
      customer_canceled_at = case when board_column = 'customer' then coalesce(customer_canceled_at, now())
        else customer_canceled_at end,
      board_column = case when board_column = 'booking_request' then 'quoted' else board_column end
      where id = new.lead_id and board_column in ('customer','booking_request');
  end if;
  return null;
end $$;
create trigger crm_bookings_board_sync after insert or update of status on public.bookings
  for each row execute function public.crm_bookings_board_sync();

create function public.crm_activities_board_sync() returns trigger language plpgsql
  set search_path = '' as $$
begin
  if new.kind = 'quote' and new.outcome = 'emailed' then
    update public.leads set quote_emailed_at = new.occurred_at,
      board_column = case when board_column in ('new','in_talks') then 'quoted' else board_column end
      where id = new.lead_id;
  end if;
  return null;
end $$;
create trigger crm_activities_board_sync after insert on public.lead_activities
  for each row execute function public.crm_activities_board_sync();

-- Drag on the board. Closed needs a reason; Quoted takes an optional reason and check-back date.
create function public.crm_move_lead(p_lead_id uuid,p_column text,p_detail jsonb,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_from text; v_reason text; v_check date;
begin
  if p_column not in ('new','in_talks','quoted','booking_request','customer','closed')
    or p_actor_email is null or p_detail is null or jsonb_typeof(p_detail) <> 'object'
    or p_detail - 'closed_reason' - 'quoted_reason' - 'check_back_on' <> '{}'::jsonb then
    raise exception 'Unsupported board move' using errcode = '22023';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  v_from := v_lead.board_column;
  v_reason := case when p_column = 'closed' then p_detail->>'closed_reason'
    when p_column = 'quoted' then p_detail->>'quoted_reason' end;
  if p_column = 'closed' and v_reason is null then
    raise exception 'Closed needs a reason' using errcode = '23514';
  end if;
  v_check := nullif(p_detail->>'check_back_on','')::date;
  update public.leads set board_column = p_column,
    closed_reason = case when p_column = 'closed' then v_reason else null end,
    quoted_reason = case when p_column = 'quoted' and v_reason is not null then v_reason else quoted_reason end,
    check_back_on = case when p_detail ? 'check_back_on' then v_check else check_back_on end,
    customer_canceled_at = case when p_column = 'customer' then customer_canceled_at else null end
    where id = p_lead_id returning * into v_lead;
  if v_from is distinct from p_column then
    insert into public.lead_activities(lead_id,kind,outcome,actor_email,data)
      values(p_lead_id,'board',p_column,p_actor_email,
        jsonb_strip_nulls(jsonb_build_object('from',v_from,'reason',v_reason,'check_back_on',v_check)));
  end if;
  return jsonb_build_object('lead_id',p_lead_id,'updated_at',v_lead.updated_at,'board_column',v_lead.board_column);
end $$;

-- Log call sheet v2 (PLAN.md 3.2). One statement per outcome; retries with the same
-- operation ID return the first result.
create function public.crm_log_call(p_lead_id uuid,p_operation_id uuid,p_outcome text,
  p_detail jsonb,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_prior public.lead_activities; v_activity uuid; v_column text;
  v_price integer; v_freq text; v_first date; v_check date; v_reason text; v_note text;
  v_talked boolean;
begin
  if p_operation_id is null or p_actor_email is null or p_detail is null
    or jsonb_typeof(p_detail) <> 'object'
    or p_detail - 'price_cents' - 'frequency' - 'first_visit_on' - 'check_back_on'
      - 'reason' - 'note' <> '{}'::jsonb
    or p_outcome not in ('no_answer','voicemail','bad_number','booked','yes_tbd','not_now','no') then
    raise exception 'Unsupported call log' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('log-call:' || p_operation_id::text,0));
  select * into v_prior from public.lead_activities where operation_id = p_operation_id;
  if found then
    if v_prior.lead_id <> p_lead_id or v_prior.outcome <> p_outcome then
      raise exception 'Call log operation conflict' using errcode = '23505';
    end if;
    select * into v_lead from public.leads where id = p_lead_id;
    return jsonb_build_object('lead_id',p_lead_id,'updated_at',v_lead.updated_at,
      'board_column',v_lead.board_column,'activity_id',v_prior.id,'duplicate',true);
  end if;
  v_price := case when jsonb_typeof(p_detail->'price_cents') = 'number' then (p_detail->>'price_cents')::integer end;
  v_freq := nullif(p_detail->>'frequency','');
  v_first := nullif(p_detail->>'first_visit_on','')::date;
  v_check := nullif(p_detail->>'check_back_on','')::date;
  v_reason := nullif(p_detail->>'reason','');
  v_note := nullif(btrim(coalesce(p_detail->>'note','')),'');
  v_talked := p_outcome in ('booked','yes_tbd','not_now','no');
  if (p_detail ? 'price_cents' and (v_price is null or v_price <= 0 or v_price > 10000000))
    or (p_outcome in ('booked','yes_tbd','not_now') and v_price is null)
    or (v_freq is not null and v_freq not in ('weekly','biweekly','monthly','onetime'))
    or (p_outcome in ('booked','yes_tbd') and v_freq is null)
    or (p_outcome = 'booked' and v_first is null)
    or (p_outcome = 'not_now' and (v_check is null or v_reason is null or v_reason not in
      ('start_later','budget','thinking','checking_with_someone','comparing_quotes','wants_lower_price','other')))
    or (p_outcome = 'no' and (v_reason is null or v_reason not in ('price','has_someone_else',
      'never_responded','outside_area','just_checking_prices','spam_duplicate','bad_number','other')))
    or (p_outcome not in ('not_now','no') and v_reason is not null)
    or (not v_talked and (v_price is not null or v_freq is not null or v_check is not null))
    or (p_outcome <> 'booked' and v_first is not null)
    or length(coalesce(v_note,'')) > 2000 then
    raise exception 'Call log is missing or has invalid details' using errcode = '23514';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  v_column := case p_outcome when 'no_answer' then 'in_talks' when 'voicemail' then 'in_talks'
    when 'bad_number' then 'closed' when 'booked' then 'customer' when 'yes_tbd' then 'booking_request'
    when 'not_now' then 'quoted' when 'no' then 'closed' end;
  update public.leads set board_column = v_column,
    call_attempts = call_attempts + case when p_outcome in ('no_answer','voicemail') then 1 else 0 end,
    contact_outcome = case when p_outcome = 'bad_number' then 'wrong_number'
      when v_talked then 'reached' else 'no_answer' end,
    stage = case when stage = 'booked' then stage
      when p_outcome in ('bad_number','no') then 'lost'
      when p_outcome in ('not_now','yes_tbd') then 'quoted'
      when p_outcome in ('no_answer','voicemail') and stage = 'new' then 'contacted'
      else stage end,
    closed_reason = case when p_outcome = 'bad_number' then 'bad_number'
      when p_outcome = 'no' then v_reason else null end,
    quoted_reason = case when p_outcome = 'not_now' then v_reason else quoted_reason end,
    check_back_on = case when p_outcome in ('not_now','yes_tbd') then v_check else check_back_on end,
    first_visit_on = case when p_outcome = 'booked' then v_first else first_visit_on end,
    customer_canceled_at = case when p_outcome = 'booked' then null else customer_canceled_at end,
    phone_price_cents = coalesce(v_price,phone_price_cents),
    phone_frequency = case when v_price is not null then v_freq else phone_frequency end,
    phone_price_at = case when v_price is not null then now() else phone_price_at end,
    needs_call_log_at = null
    where id = p_lead_id returning * into v_lead;
  insert into public.lead_activities(lead_id,kind,outcome,body,actor_email,data,operation_id)
    values(p_lead_id,'call',p_outcome,v_note,p_actor_email,
      jsonb_strip_nulls(jsonb_build_object('price_cents',v_price,'frequency',v_freq,
        'first_visit_on',v_first,'check_back_on',v_check,'reason',v_reason,'column',v_column)),
      p_operation_id)
    returning id into v_activity;
  return jsonb_build_object('lead_id',p_lead_id,'updated_at',v_lead.updated_at,
    'board_column',v_lead.board_column,'activity_id',v_activity,'duplicate',false);
end $$;

-- Press 1 (PLAN.md 7.2b, R1/R2). One conditional update decides the winner; the winner's own
-- leg is the only one allowed to dial the customer, and a retry of that leg dials again only
-- because Twilio did not receive the first reply.
create function public.crm_claim_lead(p_lead_id uuid,p_staff_name text,p_staff_phone text,
  p_call_sid text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_name text; v_phone text; v_dial_sid text; v_won boolean := false; v_dial boolean := false;
begin
  if p_staff_phone !~ '^\+[1-9][0-9]{6,14}$' or coalesce(p_call_sid,'') !~ '^CA[0-9a-f]{32}$'
    or nullif(btrim(p_staff_name),'') is null then
    raise exception 'Unsupported claim' using errcode = '22023';
  end if;
  update public.leads set taken_by = p_staff_name, taken_by_phone = p_staff_phone, taken_at = now(),
    customer_dial_call_sid = p_call_sid
    where id = p_lead_id and taken_by_phone is null
    returning taken_by into v_name;
  if found then
    v_won := true; v_dial := true;
    insert into public.lead_activities(lead_id,kind,outcome,actor_email,data)
      values(p_lead_id,'alert','taken',null,jsonb_build_object('staff',p_staff_name,'call_sid',p_call_sid));
  else
    select taken_by,taken_by_phone,customer_dial_call_sid into v_name,v_phone,v_dial_sid
      from public.leads where id = p_lead_id;
    if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
    v_won := v_phone = p_staff_phone;
    v_dial := v_won and v_dial_sid = p_call_sid;
  end if;
  return jsonb_build_object('won',v_won,'dial',v_dial,'taken_by',v_name);
end $$;

-- Result of the bridged customer leg (PLAN.md 7.2, E4, R11). Applied once per call SID.
create function public.crm_finish_customer_leg(p_lead_id uuid,p_call_sid text,p_parent_call_sid text,
  p_staff_name text,p_staff_phone text,p_to_phone text,p_caller_id text,p_result text,p_duration integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if p_result not in ('talked','no_answer','busy','failed','hung_up_early')
    or coalesce(p_call_sid,'') !~ '^CA[0-9a-f]{32}$' then
    raise exception 'Unsupported call result' using errcode = '22023';
  end if;
  insert into public.lead_calls(lead_id,leg,staff_name,staff_phone,to_phone,caller_id,call_sid,
    parent_call_sid,status,result,duration_seconds,ended_at,answered_at)
  values(p_lead_id,'customer',p_staff_name,p_staff_phone,p_to_phone,p_caller_id,p_call_sid,
    p_parent_call_sid,'completed',p_result,greatest(coalesce(p_duration,0),0),now(),
    case when p_result = 'talked' then now() - make_interval(secs => greatest(coalesce(p_duration,0),0)) end)
  on conflict (call_sid) do update set result = excluded.result,
    duration_seconds = excluded.duration_seconds, ended_at = excluded.ended_at,
    answered_at = excluded.answered_at, status = excluded.status
    where public.lead_calls.result is null
  returning id into v_id;
  if v_id is null then return jsonb_build_object('applied',false,'call_id',null); end if;
  if p_result in ('no_answer','busy','failed') then
    update public.leads set call_attempts = call_attempts + 1, contact_outcome = 'no_answer',
      board_column = case when board_column = 'new' then 'in_talks' else board_column end,
      stage = case when stage = 'new' then 'contacted' else stage end
      where id = p_lead_id;
  elsif p_result = 'talked' then
    update public.leads set contact_outcome = 'reached', needs_call_log_at = now(),
      call_log_reminded_at = null where id = p_lead_id;
  end if;
  insert into public.lead_activities(lead_id,kind,outcome,data)
    values(p_lead_id,'phone',case when p_result in ('busy','failed') then 'no_answer' else p_result end,
      jsonb_build_object('staff',p_staff_name,'call_id',v_id,'duration_seconds',greatest(coalesce(p_duration,0),0)));
  return jsonb_build_object('applied',true,'call_id',v_id);
end $$;

revoke all on function public.crm_short_code(),public.crm_move_lead(uuid,text,jsonb,text),
  public.crm_log_call(uuid,uuid,text,jsonb,text),public.crm_claim_lead(uuid,text,text,text),
  public.crm_finish_customer_leg(uuid,text,text,text,text,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.crm_short_code(),public.crm_move_lead(uuid,text,jsonb,text),
  public.crm_log_call(uuid,uuid,text,jsonb,text),public.crm_claim_lead(uuid,text,text,text),
  public.crm_finish_customer_leg(uuid,text,text,text,text,text,text,text,integer)
  to service_role;
