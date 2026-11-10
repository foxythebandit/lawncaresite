begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.sent_offers'::regclass)
  and not has_table_privilege('anon','public.sent_offers','SELECT')
  and not has_table_privilege('authenticated','public.sent_offers','SELECT')
  and has_table_privilege('service_role','public.sent_offers','SELECT'),
  'quote terms and provider payload are private to server role'
);
select is(
  array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'crm%sent_offer%'
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))
    order by 1),
  array[]::text[],
  'only the server can prepare, finalize or accept a quote in the database'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.crm_intro_grants'::regclass)
  and not has_table_privilege('anon','public.crm_intro_grants','SELECT')
  and not has_table_privilege('authenticated','public.crm_intro_grants','UPDATE')
  and has_table_privilege('service_role','public.crm_intro_grants','UPDATE'),
  'introductory allocations are private to server role'
);
select is(
  array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'crm_intro_%' or p.proname in ('crm_confirm_first_visit','crm_first_visit_terms',
        'crm_register_intro','crm_website_booking_terms','crm_staff_quote_request','crm_record_booked_call','complete_job'))
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))
    order by 1),
  array[]::text[],
  'only the server can confirm requests, reallocate or consume an introductory price'
);
select * from finish();
rollback;
