-- One-off billing that isn't a booking: bed cleanups, shrub trimming, haul-offs, etc.
create table if not exists extra_charges (
  id             uuid        default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  charged_on     date        not null default current_date,
  client_name    text        not null,
  phone          text,
  description    text        not null,
  amount         numeric(10,2) not null check (amount >= 0),
  payment_method text
);

-- Admin-only: no public policies; the admin panel uses the secret key.
alter table extra_charges enable row level security;
