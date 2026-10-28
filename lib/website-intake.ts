import 'server-only'
import { cleanAttribution, type Attribution } from './attribution'
export function websiteLead(data: Attribution & { name?: string; phone: string; email?: string; address: string; sq_ft?: number | null; frequency?: string; preferred_date?: string; notes?: string; addon_interest?: Record<string, unknown> | null
  website_price?: { price_per_visit: unknown; first_visit_price: unknown; frequency: unknown } | null; lawn_tracing?: unknown }, form: string) {
  if (typeof data.phone !== 'string' || !/^[\d\s()+-]{7,30}$/.test(data.phone) || typeof data.address !== 'string' || !data.address.trim() || data.address.length > 500) throw new Error('Enter a valid phone and address')
  if (data.sq_ft != null && (!Number.isFinite(data.sq_ft) || data.sq_ft < 0 || data.sq_ft > 10000000)) throw new Error('Invalid lawn size')
  const attr = cleanAttribution(data)
  return {
    name: data.name?.trim().slice(0, 150) || null, phone: data.phone.trim(), email: data.email?.trim().slice(0, 254) || null,
    address: data.address.trim() || null, sq_ft: data.sq_ft == null ? null : Math.round(data.sq_ft), form_version: `${form}:1`,
    services: ['Lawn care', ...Object.keys(data.addon_interest ?? {}).filter(k => ['fertilization','mulch','leafCleanup','maintenance','yardClearout'].includes(k))], frequency: data.frequency?.slice(0, 50) || null, timing: data.preferred_date || null,
    answers: { notes: data.notes?.slice(0, 2000) }, attribution: attr,
    gclid: attr.first_touch?.gclid || null, gbraid: attr.first_touch?.gbraid || null,
    wbraid: attr.first_touch?.wbraid || null,
    google_campaign_id: attr.first_touch?.google_campaign_id || null,
    google_adgroup_id: attr.first_touch?.google_adgroup_id || null,
    google_ad_id: attr.first_touch?.google_ad_id || null,
    utm_source: attr.first_touch?.utm_source || null,
    utm_medium: attr.first_touch?.utm_medium || null, utm_campaign: attr.first_touch?.utm_campaign || null,
    utm_term: attr.first_touch?.utm_term || null, utm_content: attr.first_touch?.utm_content || null,
    // Not website_price_at: intake retries hash this payload, so it holds no server clock (created_at stands in).
    ...(websitePrice(data.website_price) ?? {}),
    ...(lawnTracing(data.lawn_tracing) ? { lawn_tracing: lawnTracing(data.lawn_tracing) } : {}),
  }
}

export type TracedSection = { name: string; sqFt: number; coords: [number, number][] | null }
const FREQUENCY_KEYS: Record<string, 'weekly' | 'biweekly' | 'monthly' | 'onetime'> = {
  weekly: 'weekly', biweekly: 'biweekly', 'bi-weekly': 'biweekly', monthly: 'monthly', onetime: 'onetime', 'one-time': 'onetime',
}

/** The instant price the customer saw (PLAN.md 3.3, S10), in whole dollars as the builder shows it. Null if anything is off. */
export function websitePrice(input: { price_per_visit: unknown; first_visit_price: unknown; frequency: unknown } | null | undefined) {
  if (!input) return null
  const price = Number(input.price_per_visit), first = Number(input.first_visit_price)
  const frequency = typeof input.frequency === 'string' ? FREQUENCY_KEYS[input.frequency.toLowerCase()] : undefined
  if (!frequency || !Number.isFinite(price) || !Number.isFinite(first) || price <= 0 || price > 100000 || first < 0 || first > 100000) return null
  return { website_price_cents: Math.round(price * 100), website_first_visit_cents: Math.round(first * 100), website_frequency: frequency }
}

/** Traced lawn shapes (S12): at most 50 sections of at most 500 points, rounded to ~10 cm. Null if empty or malformed. */
export function lawnTracing(input: unknown): TracedSection[] | null {
  if (!Array.isArray(input) || !input.length || input.length > 50) return null
  const sections: TracedSection[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null
    const { name, sqFt, coords } = raw as Record<string, unknown>
    if (typeof sqFt !== 'number' || !Number.isFinite(sqFt) || sqFt < 0 || sqFt > 10000000) return null
    let points: [number, number][] | null = null
    if (coords != null) {
      if (!Array.isArray(coords) || coords.length < 3 || coords.length > 500) return null
      points = []
      for (const point of coords) {
        if (!Array.isArray(point) || point.length !== 2) return null
        const [lng, lat] = point.map(Number)
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
        points.push([Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6])
      }
    }
    sections.push({ name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Lawn', sqFt: Math.round(sqFt), coords: points })
  }
  return JSON.stringify(sections).length <= 150000 ? sections : null
}
