create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table backup.leads_20261021 as table public.leads;
create table backup.bookings_20261021 as table public.bookings;
create table backup.quotes_20261021 as table public.quotes;
create table backup.extra_charges_20261021 as table public.extra_charges;;
