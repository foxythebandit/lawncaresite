-- P7: map screenshots are served through short-lived signed links (lib/map-screenshot.ts),
-- so the bucket no longer needs public URLs. Deploy the signed-link code before or with this.
update storage.buckets set public = false where id = 'booking-maps';
