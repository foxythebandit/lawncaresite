import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { staffText, type SummaryLead } from '../lead-summary'
import { adminDb } from '../supabase/admin'
import { sendStaffText } from './staff-texts'

/** Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Constant-time; a missing or short secret refuses everything. */
export function cronAuthorized(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16) return false
  const actual = Buffer.from(header ?? ''), expected = Buffer.from(`Bearer ${secret}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** S20 / R6: "Log your call" to the claimer 30 minutes after a talked call with no outcome logged. Each lead once. */
export async function sendDueReminders(limit = 20): Promise<{ due: number; sent: number }> {
  const db = adminDb()
  const { data: due, error } = await db.rpc('crm_phone_due_reminders', { p_limit: limit })
  if (error) throw error
  let sent = 0
  for (const row of (due ?? []) as { lead_id: string; needs_call_log_at: string; taken_by_phone: string }[]) {
    const { data: lead } = await db.from('leads').select('*').eq('id', row.lead_id).single()
    if (!lead) continue
    const result = await sendStaffText({ leadId: row.lead_id, kind: 'reminder', recipient: row.taken_by_phone,
      body: staffText.reminder(lead as SummaryLead, process.env.CRM_BASE_URL!),
      dedupeKey: `reminder:${row.lead_id}:${row.needs_call_log_at}:${row.taken_by_phone}` })
    if (result === 'sent') sent += 1
  }
  return { due: (due ?? []).length, sent }
}
