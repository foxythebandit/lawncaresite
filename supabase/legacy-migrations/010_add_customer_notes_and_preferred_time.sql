alter table bookings
  add column if not exists customer_notes text,
  add column if not exists preferred_time text;
