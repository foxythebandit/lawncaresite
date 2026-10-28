import { after } from 'next/server'
import { legRef } from '@/lib/phone/flow'
import { notifyNotTaken } from '@/lib/phone/legs'
import { CALL_SID, forbidden, twiml, twimlResponse, verifiedTwilioParams } from '@/lib/phone/twilio'
import { adminDb } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Alert leg status callback. When the last leg ends untaken, "Nobody took it" goes to both, once (R5, no timers). */
export async function POST(request: Request) {
  const params = await verifiedTwilioParams(request)
  if (!params) return forbidden()
  const ref = legRef(request.url)
  if (!ref || !CALL_SID.test(params.CallSid ?? '')) return twimlResponse(twiml())
  const duration = Number.parseInt(params.CallDuration ?? '', 10)
  const { data, error } = await adminDb().rpc('crm_alert_leg_status', {
    p_call_id: ref.call, p_call_sid: params.CallSid, p_status: params.CallStatus ?? '',
    p_duration: Number.isFinite(duration) ? duration : null,
  })
  if (error) console.error('Alert leg status not recorded', ref.call, error.code)
  else if (data?.not_taken) after(() => notifyNotTaken(data.lead_id, data.event_id))
  return twimlResponse(twiml())
}
