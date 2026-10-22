ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS completed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS amount_charged  numeric(8,2),
  ADD COLUMN IF NOT EXISTS payment_method  text,
  ADD COLUMN IF NOT EXISTS next_visit_date date;
