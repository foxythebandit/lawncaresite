import 'server-only'
import { after } from 'next/server'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { adminDb } from './supabase/admin'
import { dispatchAlert, staffRecipients } from './staff-alerts'
import { notifyBookedOnline } from './phone/legs'

export function leadToken(id: string) {
  return `${id}.${createHmac('sha256', process.env.SUPABASE_SECRET_KEY!).update(`lead:${id}`).digest('hex')}`
}
export function verifiedLead(token?: string): string | null {
  if (!token || !/^[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(token)) return null
  const expected = leadToken(token.split('.')[0])
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected)) ? token.split('.')[0] : null
}
/** claimed_by_phone is set for a known lead's submission (E10): the claimer, or null when unclaimed. */
export type IntakeResult = { lead_id: string; event_id: string; booking_id: string | null; duplicate: boolean; claimed_by_phone?: string | null }

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stableJSON(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export async function recordIntake(source: string, submission: string, lead: Record<string, unknown>, booking?: Record<string, unknown>, token?: string): Promise<IntakeResult> {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(submission)) throw new Error('Invalid submission ID')
  const existing = verifiedLead(token)
  if (token && !existing) throw new Error('Invalid lead reference')
  // Retry identity excludes server-generated timestamps, which naturally change on retries.
  const stableLead = { ...lead, consented_at: undefined }
  const hash = createHash('sha256').update(stableJSON({ lead: stableLead, booking, existing })).digest('hex')
  const { data, error } = await adminDb().rpc('record_intake_v3', {
    p_source: source, p_submission: submission, p_hash: hash, p_lead: lead,
    p_booking: booking ?? null, p_existing_lead: existing, p_recipients: staffRecipients(),
  })
  if (error) {
    console.error('Intake database error', error.code)
    throw new Error(error.code === '23505' ? 'Submission ID conflict' : 'Could not save inquiry')
  }
  const result = data as IntakeResult
  // The outbox is committed before responding. Recovery handles interrupted callbacks.
  // A known lead (E10): claimed -> only the claimer gets "just booked online", no ring;
  // unclaimed -> record_intake_v3 queued the normal alert to both, worded as a booking request.
  after(async () => {
    try {
      if (result.claimed_by_phone && !result.duplicate) await notifyBookedOnline(result.lead_id, result.event_id, result.claimed_by_phone)
      else await dispatchAlert(result.event_id)
    } catch { console.error('Staff alert pending reconciliation', result.event_id) }
  })
  return result
}
