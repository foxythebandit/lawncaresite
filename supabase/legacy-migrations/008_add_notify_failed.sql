alter table bookings
  add column if not exists notify_failed boolean not null default false;
