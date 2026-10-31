import { dialOutcome, legRef } from '@/lib/phone/flow'
import { CALL_SID, forbidden, hangup, twiml, twimlResponse, verifiedTwilioParams } from '@/lib/phone/twilio'
import { adminDb } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** <Dial action> of the winner's leg: records the customer leg once (7.2, E4, R11), then ends the call. */
export async function POST(request: Request) {
  const params = await verifiedTwilioParams(request)
  if (!params) return forbidden()
  const ref = legRef(request.url)
  const outcome = dialOutcome(params.DialCallStatus, params.DialCallDuration)
  if (ref && outcome && CALL_SID.test(params.CallSid ?? '') && CALL_SID.test(params.DialCallSid ?? '')) {
    const { error } = await adminDb().rpc('crm_phone_finish_dial', {
      p_alert_call_id: ref.call, p_parent_call_sid: params.CallSid, p_dial_call_sid: params.DialCallSid,
      p_result: outcome, p_duration: Number.parseInt(params.DialCallDuration ?? '0', 10) || 0,
    })
    if (error) console.error('Customer leg not recorded', ref.call, error.code)
  }
  return twimlResponse(twiml(hangup()))
}
