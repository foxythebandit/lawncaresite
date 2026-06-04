create table if not exists bookings (
  id                uuid        default gen_random_uuid() primary key,
  name              text        not null,
  phone             text        not null,
  email             text,
  preferred_date    date,
  address           text        not null,
  sq_ft             integer,
  frequency         text,
  price_per_visit   integer,
  first_visit_price integer,
  overgrowth_fee    integer,
  last_mow          text,
  created_at        timestamptz default now() not null
);

alter table bookings enable row level security;

create policy "public_insert_bookings"
  on bookings for insert
  with check (true);

create policy "authenticated_read_bookings"
  on bookings for select
  using (auth.role() = 'authenticated');
