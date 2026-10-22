import 'server-only'
import { adminDb } from './supabase/admin'
import type { AlertChannel } from './crm-contracts'

export function staffRecipients(): string[] {
  const recipients = (process.env.TWILIO_STAFF_PHONES ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return recipients.length === 2 && new Set(recipients).size === 2
    && recipients.every(phone => /^\+[1-9]\d{6,14}$/.test(phone)) ? recipients : []
}

const compact = (value: unknown, limit: number) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, limit)
export function alertBody(lead: Record<string, unknown>, booking: boolean) {
  const url = new URL(process.env.CRM_BASE_URL!)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('CRM_BASE_URL must use HTTPS')
  const origin = url.origin
  if (!/^https?:[/][/][a-zA-Z0-9.:-]+$/.test(origin) || origin.length > 200) throw new Error('CRM_BASE_URL must be a hostname origin')
  const link = `${origin}/admin/leads/${lead.id}`
  const required = [booking ? 'Booking request' : 'New lead',
    `Name: ${compact(lead.name, 150) || 'Not supplied'}`,
    `Phone: ${compact(lead.phone, 30)}`,
    `Address: ${compact(lead.address, 500)}`,
    `Services: ${compact(Array.isArray(lead.services) ? lead.services.join(', ') : '', 400) || 'Not specified'}`]
  const answers = lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers)
    ? lead.answers as Record<string, unknown> : {}
  const attr = lead.attribution && typeof lead.attribution === 'object'
    ? (lead.attribution as Record<string, unknown>).first_touch as Record<string, unknown> | undefined : undefined
  const answerSummary = Object.entries(answers).filter(([key, value]) =>
    !/(password|secret|token|key)/i.test(key) && !key.startsWith('conviflo_')
    && !['address_needs_review', 'name', 'phone', 'email', 'address', 'contact'].includes(key)
    && ['string','number','boolean'].includes(typeof value))
    .slice(0, 6).map(([key, value]) => `${compact(key, 30)}=${compact(value, 60)}`).join('; ')
  const details = [lead.timing && `Timing: ${compact(lead.timing, 150)}`,
    lead.frequency && `Frequency: ${compact(lead.frequency, 50)}`,
    answerSummary && `Answers: ${answerSummary}`,
    answers.waitlist && 'Outside service area: waitlist']
  const sourceName = attr?.utm_source || ((attr?.gclid || attr?.gbraid || attr?.wbraid)
    ? 'Google Ads' : attr?.fbclid ? 'Meta (ad unknown)' : '')
  const source = [sourceName && `Source: ${compact(sourceName, 100)}`,
    attr?.utm_campaign && `Campaign: ${compact(attr.utm_campaign, 150)}`,
    attr?.meta_adset_id && `Ad set: ${compact(attr.meta_adset_id, 150)}`,
    attr?.meta_ad_id && `Ad: ${compact(attr.meta_ad_id, 150)}`,
    attr?.creative_id && `Creative: ${compact(attr.creative_id, 150)}`,
    attr?.creative_type && `Creative type: ${compact(attr.creative_type, 50)}`,
    attr?.google_campaign_id && `Google campaign: ${compact(attr.google_campaign_id, 150)}`,
    attr?.google_adgroup_id && `Google ad group: ${compact(attr.google_adgroup_id, 150)}`,
    attr?.google_ad_id && `Google ad: ${compact(attr.google_ad_id, 150)}`]
  const contentLimit = 1599 - link.length
  let priority = required.join('\n')
  let omittedSource = false
  for (const line of source.filter((value): value is string => typeof value === 'string' && !!value)) {
    if (priority.length + 1 + line.length <= contentLimit) priority += `\n${line}`
    else omittedSource = true
  }
  const sourceNotice = '\nMore source details in CRM'
  if (omittedSource && priority.length + sourceNotice.length <= contentLimit) priority += sourceNotice
  const room = Math.max(0, contentLimit - priority.length)
  const extra = details.filter(Boolean).join('\n')
  return `${priority}${room > 1 && extra ? `\n${extra.slice(0, room - 1)}` : ''}\n${link}`
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

async function sendAlert(eventId: string, current: Alert) {
  const db = adminDb()
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER, to = current.recipient
  const enabled = current.channel === 'sms' ? process.env.STAFF_SMS_ENABLED === 'true' : process.env.STAFF_VOICE_ENABLED === 'true'
  if (!enabled || !sid || !token || !from || !to || !process.env.CRM_BASE_URL) {
    await db.from('staff_alerts').update({ state: 'disabled', error_code: 'configuration_required', updated_at: new Date().toISOString() }).eq('id', current.id).in('state', ['pending','disabled'])
    return
  }
  const { data: event } = await db.from('intake_events').select('*, leads(*)').eq('id', eventId).single()
  if (!event) return
  const body = current.channel === 'sms' ? alertBody(event.leads, !!event.booking_id) : ''
  const { data: claimed, error } = await db.from('staff_alerts').update({ state: 'sending', attempts: current.attempts + 1, updated_at: new Date().toISOString(), error_code: null })
    .eq('id', current.id).eq('state', current.state).select('id').maybeSingle()
  if (error || !claimed) return
  try {
    const resource = current.channel === 'sms' ? 'Messages' : 'Calls'
    const fields = new URLSearchParams({ To: to, From: from })
    if (current.channel === 'sms') fields.set('Body', body)
    else fields.set('Twiml', '<Response><Say>New QuietGreen lead. Check your text message.</Say></Response>')
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${resource}.json`, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields,
    })
    const result = await response.json()
    const prefix = current.channel === 'sms' ? 'SM' : 'CA'
    const accepted = response.ok && new RegExp(`^${prefix}[0-9a-f]{32}$`, 'i').test(result.sid ?? '')
    const state = accepted ? 'accepted' : response.ok || response.status >= 500 ? 'unknown' : 'failed'
    const { error: saveError } = await db.from('staff_alerts').update({ state, provider_sid: accepted ? result.sid : null, provider_status: result.status ?? null,
      error_code: response.ok ? null : String(result.code ?? response.status), updated_at: new Date().toISOString() }).eq('id', current.id)
    if (saveError) console.error('SMS acceptance needs reconciliation', current.id)
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
