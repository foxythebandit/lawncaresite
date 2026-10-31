export const ATTRIBUTION_KEYS = ['gclid', 'gbraid', 'wbraid', 'google_campaign_id', 'google_adgroup_id', 'google_ad_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'fbc', 'fbp', 'meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'creative_id', 'creative_type'] as const
export type AttributionTouch = Partial<Record<typeof ATTRIBUTION_KEYS[number], string>> & { captured_at?: string; source_url?: string }
export interface Attribution extends AttributionTouch {
  first_touch?: AttributionTouch
  latest_touch?: AttributionTouch
}
const COOKIE_NAME = 'qg_attr'
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  try { return match ? decodeURIComponent(match[1]) : null } catch { return null }
}
export function cleanTouch(input: unknown): AttributionTouch {
  if (!input || typeof input !== 'object') return {}
  const data = input as Record<string, unknown>, result: AttributionTouch = {}
  for (const key of ATTRIBUTION_KEYS) if (typeof data[key] === 'string') result[key] = data[key].slice(0, 150)
  // Only campaigns explicitly configured with ID macros interpret UTM terms/content as IDs.
  const idCampaigns = (process.env.NEXT_PUBLIC_META_UTM_ID_CAMPAIGNS ?? '').split(',').map(s => s.trim())
  if (result.utm_source?.toLowerCase() === 'meta' && result.utm_medium === 'paid_social'
    && !!result.utm_campaign && idCampaigns.includes(result.utm_campaign)) {
    if (!result.meta_campaign_id) result.meta_campaign_id = result.utm_campaign
    if (!result.meta_adset_id && /^\d{1,30}$/.test(result.utm_term ?? '')) result.meta_adset_id = result.utm_term
    if (!result.meta_ad_id && /^\d{1,30}$/.test(result.utm_content ?? '')) result.meta_ad_id = result.utm_content
  }
  if (typeof data.captured_at === 'string' && Number.isFinite(Date.parse(data.captured_at))) result.captured_at = data.captured_at
  if (typeof data.source_url === 'string') {
    try { const u = new URL(data.source_url); if (['http:','https:'].includes(u.protocol)) result.source_url = u.origin } catch {}
  }
  return result
}
export function cleanAttribution(input: Attribution): Attribution {
  return { ...cleanTouch(input), first_touch: cleanTouch(input.first_touch ?? input), latest_touch: cleanTouch(input.latest_touch ?? input) }
}
/** First tagged touch remains fixed for 90 days; latest tagged touch changes only on tagged visits. */
export function captureAttribution() {
  if (typeof window === 'undefined' || location.pathname.startsWith('/admin')) return
  const params = new URLSearchParams(location.search)
  const found: AttributionTouch = {}
  for (const key of ATTRIBUTION_KEYS) { const value = params.get(key); if (value) found[key] = value.slice(0, 150) }
  if (!Object.keys(found).length) return
  const now = Date.now()
  found.captured_at = new Date(now).toISOString()
  found.source_url = location.origin // No addresses, query strings, or other personal data in URLs.
  found.fbp = readCookie('_fbp') ?? undefined
  found.fbc = found.fbclid ? `fb.1.${now}.${found.fbclid}` : readCookie('_fbc') ?? undefined
  const old = getAttribution()
  const first = old.first_touch && Object.keys(old.first_touch).length ? old.first_touch : cleanTouch(old)
  const value = { ...found, first_touch: Object.keys(first).length ? first : found, latest_touch: found }
  // Cookie has a fixed expiry based on first touch, rather than a rolling retention period.
  const expiry = Date.parse(value.first_touch.captured_at ?? found.captured_at) + 90 * 86400000
  try { localStorage.setItem(COOKIE_NAME, JSON.stringify({ value, expiry })) } catch { /* Storage may be disabled. Missing attribution stays unknown. */ }
}
function browserIds(value: Attribution): Attribution {
  return { ...value, fbp: readCookie('_fbp')?.slice(0, 150) ?? value.fbp, fbc: value.fbc ?? readCookie('_fbc')?.slice(0, 150) }
}
export function getAttribution(): Attribution {
  if (typeof window === 'undefined') return {}
  try {
    const stored = JSON.parse(localStorage.getItem(COOKIE_NAME) ?? 'null')
    if (stored?.expiry > Date.now()) return browserIds(cleanAttribution(stored.value))
    if (stored) { localStorage.removeItem(COOKIE_NAME); return browserIds({}) }
    return browserIds(cleanAttribution(JSON.parse(readCookie(COOKIE_NAME) ?? '{}')))
  } catch { return {} }
}
export function creativeTypeLabel(value: unknown): unknown {
  return value === 'ai' ? 'AI creative' : value === 'real' ? 'Real creative' : value
}
// Verified launch inventory, 24 Oct 2026. Public ad IDs, not customer data.
// Resolve on display so existing website and ConviFlo leads need no backfill.
// New/duplicated ads need their own entry; never guess a format from an unknown ID.
const launchAds: Record<string, { group: string; format: string; name: string }> = {
  '120253769117370725': { group: 'AI', format: 'Video', name: 'Everybody Loves Dave' },
  '120253769229100725': { group: 'AI', format: 'Video', name: 'I Married That Guy' },
  '120253769229110725': { group: 'AI', format: 'Video', name: 'Youre Welcome' },
  '120253769229120725': { group: 'AI', format: 'Still image', name: 'Electric Mowing' },
  '120253769229130725': { group: 'AI', format: 'Still image', name: 'Split Yard' },
  '120253769229140725': { group: 'AI', format: 'Still image', name: 'Weekend Back' },
  '120253769297420725': { group: 'Real People', format: 'Video', name: 'Night Mowing' },
  '120253769297460725': { group: 'Real People', format: 'Video', name: 'Testimonial' },
  '120253769297470725': { group: 'Real People', format: 'Video', name: 'Leaf Cleanup' },
  '120253769297440725': { group: 'Real People', format: 'Still image', name: 'Alarm Clock' },
  '120253769297430725': { group: 'Real People', format: 'Still image', name: 'Cleaner Cut' },
  '120253769297480725': { group: 'Real People', format: 'Still image', name: 'Before and After' },
}
export function formatAttributionLabel(attr: Partial<Record<typeof ATTRIBUTION_KEYS[number], string | null>> | null | undefined): string | null {
  if (!attr) return null
  // Legacy website records have the ID only in UTM content. Interpret that field
  // only for this verified Meta campaign, never for Google or generic UTM tags.
  const adId = attr.meta_ad_id || (attr.utm_source?.toLowerCase() === 'meta'
    && attr.utm_campaign === '120253769117350725' ? attr.utm_content : null)
  const ad = adId && Object.hasOwn(launchAds, adId) ? launchAds[adId] : null
  if (ad) return ['Meta', ad.group, ad.format, ad.name].join(' · ')
  const source = attr.utm_source || ((attr.gclid || attr.gbraid || attr.wbraid) ? 'Google Ads' : attr.fbclid ? 'Meta (ad unknown)' : '')
  if (!source) return null
  return [source, attr.utm_campaign, attr.utm_term, attr.utm_content, attr.creative_id, creativeTypeLabel(attr.creative_type),
    attr.google_campaign_id, attr.google_adgroup_id, attr.google_ad_id].filter(Boolean).join(' · ')
}
