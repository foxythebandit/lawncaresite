'use server'
import { recordIntake, verifiedLead } from '@/lib/intake'
import { staffRecipients } from '@/lib/staff-alerts'
import { adminDb } from '@/lib/supabase/admin'
import { frequencyLabel, quoteOffer, type OfferFrequency } from '@/lib/quote-offer'
import type { QuoteDraft } from '@/lib/quote-draft'

export type QuoteBookingRequest = {
  token: string; submissionId: string; freq: OfferFrequency
  start: 'asap' | 'date' | 'unsure'; date?: string; timeOfDay?: string; notes?: string; email?: string
}
const START_TEXT = { asap: 'As soon as possible', unsure: 'Not sure yet (reach out to set a date)', date: '' }

/** A customer accepts their emailed quote. Creates a pending visit for staff to confirm; nothing is scheduled. */
export async function bookQuote(request: QuoteBookingRequest): Promise<{ success: true; confirmationTo: string | null } | { error: string }> {
  const id = verifiedLead(request.token)
  if (!id) return { error: 'This quote link is not valid. Please call us.' }
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(request.submissionId)) return { error: 'Please refresh the page and try again.' }
  if (!['asap', 'date', 'unsure'].includes(request.start)) return { error: 'Choose when to start.' }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const date = request.start === 'date' ? request.date ?? '' : ''
  if (request.start === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today)) return { error: 'Pick a start date from today on.' }
  const timeOfDay = ['Any time', 'Morning', 'Afternoon'].includes(request.timeOfDay ?? '') ? request.timeOfDay! : 'Any time'
  const notes = (request.notes ?? '').slice(0, 1500).trim()
  const typedEmail = (request.email ?? '').trim()
  if (typedEmail && (typedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail))) return { error: 'Check your email address.' }

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
      name: lead.name?.trim() || 'Online quote customer', phone: lead.phone, email: typedEmail || lead.email, address: lead.address,
      sq_ft: offer.sqFt || null, frequency: offer.recurring ? frequencyLabel(option.freq) : null,
      one_time: !offer.recurring || option.freq === 'onetime', manual_quote: false,
      preferred_date: date || null, preferred_time: timeOfDay,
      customer_notes: [request.start === 'date' ? null : `Start: ${startText}`, notes || null].filter(Boolean).join('\n') || null,
      price_per_visit: Math.round(option.price), first_visit_price: Math.round(option.firstVisit), overgrowth_fee: 0,
    }, request.token)
    const confirmationTo = typedEmail || lead.email || null
    if (result.duplicate) return { success: true, confirmationTo }
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
    if (confirmationTo) {
      await sendBookingConfirmation(confirmationTo, {
        firstName: lead.name?.trim().split(/\s+/)[0] ?? null, address: lead.address, sqFt: offer.sqFt,
        plan: offer.recurring ? `${frequencyLabel(option.freq)} mowing` : 'Your job',
        price: option.price, firstVisit: option.firstVisit, every: offer.recurring ? EVERY[option.freq] : undefined,
        start: request.start === 'date' ? `${startText}${timeOfDay !== 'Any time' ? ` (${timeOfDay.toLowerCase()})` : ''}`
          : request.start === 'asap' ? 'As soon as possible. We’ll email you the exact day.' : 'To be set. Reply with a day that works for you.',
        notes,
      }).catch(() => console.error('Booking confirmation email failed', id))
    }
    return { success: true, confirmationTo }
  } catch {
    return { error: 'We couldn’t save your booking. Please try again or call us.' }
  }
}

const EVERY: Partial<Record<OfferFrequency, string>> = { weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month' }
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`

async function sendBookingConfirmation(to: string, b: { firstName: string | null; address: string; sqFt: number; plan: string;
  price: number; firstVisit: number; every?: string; start: string; notes: string }) {
  if (!process.env.RESEND_API_KEY) return
  const priceLine = b.firstVisit !== b.price ? `First visit ${usd(b.firstVisit)} (30% off), then ${usd(b.price)} ${b.every ?? ''}`.trim()
    : `${usd(b.price)}${b.every ? ` ${b.every}` : ''}`
  const rows: [string, string][] = [['Plan', b.plan], ['First visit', b.start], ['Price', priceLine], ['Address', b.address],
    ...(b.sqFt ? [['Lawn', `${b.sqFt.toLocaleString('en-US')} sq ft`] as [string, string]] : []), ...(b.notes ? [['Your notes', b.notes] as [string, string]] : [])]
  const { Resend } = await import('resend')
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'QuietGreen <hello@quietgreen.co>', to, replyTo: 'hello@quietgreen.co',
    subject: `You’re booked: ${b.plan.toLowerCase()} at ${b.address}`,
    text: `Hi${b.firstName ? ` ${b.firstName}` : ''}, you’re all set!\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nNeed to change anything? Just reply to this email.\n\nQuietGreen · quietgreen.co`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111c17">
      <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0"><p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">Booking confirmed</p>
      <h1 style="color:#fff;font-size:22px;margin:0">You’re all set${b.firstName ? `, ${esc(b.firstName)}` : ''}!</h1></div>
      <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #b7e4c7;border-radius:10px;font-size:14px">
      ${rows.map(([k, v]) => `<tr><td style="padding:10px 14px;color:#4a5e54;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:10px 14px;color:#111c17;font-weight:600">${esc(v)}</td></tr>`).join('')}
      </table>
      <p style="font-size:14px;line-height:1.6;color:#4a5e54;margin:18px 0 0">Quiet, battery-powered mowing: no gas, no fumes, no early-morning roar. Need to change anything? Just reply to this email.</p>
      <p style="font-size:14px;color:#4a5e54;margin:14px 0 0">QuietGreen</p></div></div>`,
  })
  if (error) throw new Error('Confirmation email not accepted')
}
