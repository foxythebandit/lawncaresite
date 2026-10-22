-- Exposes only the count of completed jobs to the public site (hero emissions
-- counter). bookings itself stays locked behind RLS; this function returns a
-- single integer and nothing else.
create or replace function public.completed_job_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from bookings where status = 'completed';
$$;

revoke all on function public.completed_job_count() from public;
grant execute on function public.completed_job_count() to anon, authenticated;
