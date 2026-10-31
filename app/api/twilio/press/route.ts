import { after } from 'next/server'
import { callerIdFor, connectMode, legRef, legUrls, pressTwiml } from '@/lib/phone/flow'
import { afterClaim, type PressResult } from '@/lib/phone/legs'
import { CALL_SID, dialable, E164, forbidden, hangup, say, twiml, twimlResponse, verifiedTwilioParams } from '@/lib/phone/twilio'
import { adminDb } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Keypress on an alert leg (PLAN.md 7.2b). One RPC decides: 2 passes; 1 claims atomically (R1)
 * and only the winner's own leg dials the customer, inside this call (R2, R4). Stopping the
 * other leg and the staff texts run after the reply so the winner hears ringing at once.
 */
export async function POST(request: Request) {
  const params = await verifiedTwilioParams(request)
  if (!params) return forbidden()
  const ref = legRef(request.url)
  if (!ref || !CALL_SID.test(params.CallSid ?? '')) return twimlResponse(twiml(hangup()))
  const urls = legUrls(ref)
  const mode = connectMode()
  const digit = (params.Digits ?? '').slice(0, 1)
  if (digit !== '1' && digit !== '2') return twimlResponse(pressTwiml({ digit, mode, customer: null, callerId: '', urls }))
  const staffPhone = E164.test(params.To ?? '') ? params.To : null
  const { data, error } = await adminDb().rpc('crm_alert_press', {
    p_call_id: ref.call, p_call_sid: params.CallSid, p_digit: digit,
    p_caller_id: mode === 'twilio' && staffPhone ? callerIdFor(staffPhone) : null,
  })
  if (error || !data) {
    console.error('Keypress not recorded', ref.call, error?.code)
    return twimlResponse(twiml(say('Sorry, that did not work. Check the text.'), hangup()))
  }
  const result = data as PressResult
  if (digit === '1') after(() => afterClaim(result, mode === 'dial-yourself'))
  return twimlResponse(pressTwiml({
    digit, mode, urls, customer: dialable(result.customer_phone),
    claim: { won: !!result.won, dial: !!result.dial, taken_by: result.taken_by ?? null },
    callerId: callerIdFor(result.staff_phone ?? staffPhone ?? ''),
  }))
}
