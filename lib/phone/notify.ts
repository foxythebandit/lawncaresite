import 'server-only'
import { staffText, type SummaryLead } from '../lead-summary'
import { otherStaff, staffByEmail } from '../staff-directory'
import { adminDb } from '../supabase/admin'
import { sendStaffText } from './staff-texts'

/**
 * Staff text to the other person after a Log call is saved (PLAN.md 7.3, S19).
 * Contract for the CRM: call after crm_log_call succeeds; never throws; respects STAFF_SMS_ENABLED.
 * The actor is the staff member whose STAFF_PEOPLE email matches; if the actor can't be
 * resolved nobody is texted. Retries with the same activity send nothing new.
 */
export async function notifyCallLogged(leadId: string, activityId: string, actorEmail: string): Promise<void> {
  try {
    const actor = staffByEmail(actorEmail)
    if (!actor) return
    const db = adminDb()
    const [{ data: lead }, { data: activity }] = await Promise.all([
      db.from('leads').select('*').eq('id', leadId).single(),
      db.from('lead_activities').select('id,lead_id,kind,outcome,data').eq('id', activityId).single(),
    ])
    if (!lead || !activity || activity.lead_id !== leadId || activity.kind !== 'call') return
    const body = staffText.outcome(lead as SummaryLead, activity.outcome ?? '', (activity.data ?? {}) as Record<string, unknown>)
    if (!body) return
    await Promise.all(otherStaff(actor.phone).map(person => sendStaffText({ leadId, kind: 'outcome', recipient: person.phone, body,
      dedupeKey: `outcome:${activityId}:${person.phone}` })))
  } catch {
    console.error('Call outcome text failed', leadId)
  }
}
