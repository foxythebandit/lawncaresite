import 'server-only'
import { adminDb } from './supabase/admin'

// Restrict to single-unit GSM characters; summary + opaque link fits at most two segments.
const compact = (value: unknown, limit: number) => String(value ?? '').normalize('NFKD').replace(/[^a-zA-Z0-9 .,/'()+:-]/g, '').slice(0, limit)
export function alertBody(lead: Record<string, unknown>, booking: boolean) {
  const url = new URL(process.env.CRM_BASE_URL!)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('CRM_BASE_URL must use HTTPS')
  const origin = url.origin
  if (!/^https?:[/][/][a-zA-Z0-9.:-]+$/.test(origin) || origin.length > 200) throw new Error('CRM_BASE_URL must be a short hostname origin')
  const summary = [booking ? 'Booking request' : 'Quote inquiry', compact(lead.name, 28), compact(lead.address, 65),
    compact(Array.isArray(lead.services) ? lead.services.join(', ') : '', 35), compact([lead.timing, lead.frequency].filter(Boolean).join(' / '), 35)].filter(Boolean).join(' / ')
  const link = `${origin}/admin/leads/${lead.id}`
  return `${summary.slice(0, Math.max(0, 305 - link.length))}\n${link}`
}

type Alert = { id: string; recipient: string; state: string; attempts: number }

export async function dispatchAlert(eventId: string, alertId?: string) {
  const db = adminDb()
  const { data: unresolved } = await db.from('staff_alerts').select('id').eq('event_id', eventId).eq('recipient', '').in('state', ['pending', 'disabled']).maybeSingle()
  if (unresolved) {
    const recipients = [...new Set((process.env.TWILIO_STAFF_PHONES || process.env.TWILIO_STAFF_PHONE || process.env.TWILIO_OWNER_PHONE || '').split(',').map(s => s.trim()).filter(Boolean))]
    if (!recipients.length || recipients.some(phone => !/^\+[1-9]\d{6,14}$/.test(phone))) {
      await db.from('staff_alerts').update({ state: 'disabled', error_code: 'recipient_configuration_required' }).eq('id', unresolved.id)
      return
    }
    // Keep the unresolved intent until every recipient row is durable. A crash/retry
    // can repeat this upsert without overwriting an accepted message's state.
    const { error } = await db.from('staff_alerts').upsert(recipients.map(recipient => ({ event_id: eventId, recipient })), { onConflict: 'event_id,recipient', ignoreDuplicates: true })
    if (error) throw error
    await db.from('staff_alerts').delete().eq('id', unresolved.id).in('state', ['pending', 'disabled'])
    if (alertId === unresolved.id) alertId = undefined
  }
  const { data: alerts } = await db.from('staff_alerts').select('id, recipient, state, attempts').eq('event_id', eventId).in('state', ['pending', 'disabled']).neq('recipient', '')
  await Promise.all((alerts ?? []).filter(alert => !alertId || alert.id === alertId).map(alert => sendAlert(eventId, alert)))
}

async function sendAlert(eventId: string, current: Alert) {
  const db = adminDb()
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER, to = current.recipient
  if (process.env.STAFF_SMS_ENABLED !== 'true' || !sid || !token || !from || !to || !process.env.CRM_BASE_URL) {
    await db.from('staff_alerts').update({ state: 'disabled', error_code: 'configuration_required' }).eq('id', current.id).in('state', ['pending','disabled'])
    return
  }
  const { data: event } = await db.from('intake_events').select('*, leads(*)').eq('id', eventId).single()
  if (!event) return
  const body = alertBody(event.leads, !!event.booking_id)
  const { data: claimed, error } = await db.from('staff_alerts').update({ state: 'sending', attempts: current.attempts + 1, updated_at: new Date().toISOString(), error_code: null })
    .eq('id', current.id).eq('state', current.state).select('id').maybeSingle()
  if (error || !claimed) return
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    })
    const result = await response.json()
    const state = response.ok && /^SM[0-9a-f]{32}$/i.test(result.sid ?? '') ? 'accepted' : response.ok || response.status >= 500 ? 'unknown' : 'failed'
    const { error: saveError } = await db.from('staff_alerts').update({ state, provider_sid: result.sid ?? null, provider_status: result.status ?? null,
      error_code: response.ok ? null : String(result.code ?? response.status), updated_at: new Date().toISOString() }).eq('id', current.id)
    if (saveError) console.error('SMS acceptance needs reconciliation', current.id)
  } catch {
    await db.from('staff_alerts').update({ state: 'unknown', error_code: 'transport_or_response_unknown', updated_at: new Date().toISOString() }).eq('id', current.id)
  }
}

/** Read-only provider lookup avoids adding an unauthenticated status callback surface. */
export async function refreshAlert(id: string) {
  const db = adminDb()
  const { data: alert } = await db.from('staff_alerts').select('*').eq('id', id).single()
  if (!alert?.provider_sid || !/^SM[0-9a-f]{32}$/i.test(alert.provider_sid)) return
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${alert.provider_sid}.json`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return
  const result = await res.json()
  const state = result.status === 'delivered' ? 'delivered' : ['failed','undelivered','canceled'].includes(result.status) ? 'failed' : 'accepted'
  await db.from('staff_alerts').update({ state, provider_status: result.status, error_code: result.error_code ? String(result.error_code) : null, updated_at: new Date().toISOString() }).eq('id', id)
}
