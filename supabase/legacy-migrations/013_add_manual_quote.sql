alter table bookings
  add column if not exists manual_quote boolean not null default false,
  add column if not exists lawn_size_bucket text;
