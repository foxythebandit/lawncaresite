'use server'

import { createHash } from 'node:crypto'
import { after } from 'next/server'
import { dispatchIntake, verifiedLead, type IntakeResult } from '@/lib/intake'
import { verifiedOffer } from '@/lib/sent-offer'
import { adminDb } from '@/lib/supabase/admin'
import { staffRecipients } from '@/lib/staff-alerts'
import type { OfferFrequency } from '@/lib/quote-offer'

export type QuoteBookingRequest = {
  token: string; freq?: OfferFrequency
  start: 'asap' | 'date' | 'unsure'; date?: string; timeOfDay?: string; notes?: string; email?: string
}

export async function bookQuote(request: QuoteBookingRequest): Promise<{ success: true } | { error: string }> {
  const offer = verifiedOffer(request.token)
  const leadId = offer?.leadId ?? verifiedLead(request.token)
  if (!leadId) return { error: 'This quote link is not valid. Please call us.' }
  if (!['asap', 'date', 'unsure'].includes(request.start)) return { error: 'Choose when to start.' }
  const date = request.start === 'date' ? request.date ?? '' : null
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    return { error: 'Choose a valid preferred date.' }
  }
  const arrival = ['Any time', 'Morning', 'Afternoon'].includes(request.timeOfDay ?? '') ? request.timeOfDay : 'Any time'
  const email = (request.email ?? '').trim()
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: 'Check your email address.' }
  const notes = [
    request.start === 'asap' ? 'As soon as possible' : request.start === 'unsure' ? 'Contact me to set a date' : '',
    (request.notes ?? '').slice(0, 1500).trim(),
  ].filter(Boolean).join('\n')
  const payload = { date, arrival, email, notes, frequency: offer ? request.freq ?? null : null }
  const { data, error } = await adminDb().rpc('crm_accept_sent_offer', {
    p_lead_id: leadId, p_offer_id: offer?.offerId ?? null, p_request: payload,
    p_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), p_recipients: staffRecipients(),
  })
  if (error) {
    if (['PT409', '22023'].includes(error.code)) return { error: error.message }
    return { error: 'We couldn’t save your request. Please try again or call us.' }
  }
  const result = data as IntakeResult
  dispatchIntake(result)
  if (!result.duplicate && process.env.RESEND_API_KEY) after(async () => {
    try {
      const { data: visit } = await adminDb().from('bookings').select('email').eq('id', result.booking_id).single()
      if (!visit?.email) return
      const { sendEmail } = await import('@/lib/email')
      await sendEmail({
        from: 'QuietGreen <hello@quietgreen.co>', to: visit.email, replyTo: 'hello@quietgreen.co',
        subject: 'We received your QuietGreen visit request',
        text: 'Thank you for requesting a visit. We’ll get in touch to confirm the date and arrival time. Reply to this email if anything changes.\n\nQuietGreen',
      }, { idempotencyKey: `quote-request/${result.event_id}` })
    } catch { console.error('Quote request acknowledgment failed', result.event_id) }
  })
  return { success: true }
}
