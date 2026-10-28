import { legRef } from '@/lib/phone/flow'
import { forbidden, twiml, twimlResponse, verifiedTwilioParams } from '@/lib/phone/twilio'
import { adminDb } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Recording status callback (P3, R13). Only the SID is stored; the audio stays in Twilio. */
export async function POST(request: Request) {
  const params = await verifiedTwilioParams(request)
  if (!params) return forbidden()
  const ref = legRef(request.url)
  if (ref && params.RecordingStatus === 'completed' && /^RE[0-9a-f]{32}$/.test(params.RecordingSid ?? '')) {
    const { error } = await adminDb().rpc('crm_phone_recording', {
      p_alert_call_id: ref.call, p_call_sid: params.CallSid ?? '', p_recording_sid: params.RecordingSid,
      p_duration: Number.parseInt(params.RecordingDuration ?? '0', 10) || 0,
    })
    if (error) console.error('Recording not recorded', ref.call, error.code)
  }
  return twimlResponse(twiml())
}
