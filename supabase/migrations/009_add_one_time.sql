alter table bookings
  add column if not exists one_time boolean not null default false;
