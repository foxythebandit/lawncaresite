import 'server-only'
import { adminDb } from '../supabase/admin'
import { staffText, type SummaryLead } from '../lead-summary'
import { otherStaff, staffByPhone, staffPeople } from '../staff-directory'
import { legUrls } from './flow'
import { sendStaffText } from './staff-texts'
import { CALL_SID, tail, twilioApi } from './twilio'

/** Alert legs: placing the ring (7.2), stopping the other leg after a claim (R3), and the staff texts that follow (7.3). */

/** Records the leg (one per event and phone) and returns the Calls.json fields, or the SID if this leg was already placed. */
export async function startAlertLeg(eventId: string, leadId: string, staffPhone: string, from: string) {
  const { data, error } = await adminDb().rpc('crm_alert_leg_start', {
    p_lead_id: leadId, p_event_id: eventId, p_staff_name: staffByPhone(staffPhone)?.name ?? staffPhone, p_staff_phone: staffPhone,
  })
  if (error || !data?.id) throw new Error('Alert leg not recorded')
  const leg = data as { id: string; call_sid: string | null }
  const urls = legUrls({ call: leg.id, lead: leadId, event: eventId })
  // R7 no machine detection; R10 ring 20 s.
  const fields = new URLSearchParams({ To: staffPhone, From: from, Url: urls.answer, Method: 'POST',
    StatusCallback: urls.status, StatusCallbackMethod: 'POST', Timeout: '20' })
  for (const event of ['initiated', 'ringing', 'answered', 'completed']) fields.append('StatusCallbackEvent', event)
  return { id: leg.id, placedSid: leg.call_sid, fields }
}

export async function recordAlertLeg(legId: string, sid: string | null) {
  const db = adminDb()
  const { error } = sid
    ? await db.from('lead_calls').update({ call_sid: sid }).eq('id', legId).is('call_sid', null)
    : await db.from('lead_calls').update({ status: 'failed', result: 'failed', ended_at: new Date().toISOString() }).eq('id', legId).is('call_sid', null)
  if (error) console.error('Alert leg needs reconciliation', legId)
}

export type PressResult = {
  won?: boolean; dial?: boolean; taken_by?: string | null; passed: boolean
  lead_id: string; event_id: string | null; staff_name?: string | null; staff_phone?: string
  customer_phone?: string | null; others?: { id: string; call_sid: string; status: string; staff_phone: string }[]
}

async function loadLead(leadId: string) {
  const { data } = await adminDb().from('leads').select('*').eq('id', leadId).single()
  return data as SummaryLead | null
}

/** R3: ringing legs are canceled; a leg already answered is sent back to its answer URL, which now says "<Winner> has it." */
async function stopLeg(leg: NonNullable<PressResult['others']>[number], leadId: string, eventId: string) {
  if (!CALL_SID.test(leg.call_sid)) return
  try {
    if (leg.status !== 'in-progress') {
      const canceled = await twilioApi(`Calls/${leg.call_sid}.json`, new URLSearchParams({ Status: 'canceled' }))
      if (canceled.body.status !== 'in-progress') return
    }
    const urls = legUrls({ call: leg.id, lead: leadId, event: eventId })
    await twilioApi(`Calls/${leg.call_sid}.json`, new URLSearchParams({ Url: urls.answer, Method: 'POST' }))
  } catch { console.error('Other alert leg not stopped', leg.id) }
}

/** After a winning press 1: stop the other leg, text the other person, and in dial-yourself mode text the claimer the number. */
export async function afterClaim(result: PressResult, dialYourself: boolean) {
  if (!result.won || !result.staff_phone) return
  const winner = result.staff_phone
  await Promise.all((result.others ?? []).map(leg => stopLeg(leg, result.lead_id, result.event_id ?? '')))
  const lead = await loadLead(result.lead_id)
  if (!lead) return
  const name = result.taken_by ?? result.staff_name ?? 'Someone'
  await Promise.all([
    ...otherStaff(winner).map(person => sendStaffText({ leadId: lead.id, eventId: result.event_id, kind: 'claimed', recipient: person.phone,
      body: staffText.claimed(lead, name), dedupeKey: `claimed:${lead.id}:${person.phone}` })),
    dialYourself ? sendStaffText({ leadId: lead.id, eventId: result.event_id, kind: 'call_now', recipient: winner,
      body: staffText.callNow(lead), dedupeKey: `call_now:${lead.id}:${winner}` }) : null,
  ])
}

/** R5 / P1: the last alert leg finished and nobody pressed 1. Texts both once per event. */
export async function notifyNotTaken(leadId: string, eventId: string) {
  const lead = await loadLead(leadId)
  if (!lead) return
  await Promise.all(staffPeople().map(person => sendStaffText({ leadId, eventId, kind: 'not_taken', recipient: person.phone,
    body: staffText.notTaken(lead), dedupeKey: `not_taken:${eventId}:${person.phone}` })))
}

/** E10: a known, claimed lead booked online: only the claimer hears about it, by text. */
export async function notifyBookedOnline(leadId: string, eventId: string, claimerPhone: string) {
  const db = adminDb()
  const [lead, { data: bookings }] = await Promise.all([loadLead(leadId), db.from('bookings').select('*').eq('lead_id', leadId)])
  if (!lead) return
  const result = await sendStaffText({ leadId, eventId, kind: 'booked_online', recipient: claimerPhone,
    body: staffText.bookedOnline(lead, bookings ?? []), dedupeKey: `booked_online:${eventId}:${claimerPhone}` })
  if (result === 'failed') console.error('Booked-online text failed', eventId, tail(claimerPhone))
}
