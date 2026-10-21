import 'server-only'
import { adminDb } from './supabase/admin'
/** Best effort, after durable intake. Stable filename makes storage retries harmless. */
export async function saveIntakeScreenshot(table: 'leads' | 'bookings', id: string, screenshot?: string) {
  if (!screenshot?.startsWith('data:image/jpeg;base64,') || screenshot.length > 2500000) return
  try {
    const db = adminDb(), path = `${table}-${id}.jpg`
    const { error } = await db.storage.from('booking-maps').upload(path, Buffer.from(screenshot.split(',')[1], 'base64'), { contentType: 'image/jpeg', upsert: true })
    if (error) return
    const { data } = db.storage.from('booking-maps').getPublicUrl(path)
    await db.from(table).update({ map_screenshot_url: data.publicUrl }).eq('id', id)
  } catch { console.error('Intake screenshot not saved', id) }
}
