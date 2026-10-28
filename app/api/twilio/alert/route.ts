import { spokenPrompt, type SummaryLead } from '@/lib/lead-summary'
import { answerTwiml, legRef, legUrls } from '@/lib/phone/flow'
import { CALL_SID, forbidden, hangup, twiml, twimlResponse, verifiedTwilioParams } from '@/lib/phone/twilio'
import { adminDb } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Alert leg answered (PLAN.md 7.2). Checks the claim first (R3), then asks press 1 / press 2. */
export async function POST(request: Request) {
  const params = await verifiedTwilioParams(request)
  if (!params) return forbidden()
  const ref = legRef(request.url)
  if (!ref || !CALL_SID.test(params.CallSid ?? '')) return twimlResponse(twiml(hangup()))
  const db = adminDb()
  const [{ data: leg }, { data: lead }, { data: event }, { data: bookings }] = await Promise.all([
    db.from('lead_calls').select('id,lead_id,event_id,leg,staff_phone,call_sid').eq('id', ref.call).maybeSingle(),
    db.from('leads').select('*').eq('id', ref.lead).maybeSingle(),
    db.from('intake_events').select('id,booking_id').eq('id', ref.event).maybeSingle(),
    db.from('bookings').select('*').eq('lead_id', ref.lead),
  ])
  if (!leg || leg.leg !== 'alert' || leg.lead_id !== ref.lead || leg.event_id !== ref.event || !lead || !event
    || (leg.call_sid && leg.call_sid !== params.CallSid)) return twimlResponse(twiml(hangup()))
  if (!leg.call_sid) await db.from('lead_calls').update({ call_sid: params.CallSid }).eq('id', leg.id).is('call_sid', null)
  return twimlResponse(answerTwiml({
    takenBy: lead.taken_by, mine: lead.taken_by_phone === leg.staff_phone,
    prompt: spokenPrompt(lead as SummaryLead, bookings ?? [], event.booking_id ? 'booking' : 'new'),
    pressUrl: legUrls(ref).press,
  }))
}
