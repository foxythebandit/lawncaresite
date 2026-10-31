-- Replacing a job's current items deletes the previous rows within the RPC transaction.
-- Keep public roles unable to mutate the staff-only ledger.
grant delete on public.job_items to service_role;

-- The customer portal already has a column-scoped booking read grant. New jobs
-- store their exact price here; RLS still limits rows to the signed-in email.
grant select (job_total) on public.bookings to authenticated;
