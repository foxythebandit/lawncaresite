-- Every 5 minutes, call /api/cron/phone (call-log reminders, failed staff text retries, alert recovery sweep).
-- Runs in Supabase because Vercel Hobby only allows daily crons.
-- The bearer token is the Vault secret `crm_cron_secret` (same value as CRON_SECRET in Vercel), added once in
-- Dashboard → Integrations → Vault. Until it exists the job does nothing, so local and test databases never call prod.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('crm-phone', '*/5 * * * *', $job$
  select net.http_get(
    url := 'https://quietgreen.co/api/cron/phone',
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.decrypted_secret),
    timeout_milliseconds := 30000
  )
  from vault.decrypted_secrets s
  where s.name = 'crm_cron_secret'
$job$);

-- pg_cron logs every run to cron.job_run_details and never prunes it (pg_net's response table expires on its own after 6 hours).
select cron.schedule('crm-prune-cron-history', '0 9 * * *', $job$
  delete from cron.job_run_details where end_time < now() - interval '7 days'
$job$);
