-- Run before the Austin workday in both daylight and standard time. The
-- reconciliation job stays inside Postgres and is independent of lead alerts.
select cron.schedule('crm-service-schedules','0 9 * * *',
  'select public.crm_reconcile_schedules()');
