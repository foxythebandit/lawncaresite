/**
 * Plain-word labels for where a lead came from and what they answered (PLAN.md section 5).
 * The two tables below are filled from docs/ops-plan/RESEARCH-ads.md (A1, A2). Add rows; never
 * guess a name for an unknown ID — unknown ads show as "Facebook ad" plus Details › Tracking.
 */

/** A1: Meta ad ID → short display name. `short` is what fits on a card and in the alert text. */
export const AD_NAMES: Record<string, { name: string; short: string; format: 'video' | 'image'; group: 'AI' | 'Real People' }> = {
  // Verified launch inventory, 24 Oct 2026 (same IDs as lib/attribution.ts).
  '120253769117370725': { name: 'Everybody Loves Dave', short: 'Dave',             format: 'video', group: 'AI' },
  '120253769229100725': { name: 'I Married That Guy',   short: 'Married That Guy', format: 'video', group: 'AI' },
  '120253769229110725': { name: 'Youre Welcome',        short: 'Youre Welcome',    format: 'video', group: 'AI' },
  '120253769229120725': { name: 'Electric Mowing',      short: 'Electric Mowing',  format: 'image', group: 'AI' },
  '120253769229130725': { name: 'Split Yard',           short: 'Split Yard',       format: 'image', group: 'AI' },
  '120253769229140725': { name: 'Weekend Back',         short: 'Weekend Back',     format: 'image', group: 'AI' },
  '120253769297420725': { name: 'Night Mowing',         short: 'Night Mowing',     format: 'video', group: 'Real People' },
  '120253769297460725': { name: 'Testimonial',          short: 'Testimonial',      format: 'video', group: 'Real People' },
  '120253769297470725': { name: 'Leaf Cleanup',         short: 'Leaf Cleanup',     format: 'video', group: 'Real People' },
  '120253769297440725': { name: 'Alarm Clock',          short: 'Alarm Clock',      format: 'image', group: 'Real People' },
  '120253769297430725': { name: 'Cleaner Cut',          short: 'Cleaner Cut',      format: 'image', group: 'Real People' },
  '120253769297480725': { name: 'Before and After',     short: 'Before and After', format: 'image', group: 'Real People' },
}

/** Google Ads campaign ID or utm_campaign → name. */
export const GOOGLE_CAMPAIGN_NAMES: Record<string, string> = {}

/**
 * A2: ConviFlo answer keys → question text, and choice slugs → answer text. Keys not listed
 * fall back to a humanized key ("lawn_size" → "Lawn size"), so nothing is ever hidden.
 */
export const CONVIFLO_QUESTIONS: Record<string, string> = {
  budget: 'Budget',
  decision_maker: 'Decision maker',
  cleanup_service: 'Cleanup',
  postcode: 'ZIP',
}
export const CONVIFLO_CHOICES: Record<string, string> = {
  mowing_edging: 'Mowing + edging',
  yes: 'Yes',
  no: 'No',
}

/** Request services as plain words. */
const SERVICE_NAMES: Record<string, string> = {
  'lawn care': 'Mowing', mowing: 'Mowing', fertilization: 'Fertilizing', mulch: 'Mulch', leafcleanup: 'Leaf cleanup',
  'leaf cleanup': 'Leaf cleanup', maintenance: 'Bed maintenance', yardclearout: 'Yard clear-out', 'hedge trimming': 'Hedge trimming',
}
export function serviceLabel(value: string): string {
  return SERVICE_NAMES[value.trim().toLowerCase()] ?? humanize(value)
}
export function serviceLabels(services: unknown): string[] {
  const list = Array.isArray(services) ? services.filter((s): s is string => typeof s === 'string' && !!s.trim()) : []
  return [...new Set(list.map(serviceLabel))]
}

export function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

/** Answer keys that are intake plumbing or already shown elsewhere on the page. */
const HIDDEN_ANSWERS = new Set(['name', 'phone', 'email', 'address', 'contact', 'property_address', 'notes', 'project_description',
  'address_needs_review', 'address_missing', 'service_unmapped', 'map_screenshot_url', 'addon_interest', 'waitlist'])

/** Customer answers as label → value rows (Request block, alert text). Free text stays as typed. */
export function readableAnswers(answers: unknown): { label: string; value: string }[] {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return []
  return Object.entries(answers as Record<string, unknown>)
    .filter(([key, value]) => !HIDDEN_ANSWERS.has(key) && !key.startsWith('conviflo_') && !/(password|secret|token|key)$/i.test(key)
      && ['string', 'number', 'boolean'].includes(typeof value) && String(value).trim() !== '')
    .map(([key, value]) => {
      const raw = String(value).trim()
      const label = CONVIFLO_QUESTIONS[key] ?? humanize(key)
      const shown = typeof value === 'boolean' ? (value ? 'Yes' : 'No')
        : CONVIFLO_CHOICES[raw] ?? (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(raw) ? humanize(raw) : raw)
      return { label, value: shown }
    })
}

type Touch = Partial<Record<string, unknown>>
const str = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

/** Where a lead came from, in plain words: a channel chip plus an optional ad/campaign chip. */
export function leadSource(lead: { source?: string | null; attribution?: unknown } & Touch): { channel: string; detail: string | null; conviflo: boolean } {
  const attribution = lead.attribution && typeof lead.attribution === 'object' && !Array.isArray(lead.attribution)
    ? lead.attribution as Record<string, unknown> : {}
  const first = attribution.first_touch && typeof attribution.first_touch === 'object' ? attribution.first_touch as Touch : attribution
  const touch: Touch = Object.keys(first).length ? first : lead
  const conviflo = lead.source === 'conviflo'
  const source = str(touch.utm_source)?.toLowerCase() ?? ''
  const adId = str(touch.meta_ad_id) ?? (source === 'meta' && touch.utm_campaign === '120253769117350725' ? str(touch.utm_content) : null)
  const ad = adId && Object.hasOwn(AD_NAMES, adId) ? AD_NAMES[adId] : null
  if (ad || adId || touch.fbclid || ['meta', 'facebook', 'fb', 'instagram', 'ig'].includes(source)) {
    return { channel: 'Facebook ad', detail: ad ? `${ad.short} · ${ad.format}` : null, conviflo }
  }
  if (touch.gclid || touch.gbraid || touch.wbraid || (source === 'google' && ['cpc', 'ppc', 'paid', 'paid_search'].includes(String(touch.utm_medium ?? '').toLowerCase()))) {
    const campaign = str(touch.google_campaign_id) ?? str(touch.utm_campaign)
    return { channel: 'Google search ad', detail: campaign ? GOOGLE_CAMPAIGN_NAMES[campaign] ?? null : null, conviflo }
  }
  if (source === 'google') return { channel: 'Google search (free)', detail: null, conviflo }
  if (source) return { channel: humanize(source), detail: null, conviflo }
  if (conviflo) return { channel: 'ConviFlo form', detail: null, conviflo }
  return { channel: 'Typed in / unknown', detail: null, conviflo }
}
