export interface Attribution {
  gclid?:        string
  utm_source?:   string
  utm_medium?:   string
  utm_campaign?: string
  utm_term?:     string
  utm_content?:  string
}

const COOKIE_NAME  = 'qg_attr'
const MAX_AGE_DAYS = 90
const TRACKED_KEYS: (keyof Attribution)[] = ['gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function writeCookie(name: string, value: string, days: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${days * 24 * 60 * 60}; path=/; SameSite=Lax`
}

/** Call once on app load. Captures ad-click params from the URL, if present, and persists
 *  them so the visit that first brought someone in stays attributed even after they've
 *  navigated around or come back later — later visits without tracking params don't overwrite it. */
export function captureAttribution() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const found: Attribution = {}
  let hasAny = false
  for (const key of TRACKED_KEYS) {
    const val = params.get(key)
    if (val) { found[key] = val; hasAny = true }
  }
  if (hasAny) writeCookie(COOKIE_NAME, JSON.stringify(found), MAX_AGE_DAYS)
}

/** Read whatever attribution was captured for this visitor, if any. */
export function getAttribution(): Attribution {
  if (typeof window === 'undefined') return {}
  const raw = readCookie(COOKIE_NAME)
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

/** Human-readable source summary for admin/emails, e.g. "Google Ads · electric lawn mowing austin". */
export function formatAttributionLabel(attr: Partial<Record<keyof Attribution, string | null | undefined>>): string | null {
  if (!attr.utm_source && !attr.gclid) return null
  const source = attr.utm_source
    ? attr.utm_source[0].toUpperCase() + attr.utm_source.slice(1)
    : attr.gclid ? 'Google Ads' : 'Unknown'
  const parts = [source]
  if (attr.utm_term) parts.push(`"${attr.utm_term}"`)
  else if (attr.utm_campaign) parts.push(attr.utm_campaign)
  else if (attr.gclid) parts.push('(keyword not tagged)')
  return parts.join(' · ')
}
