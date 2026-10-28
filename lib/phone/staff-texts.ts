import 'server-only'
import { adminDb } from '../supabase/admin'
import { E164, tail, twilioApi, twilioConfig } from './twilio'

export type StaffTextKind = 'map' | 'claimed' | 'not_taken' | 'booked_online' | 'outcome' | 'reminder' | 'call_now'
export type StaffText = {
  leadId: string; eventId?: string | null; kind: StaffTextKind; recipient: string
  body: string; mediaUrl?: string | null; dedupeKey: string
}

/**
 * Staff text other than the intake alert (PLAN.md 7.3). Recorded in staff_texts first, so the
 * CRM can show it and a repeat (Twilio retry, double press) with the same dedupe key never
 * sends twice. Respects STAFF_SMS_ENABLED (R15). Never throws.
 */
export async function sendStaffText(text: StaffText): Promise<'sent' | 'duplicate' | 'disabled' | 'failed'> {
  try {
    if (!E164.test(text.recipient) || (!text.body && !text.mediaUrl)) return 'failed'
    const db = adminDb()
    const config = twilioConfig()
    const enabled = process.env.STAFF_SMS_ENABLED === 'true' && !!config
    const { data: rows, error } = await db.from('staff_texts').upsert({
      lead_id: text.leadId, event_id: text.eventId ?? null, kind: text.kind, recipient: text.recipient,
      body: text.body, has_media: !!text.mediaUrl, dedupe_key: text.dedupeKey,
      state: enabled ? 'pending' : 'disabled', error_code: enabled ? null : 'configuration_required',
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id')
    if (error) { console.error('Staff text not recorded', text.kind, error.code); return 'failed' }
    const id = rows?.[0]?.id
    if (!id) return 'duplicate'
    if (!enabled || !config) return 'disabled'
    const fields = new URLSearchParams({ To: text.recipient, From: config.from })
    if (text.body) fields.set('Body', text.body)
    if (text.mediaUrl) fields.set('MediaUrl', text.mediaUrl)
    try {
      const result = await twilioApi('Messages.json', fields)
      const sid = typeof result.body.sid === 'string' && /^(SM|MM)[0-9a-f]{32}$/.test(result.body.sid) ? result.body.sid : null
      await db.from('staff_texts').update({
        state: sid ? 'accepted' : result.ok || result.status >= 500 ? 'unknown' : 'failed', provider_sid: sid,
        provider_status: typeof result.body.status === 'string' ? result.body.status : null,
        error_code: result.ok ? null : String(result.body.code ?? result.status), updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (!sid) console.error('Staff text not accepted', text.kind, tail(text.recipient))
      return sid ? 'sent' : 'failed'
    } catch {
      await db.from('staff_texts').update({ state: 'unknown', error_code: 'transport_or_response_unknown', updated_at: new Date().toISOString() }).eq('id', id)
      return 'failed'
    }
  } catch {
    console.error('Staff text failed', text.kind)
    return 'failed'
  }
}
