import 'server-only'
import { adminDb } from './supabase/admin'
import type { AlertChannel } from './crm-contracts'
import { alertText, isTestLead, type SummaryLead } from './lead-summary'
import { signedMapUrl } from './map-screenshot'
import { startAlertLeg, recordAlertLeg } from './phone/legs'
import { sendStaffText } from './phone/staff-texts'
import { dialable, twilioApi, twilioConfig } from './phone/twilio'

export function staffRecipients(): string[] {
  const recipients = (process.env.TWILIO_STAFF_PHONES ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return recipients.length === 2 && new Set(recipients).size === 2
    && recipients.every(phone => /^\+[1-9]\d{6,14}$/.test(phone)) ? recipients : []
}

type Alert = { id: string; recipient: string; channel: AlertChannel; state: string; attempts: number }

export async function dispatchAlert(eventId: string, alertId?: string) {
  const db = adminDb()
  const { data: unresolved, error: unresolvedError } = await db.from('staff_alerts')
    .select('id').eq('event_id', eventId).eq('recipient', '')
  if (unresolvedError) throw unresolvedError
  if (unresolved?.length) {
    const recipients = staffRecipients()
    if (!recipients.length) {
      await db.from('staff_alerts').update({ state: 'disabled', error_code: 'two_staff_recipients_required', updated_at: new Date().toISOString() })
        .eq('event_id', eventId).eq('recipient', '')
      throw new Error('Two staff recipients must be configured')
    }
    const { data: event, error: eventError } = await db.from('intake_events').select('alert_version').eq('id', eventId).single()
    if (eventError || !event) throw eventError ?? new Error('Missing intake event')
    const channels: AlertChannel[] = event.alert_version === 2 ? ['sms', 'voice'] : ['sms']
    const { error } = await db.from('staff_alerts').upsert(
      recipients.flatMap(recipient => channels.map(channel => ({ event_id: eventId, recipient, channel }))),
      { onConflict: 'event_id,recipient,channel', ignoreDuplicates: true })
    if (error) throw error
    const { error: deleteError } = await db.from('staff_alerts').delete().eq('event_id', eventId).eq('recipient', '')
    if (deleteError) throw deleteError
    if (unresolved.some(row => row.id === alertId)) alertId = undefined
  }
  const { data: alerts, error } = await db.from('staff_alerts').select('id, recipient, channel, state, attempts')
    .eq('event_id', eventId).in('state', ['pending', 'disabled']).neq('recipient', '')
  if (error) throw error
  await Promise.all((alerts ?? []).filter(alert => !alertId || alert.id === alertId).map(alert => sendAlert(eventId, alert as Alert)))
}

const VOICE_MAX_AGE_MS = 15 * 60 * 1000
// Recovery may send a late text, but never old ones: switching STAFF_SMS_ENABLED on must not
// replay every lead whose text was held while texting was off.
const SMS_MAX_AGE_MS = 60 * 60 * 1000

function crmBaseUrl() {
  const url = new URL(process.env.CRM_BASE_URL!)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('CRM_BASE_URL must use HTTPS')
  return url.origin
}

/**
 * One alert intent (PLAN.md 7.2). SMS: the approved alert text, then the map image as a
 * second message (R8). Voice: the press-1 ring (Timeout 20 s, no machine detection); TEST
 * leads, leads without a dialable phone and rings older than 15 minutes are skipped (E8, E20);
 * texts older than an hour are skipped too.
 */
async function sendAlert(eventId: string, current: Alert) {
  const db = adminDb()
  const config = twilioConfig(), to = current.recipient
  const enabled = current.channel === 'sms' ? process.env.STAFF_SMS_ENABLED === 'true' : process.env.STAFF_VOICE_ENABLED === 'true'
  const { data: event } = await db.from('intake_events').select('id, created_at, booking_id, leads(*)').eq('id', eventId).single()
  if (!event?.leads) return
  const lead = event.leads as unknown as SummaryLead
  // Decided before the on/off check, so held alerts age out instead of piling up while disabled.
  const age = Date.now() - Date.parse(event.created_at)
  const skip = current.channel === 'sms' ? (age > SMS_MAX_AGE_MS ? 'expired' : null)
    : isTestLead(lead) ? 'test_lead' : !dialable(lead.phone) ? 'no_valid_phone' : age > VOICE_MAX_AGE_MS ? 'expired' : null
  if (skip) {
    await db.from('staff_alerts').update({ state: 'skipped', error_code: skip, updated_at: new Date().toISOString() }).eq('id', current.id).in('state', ['pending','disabled'])
    return
  }
  if (!enabled || !config || !to || !process.env.CRM_BASE_URL) {
    await db.from('staff_alerts').update({ state: 'disabled', error_code: 'configuration_required', updated_at: new Date().toISOString() }).eq('id', current.id).in('state', ['pending','disabled'])
    return
  }
  const { data: bookings } = current.channel === 'sms' ? await db.from('bookings').select('*').eq('lead_id', lead.id) : { data: [] }
  const body = current.channel === 'sms' ? alertText(lead, bookings ?? [], crmBaseUrl(), event.booking_id ? 'booking' : 'new') : ''
  const { data: claimed, error } = await db.from('staff_alerts').update({ state: 'sending', attempts: current.attempts + 1, updated_at: new Date().toISOString(), error_code: null })
    .eq('id', current.id).eq('state', current.state).select('id').maybeSingle()
  if (error || !claimed) return
  let fields: URLSearchParams, legId: string | null = null
  if (current.channel === 'sms') fields = new URLSearchParams({ To: to, From: config.from, Body: body })
  else {
    try {
      const leg = await startAlertLeg(eventId, lead.id, to, config.from)
      if (leg.placedSid) {
        await db.from('staff_alerts').update({ state: 'accepted', provider_sid: leg.placedSid, updated_at: new Date().toISOString() }).eq('id', current.id)
        return
      }
      legId = leg.id; fields = leg.fields
    } catch {
      await db.from('staff_alerts').update({ state: 'failed', error_code: 'alert_leg_not_recorded', updated_at: new Date().toISOString() }).eq('id', current.id)
      return
    }
  }
  try {
    const result = await twilioApi(current.channel === 'sms' ? 'Messages.json' : 'Calls.json', fields)
    const prefix = current.channel === 'sms' ? '(SM|MM)' : 'CA'
    const sid = typeof result.body.sid === 'string' && new RegExp(`^${prefix}[0-9a-f]{32}$`, 'i').test(result.body.sid) ? result.body.sid : null
    const state = sid ? 'accepted' : result.ok || result.status >= 500 ? 'unknown' : 'failed'
    if (legId) await recordAlertLeg(legId, sid)
    const { error: saveError } = await db.from('staff_alerts').update({ state, provider_sid: sid, provider_status: result.body.status ?? null,
      error_code: result.ok ? null : String(result.body.code ?? result.status), updated_at: new Date().toISOString() }).eq('id', current.id)
    if (saveError) console.error('Alert acceptance needs reconciliation', current.id)
    if (sid && current.channel === 'sms') {
      // P7: signed link, valid long enough for Twilio to fetch it. Leads without a map get the text only.
      const booking = (bookings ?? []).find(b => b.id === event.booking_id)
      const mediaUrl = await signedMapUrl(lead.map_screenshot_url as string | null ?? booking?.map_screenshot_url)
      if (mediaUrl) await sendStaffText({ leadId: lead.id, eventId, kind: 'map', recipient: to, body: '', mediaUrl, dedupeKey: `map:${eventId}:${to}` })
    }
  } catch {
    await db.from('staff_alerts').update({ state: 'unknown', error_code: 'transport_or_response_unknown', updated_at: new Date().toISOString() }).eq('id', current.id)
  }
}

/** Provider status does not establish that a staff member answered or read an alert. */
export async function refreshAlert(id: string) {
  const db = adminDb()
  const { data: alert } = await db.from('staff_alerts').select('*').eq('id', id).single()
  if (!alert?.provider_sid || !/^(SM|CA)[0-9a-f]{32}$/i.test(alert.provider_sid)) return
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return
  const resource = alert.channel === 'voice' ? 'Calls' : 'Messages'
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${resource}/${alert.provider_sid}.json`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return
  const result = await res.json()
  const delivered = alert.channel === 'voice' ? result.status === 'completed' : result.status === 'delivered'
  const state = delivered ? 'delivered' : ['failed','undelivered','canceled','busy','no-answer'].includes(result.status) ? 'failed' : 'accepted'
  await db.from('staff_alerts').update({ state, provider_status: result.status, error_code: result.error_code ? String(result.error_code) : null, updated_at: new Date().toISOString() }).eq('id', id)
}

/** Bounded invocation for a trusted external scheduler; no implicit retries of unknown outcomes. */
export async function recoverStaffAlerts(limit = 20) {
  const db = adminDb()
  const stale = new Date(Date.now() - 120000).toISOString()
  const { error: staleError } = await db.from('staff_alerts').update({ state: 'unknown', error_code: 'claim_interrupted', updated_at: new Date().toISOString() })
    .eq('state', 'sending').lt('updated_at', stale)
  if (staleError) throw staleError
  const bounded = Math.min(Math.max(limit, 1), 50)
  const { data: pending, error: pendingError } = await db.from('staff_alerts').select('event_id')
    .eq('state', 'pending').order('updated_at').limit(bounded)
  if (pendingError) throw pendingError
  const eventIds = [...new Set((pending ?? []).map(row => row.event_id))]
  if (eventIds.length < bounded) {
    const { data: disabled, error: disabledError } = await db.from('staff_alerts').select('event_id')
      .eq('state', 'disabled').order('updated_at').limit(bounded - eventIds.length)
    if (disabledError) throw disabledError
    for (const row of disabled ?? []) if (!eventIds.includes(row.event_id)) eventIds.push(row.event_id)
  }
  let failed = 0
  for (const eventId of eventIds) {
    try { await dispatchAlert(eventId) }
    catch { failed += 1 }
  }
  return { events: eventIds.length, failed }
}
