import 'server-only'
import { adminDb } from './supabase/admin'

const BUCKET = 'booking-maps'

/** Storage path from a stored map_screenshot_url (older rows hold the full public URL). */
export function mapScreenshotPath(stored: string | null | undefined): string | null {
  if (!stored) return null
  const match = stored.match(/\/booking-maps\/((?:leads|bookings)-[0-9a-f-]{36}\.jpg)(?:\?|$)/i) ?? stored.match(/^((?:leads|bookings)-[0-9a-f-]{36}\.jpg)$/i)
  return match ? match[1] : null
}

/**
 * Short-lived link to a lead's map screenshot (PLAN.md 7.6, P7). Used for the alert MMS and
 * staff/customer pages, so the bucket can be private. Null when there is no image or signing fails.
 */
export async function signedMapUrl(stored: string | null | undefined, ttlSeconds = 600): Promise<string | null> {
  const path = mapScreenshotPath(stored)
  if (!path) return null
  try {
    const { data, error } = await adminDb().storage.from(BUCKET).createSignedUrl(path, ttlSeconds)
    return error || !data?.signedUrl ? null : data.signedUrl
  } catch { return null }
}
