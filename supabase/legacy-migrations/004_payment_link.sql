-- Add payment link storage to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_link text;

-- Fix portal RLS: clients should only see their own bookings.
-- Admin uses service role key which bypasses RLS, so this doesn't affect admin.
DROP POLICY IF EXISTS "authenticated_read_bookings" ON bookings;
CREATE POLICY "client_read_own_bookings"
  ON bookings FOR SELECT
  USING (email = (auth.jwt() ->> 'email'));
