-- PostgREST orders by this computed date before applying the search page range.
create function public.crm_calendar_search_date(public.bookings)
returns date language sql immutable security invoker set search_path = '' as $$
  select case when $1.status = 'pending' then $1.preferred_date
    else coalesce($1.confirmed_date,$1.preferred_date) end;
$$;

revoke all on function public.crm_calendar_search_date(public.bookings) from public,anon,authenticated;
grant execute on function public.crm_calendar_search_date(public.bookings) to service_role;
