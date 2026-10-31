"""Upgrade existing rows in an isolated local database; never uses production credentials."""
import pathlib, runpy, subprocess, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
CONTAINER='supabase_db_qg-crm-test'
NAME='qg_upgrade_'+uuid.uuid4().hex[:12]
def sql(statement, database=NAME, check=True):
 result = subprocess.run(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],input=statement,text=True,capture_output=True)
 if check and result.returncode: raise RuntimeError(result.stderr)
 return result
files=sorted((ROOT/'supabase/migrations').glob('*.sql'))
crm_migration=ROOT/'supabase/migrations/20261022000000_crm_lead_workspace.sql'
foundation=next((ROOT/'supabase/migrations').glob('*_crm_foundation.sql'))
alerts_migration=next((ROOT/'supabase/migrations').glob('*_crm_alert_intents.sql'))
lifecycle_migration=next((ROOT/'supabase/migrations').glob('*_crm_lifecycle_commands.sql'))
followup_migration=next((ROOT/'supabase/migrations').glob('*_crm_lifecycle_followup.sql'))
frequency_guard_migration=next((ROOT/'supabase/migrations').glob('*_crm_lifecycle_frequency_guard.sql'))
job_item_grant_migration=next((ROOT/'supabase/migrations').glob('*_crm_job_items_service_delete.sql'))
first_occurrence_migration=next((ROOT/'supabase/migrations').glob('*_crm_explicit_first_occurrence.sql'))
job_replay_migration=next((ROOT/'supabase/migrations').glob('*_crm_job_command_replay.sql'))
customer_job_migration=next((ROOT/'supabase/migrations').glob('*_crm_customer_job.sql'))
files.remove(crm_migration)
files.remove(foundation)
files.remove(alerts_migration)
files.remove(lifecycle_migration)
files.remove(followup_migration)
files.remove(frequency_guard_migration)
files.remove(job_item_grant_migration)
files.remove(first_occurrence_migration)
files.remove(job_replay_migration)
files.remove(customer_job_migration)
create=ROOT/'supabase/migrations/002_create_bookings.sql';files.remove(create);files.insert(1,create)
baseline='create schema auth; grant usage on schema auth, public to authenticated, anon, service_role;\n'
for function in ['auth.jwt()', 'auth.role()']:
 baseline+=sql("select pg_get_functiondef('"+function+"'::regprocedure);",'postgres').stdout+';\n'
for path in files:
 baseline+=path.read_text()+'\n'
 if path==create:baseline+="alter table bookings add column status text not null default 'pending', add column confirmed_date date, add column notes text;\n"
baseline+=(ROOT/'supabase/legacy-migrations/004_payment_link.sql').read_text()+'\n'
try:
 sql('create database '+NAME+';','postgres')
 sql(baseline)
 sql("insert into leads(phone,address) values ('5550000000','Original lead'); insert into bookings(name,phone,address,manual_quote,utm_source,notes) values ('Legacy customer','5550000001','Legacy address',true,'meta','Private staff notes');")
 # Unreviewed permissive policies fail before any schema change, with a clear message.
 sql('create policy unexpected_policy on bookings for select using (true);')
 failed=sql('begin;\n'+crm_migration.read_text()+'\ncommit;',check=False)
 assert failed.returncode and 'Unexpected bookings policies' in failed.stderr,failed.stderr
 assert sql("select count(*) from information_schema.columns where table_name='leads' and column_name='quote_draft';").stdout.strip()=='0'
 sql('drop policy unexpected_policy on bookings;')
 sql('begin;\n'+crm_migration.read_text()+'\ncommit;')
 sql("select record_intake('historical','legacy-alert-1','legacy-hash','{\"phone\":\"5550000003\",\"address\":\"Prior address\"}'::jsonb);")
 sql('begin;\n'+foundation.read_text()+'\ncommit;')
 sql('begin;\n'+alerts_migration.read_text()+'\ncommit;')
 sql('begin;\n'+lifecycle_migration.read_text()+'\ncommit;')
 sql('begin;\n'+followup_migration.read_text()+'\ncommit;')
 sql('begin;\n'+frequency_guard_migration.read_text()+'\ncommit;')
 sql('begin;\n'+job_item_grant_migration.read_text()+'\ncommit;')
 sql('begin;\n'+first_occurrence_migration.read_text()+'\ncommit;')
 sql('begin;\n'+job_replay_migration.read_text()+'\ncommit;')
 sql('begin;\n'+customer_job_migration.read_text()+'\ncommit;')
 assert sql("select count(*) from bookings b join leads l on b.lead_id=l.id where b.name='Legacy customer' and l.address='Legacy address' and b.notes='Private staff notes' and l.utm_source='meta';").stdout.strip()=='1'
 assert sql("select count(*) from leads where address='Original lead';").stdout.strip()=='1'
 assert sql("select has_column_privilege('authenticated','bookings','notes','select');").stdout.strip()=='f'
 assert sql("select has_column_privilege('authenticated','bookings','id','select');").stdout.strip()=='t'
 # Real RPC persists new rows and idempotent retries after an existing-data upgrade.
 request="select record_intake('upgrade-test','stable-key','hash','{\"phone\":\"5550000002\"}'::jsonb);"
 sql(request);sql(request)
 assert sql("select count(*) from intake_events where source='upgrade-test';").stdout.strip()=='1'
 sql("select record_intake('staff-booking','empty-services-booking','booking-hash','{}'::jsonb,'{\"name\":\"Unknown services\",\"phone\":\"5550000002\",\"address\":\"Staff supplied address\"}'::jsonb,(select id from leads where external_submission_id='stable-key'));")
 assert sql("select services from leads where external_submission_id='stable-key';").stdout.strip()=='[]'
 for source in ('website-map','website-manual','website-service','website-booking'):
  booking = "'{\"name\":\"Synthetic customer\",\"phone\":\"5550000044\",\"address\":\"44 Local Lane\"}'::jsonb" if source == 'website-booking' else 'null'
  sql(f"select record_intake('{source}','test-{source}','hash-{source}',"
      f"'{{\"name\":\"Synthetic customer\",\"phone\":\"5550000044\",\"address\":\"44 Local Lane\"}}'::jsonb,{booking});")
 assert sql("select count(*) from public.leads where source like 'website-%' and stage='new' and quote_status='draft' and updated_at is not null;").stdout.strip()=='4'
 assert sql("select count(*) from public.bookings where address='44 Local Lane' and updated_at is not null;").stdout.strip()=='1'
 alert_request="select public.record_intake_v2('website-service','v2-alert-key','v2-hash','{\"phone\":\"5550000099\",\"address\":\"99 Local Lane\"}'::jsonb,null,null,array['+15125550111','+15125550222']);"
 sql(alert_request)
 sql(alert_request)
 assert sql("select count(*) from public.staff_alerts a join public.intake_events e on e.id=a.event_id where e.submission_id='v2-alert-key' and e.alert_version=2 and a.recipient<>'';").stdout.strip()=='4'
 assert sql("select count(*) from public.staff_alerts a join public.intake_events e on e.id=a.event_id where e.submission_id='v2-alert-key' and a.recipient='';").stdout.strip()=='0'
 sql("select public.record_intake_v2('website-booking','v2-linked-booking','linked-hash','{}'::jsonb,'{\"name\":\"Linked\",\"phone\":\"5550000099\",\"address\":\"99 Local Lane\"}'::jsonb,(select id from public.leads where external_submission_id='v2-alert-key'),array['+15125550111','+15125550222']);")
 assert sql("select count(*) from public.staff_alerts a join public.intake_events e on e.id=a.event_id where e.submission_id='v2-linked-booking';").stdout.strip()=='0'
 runpy.run_path(str(ROOT/'tests/crm-foundation.py'))['check'](sql)
 runpy.run_path(str(ROOT/'tests/crm-lifecycle.py'))['check'](sql)
 print('PASS: isolated existing-data upgrade, legacy backfill/preservation, unexpected-policy abort, customer column permissions, durable intake/replay')
finally:
 sql('drop database if exists '+NAME+';','postgres')
