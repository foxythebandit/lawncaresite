import 'server-only'
import { mapScreenshotPath } from '@/lib/map-screenshot'
import { adminDb } from '@/lib/supabase/admin'

/**
 * Short-lived links for many stored map screenshots in one storage call (P7), keyed by the stored
 * value. Anything that can't be signed is left out, so the page shows no image instead of a broken one.
 */
export async function signMapUrls(stored: (string | null | undefined)[], ttlSeconds = 3600): Promise<Map<string, string>> {
  const byPath = new Map<string, string>()
  for (const value of stored) { const path = mapScreenshotPath(value); if (value && path) byPath.set(path, value) }
  const signed = new Map<string, string>()
  if (!byPath.size) return signed
  try {
    const { data } = await adminDb().storage.from('booking-maps').createSignedUrls([...byPath.keys()], ttlSeconds)
    for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) signed.set(byPath.get(row.path)!, row.signedUrl)
  } catch { /* storage unavailable: no images */ }
  return signed
}
