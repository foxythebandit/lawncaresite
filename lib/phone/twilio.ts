import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Twilio REST, TwiML and webhook signatures (PLAN.md 7.7b R12). No SDK: plain fetch with a timeout. */

const API = 'https://api.twilio.com/2010-04-01'
export const E164 = /^\+[1-9]\d{6,14}$/
export const CALL_SID = /^CA[0-9a-f]{32}$/
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function twilioConfig() {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM_NUMBER
  return sid && token && from ? { sid, token, from } : null
}

export type TwilioResult = { ok: boolean; status: number; body: Record<string, unknown> }

/** POST (form fields) or GET against the account's REST resources, e.g. `Calls.json`. Throws on transport failure. */
export async function twilioApi(resource: string, fields?: URLSearchParams): Promise<TwilioResult> {
  const config = twilioConfig()
  if (!config) throw new Error('Twilio is not configured')
  const response = await fetch(`${API}/Accounts/${config.sid}/${resource}`, {
    method: fields ? 'POST' : 'GET', signal: AbortSignal.timeout(10000), cache: 'no-store',
    headers: { Authorization: basicAuth(config.sid, config.token), ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: fields,
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  return { ok: response.ok, status: response.status, body }
}

export const basicAuth = (sid: string, token: string) => `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`

/** "+15125550142" from what a customer typed; null when it can't be dialed (E8). */
export function dialable(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim()
  if (!raw || /[a-z]/i.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return digits.length >= 10 && E164.test(`+${digits}`) ? `+${digits}` : null
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits[1])) return `+${digits}`
  return null
}

/** Last four digits only, for logs (never log full numbers). */
export const tail = (phone: string | null | undefined) => `…${(phone ?? '').slice(-4)}`

/** Public URL Twilio calls and signs. Built from CRM_BASE_URL because request.url's host can differ on Vercel. */
export function publicUrl(path: string, query: Record<string, string> = {}): string {
  const base = new URL(process.env.CRM_BASE_URL!)
  const url = new URL(path, base.origin)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.href
}

/** X-Twilio-Signature: base64 HMAC-SHA1 over the URL plus each POST param name+value, sorted by name. */
export function twilioSignature(token: string, url: string, params: [string, string][]): string {
  const data = [...params].sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)
    .reduce((acc, [key, value]) => acc + key + value, url)
  return createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64')
}

export function validTwilioSignature(token: string, url: string, params: [string, string][], signature: string | null): boolean {
  if (!token || !signature) return false
  const expected = Buffer.from(twilioSignature(token, url, params))
  const actual = Buffer.from(signature)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Reads and verifies a Twilio webhook. Returns the form params, or null when the request is
 * not signed by our auth token for our public URL (callers answer 403 before touching the DB).
 */
export async function verifiedTwilioParams(request: Request): Promise<Record<string, string> | null> {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token || !process.env.CRM_BASE_URL) return null
  const text = await request.text().catch(() => null)
  if (text == null || text.length > 20000) return null
  const params = [...new URLSearchParams(text).entries()]
  const incoming = new URL(request.url)
  let url: string
  try { url = new URL(`${incoming.pathname}${incoming.search}`, new URL(process.env.CRM_BASE_URL).origin).href }
  catch { return null }
  if (!validTwilioSignature(token, url, params, request.headers.get('x-twilio-signature'))) return null
  return Object.fromEntries(params)
}

// TwiML
export const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const attrs = (values: Record<string, string | number | undefined>) =>
  Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${xml(String(v))}"`).join('')

export const say = (text: string) => `<Say>${xml(text)}</Say>`
export const hangup = () => '<Hangup/>'
export const redirect = (url: string) => `<Redirect method="POST">${xml(url)}</Redirect>`
export const gather = (action: string, inner: string) => `<Gather${attrs({ input: 'dtmf', numDigits: 1, timeout: 5, action, method: 'POST' })}>${inner}</Gather>`
export const dial = (number: string, options: { callerId: string; action: string; recordingStatusCallback: string }) =>
  `<Dial${attrs({ callerId: options.callerId, record: 'record-from-answer-dual', recordingStatusCallback: options.recordingStatusCallback,
    recordingStatusCallbackMethod: 'POST', recordingStatusCallbackEvent: 'completed', action: options.action, method: 'POST' })}><Number>${xml(number)}</Number></Dial>`
export const twiml = (...verbs: string[]) => `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs.join('')}</Response>`

export const twimlResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } })
export const forbidden = () => new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
