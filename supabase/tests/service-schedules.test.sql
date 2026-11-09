begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  not has_table_privilege('anon','public.agreement_schedule_revisions','SELECT')
    and not has_table_privilege('authenticated','public.agreement_schedule_revisions','SELECT')
    and has_table_privilege('service_role','public.agreement_schedule_revisions','SELECT'),
  'schedule definitions are private to the server role'
);

select is(
  array(select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'crm%_schedule%' or p.proname like 'crm_calendar_%')
      and (has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE'))
    order by 1),
  array[]::text[],
  'customer and public roles cannot run the schedule RPCs'
);

set local role service_role;
select lives_ok(
  $$select public.crm_calendar_entries('2026-11-09','2026-11-15')$$,
  'server role can read a bounded calendar'
);
select throws_ok(
  $$select public.crm_schedule_dates('{"version":1,"base":{"frequency":"monthly","pattern":"day","day":32,"anchor_on":"2026-11-09"}}',
    '2026-11-09','2026-11-15')$$,
  '22023','Invalid service cadence fields',
  'invalid cadence fails through the preview RPC'
);
reset role;

select is(
  (select command from cron.job where jobname = 'crm-service-schedules' and active and schedule = '0 9 * * *'),
  'select public.crm_reconcile_schedules()',
  'daily job invokes only database reconciliation'
);

select * from finish();
rollback;
