import 'server-only'
import { adminDb } from '@/lib/supabase/admin'
import type { TracedSection } from '@/lib/website-intake'

/** Best effort: keeps an existing lead's website price (stamped now) and tracing current. Never throws. */
export async function saveWebsiteQuote(leadId: string, fields: { website_price_cents?: number; website_first_visit_cents?: number; website_frequency?: string; lawn_tracing?: TracedSection[] | null }) {
  const changes: Record<string, unknown> = {}
  if (fields.website_price_cents) Object.assign(changes, { website_price_cents: fields.website_price_cents, website_first_visit_cents: fields.website_first_visit_cents,
    website_frequency: fields.website_frequency, website_price_at: new Date().toISOString() })
  if (fields.lawn_tracing) changes.lawn_tracing = fields.lawn_tracing
  if (!Object.keys(changes).length) return
  try {
    const { error } = await adminDb().from('leads').update(changes).eq('id', leadId)
    if (error) console.error('Website quote not saved', error.code)
  } catch { console.error('Website quote not saved') }
}
