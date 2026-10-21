-- READ ONLY. Run against the existing project before approving the CRM migration.
-- Results contain schema/permissions/counts only, not contact rows or credentials.
begin transaction read only;
select current_database(), current_user, version();
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name in ('leads','bookings','quotes','extra_charges','intake_events','staff_alerts')
order by table_name, ordinal_position;
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public' order by tablename, policyname;
select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
from pg_class c join pg_namespace n on c.relnamespace=n.oid
where n.nspname='public' and c.relname in ('leads','bookings','quotes','extra_charges');
select c.relname, a.attname, a.attacl from pg_attribute a join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null;
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' order by table_name, grantee, privilege_type;
select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by tablename,indexname;
select c.relname, pg_get_constraintdef(k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid
join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';
select event_object_table, trigger_name, action_statement from information_schema.triggers where trigger_schema='public';
select p.oid::regprocedure, p.prosecdef, p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' order by 1;
select 'leads' as relation, count(*) from public.leads union all
select 'bookings', count(*) from public.bookings union all
select 'manual inquiry bookings', count(*) from public.bookings where manual_quote=true;
select version from supabase_migrations.schema_migrations order by version;
rollback;
