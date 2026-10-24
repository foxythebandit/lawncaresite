'use server'
import { recordIntake, verifiedLead } from '@/lib/intake'
import { staffRecipients } from '@/lib/staff-alerts'
import { adminDb } from '@/lib/supabase/admin'
import { frequencyLabel, quoteOffer, type OfferFrequency } from '@/lib/quote-offer'
import type { QuoteDraft } from '@/lib/quote-draft'

export type QuoteBookingRequest = {
  token: string; submissionId: string; freq: OfferFrequency
  start: 'asap' | 'date' | 'unsure'; date?: string; timeOfDay?: string; notes?: string
}
const START_TEXT = { asap: 'As soon as possible', unsure: 'Not sure yet, call to set a date', date: '' }

/** A customer accepts their emailed quote. Creates a pending visit for staff to confirm; nothing is scheduled. */
export async function bookQuote(request: QuoteBookingRequest): Promise<{ success: true } | { error: string }> {
  const id = verifiedLead(request.token)
  if (!id) return { error: 'This quote link is not valid. Please call us.' }
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(request.submissionId)) return { error: 'Please refresh the page and try again.' }
  if (!['asap', 'date', 'unsure'].includes(request.start)) return { error: 'Choose when to start.' }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const date = request.start === 'date' ? request.date ?? '' : ''
  if (request.start === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today)) return { error: 'Pick a start date from today on.' }
  const timeOfDay = ['Any time', 'Morning', 'Afternoon'].includes(request.timeOfDay ?? '') ? request.timeOfDay! : 'Any time'
  const notes = (request.notes ?? '').slice(0, 1500).trim()

  const db = adminDb()
  const { data: lead } = await db.from('leads').select('name,phone,email,address,quote_draft').eq('id', id).single()
  if (!lead?.quote_draft || !lead.address) return { error: 'This quote is no longer available. Please call us.' }
  const offer = quoteOffer(lead.quote_draft as QuoteDraft)
  const option = offer.options.find(o => o.freq === request.freq)
  if (!option) return { error: 'Choose how often you’d like service.' }

  const startText = request.start === 'date'
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : START_TEXT[request.start]
  const summary = `Booked online: ${offer.recurring ? frequencyLabel(option.freq) : 'this job'} at $${option.price}${offer.recurring && option.freq !== 'onetime' ? '/visit' : ''}`
    + `${option.firstVisit !== option.price ? `, first visit $${option.firstVisit}` : ''}. Start: ${startText}. Time: ${timeOfDay}.`
  try {
    const result = await recordIntake('quote-booking', request.submissionId, {}, {
      name: lead.name?.trim() || 'Online quote customer', phone: lead.phone, email: lead.email, address: lead.address,
      sq_ft: offer.sqFt || null, frequency: offer.recurring ? frequencyLabel(option.freq) : null,
      one_time: !offer.recurring || option.freq === 'onetime', manual_quote: false,
      preferred_date: date || null, preferred_time: timeOfDay,
      customer_notes: [request.start === 'date' ? null : `Start: ${startText}`, notes || null].filter(Boolean).join('\n') || null,
      price_per_visit: Math.round(option.price), first_visit_price: Math.round(option.firstVisit), overgrowth_fee: 0,
    }, request.token)
    if (result.duplicate) return { success: true }
    // Repeat submissions from a known lead stay quiet by default; a booked quote should still ring both phones.
    const recipients = staffRecipients()
    if (recipients.length) {
      await db.from('intake_events').update({ alert_version: 2 }).eq('id', result.event_id)
      await db.from('staff_alerts').upsert(recipients.flatMap(recipient => (['sms', 'voice'] as const).map(channel => ({ event_id: result.event_id, recipient, channel }))),
        { onConflict: 'event_id,recipient,channel', ignoreDuplicates: true })
    }
    const { data: fresh } = await db.from('leads').select('updated_at,quote_confirmed_at,quote_status').eq('id', id).single()
    if (fresh) {
      const accept = !!fresh.quote_confirmed_at && ['draft', 'accepted'].includes(fresh.quote_status)
      await db.rpc('update_lead_workflow', {
        p_lead_id: id, p_expected_updated_at: fresh.updated_at,
        p_patch: accept ? { quote_status: 'accepted', stage: 'booked' } : { stage: 'booked' },
        p_activity: { kind: 'quote', outcome: 'booked_online', body: `${summary}${notes ? ` Notes: ${notes}` : ''}` },
        p_actor_email: 'customer (online quote)',
      })
    }
    return { success: true }
  } catch {
    return { error: 'We couldn’t save your booking. Please try again or call us.' }
  }
}
