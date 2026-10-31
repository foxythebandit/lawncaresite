// Both website address fields use the same Photon labels, US filter, and Austin bias.
// 807 E 47th St, Austin TX
export const OFFICE_LAT = 30.3049
export const OFFICE_LNG = -97.7184

export type GeoResult = {
  label: string; lat: number; lon: number
  precision?: 'address' | 'approximate'
  houseNumber?: string; street?: string; postcode?: string; city?: string; state?: string
  provider?: 'photon' | 'nominatim'
}

type PhotonFeature = {
  geometry: { coordinates: [number, number] }
  properties: { name?: string; housenumber?: string; street?: string; city?: string; state?: string; postcode?: string; countrycode?: string }
}

const WORDS: Record<string, string> = {
  street: 'st', drive: 'dr', avenue: 'ave', road: 'rd', lane: 'ln', court: 'ct',
  boulevard: 'blvd', circle: 'cir', parkway: 'pkwy', place: 'pl', terrace: 'ter',
  north: 'n', south: 's', east: 'e', west: 'w', northwest: 'nw', northeast: 'ne', southwest: 'sw', southeast: 'se',
}
const DIRECTION = /^(n|s|e|w|ne|nw|se|sw)$/
const STREET_END = /^(.+\s+(?:street|st|drive|dr|avenue|ave|road|rd|lane|ln|court|ct|boulevard|blvd|circle|cir|parkway|pkwy|place|pl|terrace|ter)\b\.?(?:\s+(?:northwest|northeast|southwest|southeast|north|south|east|west|nw|ne|sw|se|n|s|e|w)\b)?)/i
function normalized(value: string): string {
  const words = value.toLowerCase().replace(/[.,]/g, '').trim().split(/\s+/).map(word => WORDS[word] ?? word)
  // Postal street directions may appear before or after the street name.
  if (words.length > 2 && DIRECTION.test(words.at(-1)!) && !DIRECTION.test(words[0])) words.unshift(words.pop()!)
  return words.join(' ')
}
function requestedAddress(query: string) {
  const parts = query.trim().split(',').map(part => part.trim())
  const house = parts[0].match(/^(\d+[a-z]?(?:-\d+)?)\s+(.+)$/i)
  const postcode = query.match(/\b\d{5}(?:-\d{4})?\b/)?.[0].slice(0, 5) ?? query.match(/\b(?:TX|Texas)\s*(\d{5})\b/i)?.[1]
  const street = house?.[2].match(STREET_END)?.[1] ?? house?.[2]
  const remainder = parts.length > 1 ? parts[1] : house?.[2].slice(street?.length ?? 0).trim()
  const city = remainder?.replace(/\b(?:TX|Texas)(?=\s|\d|$).*$/i, '').replace(/\b\d{5}(?:-\d{4})?\b/, '').trim() || undefined
  const state = query.match(/\b(TX|Texas)(?=\s|\d|$)/i)?.[1]
  return { houseNumber: house?.[1], street, postcode, city, state }
}
function coordinate(value: unknown): number {
  return typeof value === 'number' || (typeof value === 'string' && !!value.trim()) ? Number(value) : NaN
}
function validPoint(hit: GeoResult): boolean {
  return typeof hit.label === 'string' && !!hit.label.trim() && Number.isFinite(hit.lat) && Math.abs(hit.lat) <= 90 && Number.isFinite(hit.lon) && Math.abs(hit.lon) <= 180
}
function matchesAddress(query: string, hit: GeoResult): boolean {
  const wanted = requestedAddress(query)
  if (wanted.houseNumber && (!hit.houseNumber || !hit.street || normalized(wanted.houseNumber) !== normalized(hit.houseNumber) || normalized(wanted.street!) !== normalized(hit.street))) return false
  if (wanted.postcode && wanted.postcode !== hit.postcode?.slice(0, 5)) return false
  if (wanted.city && hit.city && normalized(wanted.city) !== normalized(hit.city)) return false
  if (wanted.state && hit.state && !['tx', 'texas'].includes(hit.state.toLowerCase())) return false
  return validPoint(hit)
}
function photonLabel(p: PhotonFeature['properties']): string {
  const line1 = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street ?? p.name ?? ''
  return [line1, p.city, [p.state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

export async function photonSearch(query: string, limit: number, signal?: AbortSignal): Promise<GeoResult[]> {
  signal?.throwIfAborted()
  const count = Math.max(1, Math.min(10, Math.floor(limit) || 1))
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${count * 2}&lang=en&lat=${OFFICE_LAT}&lon=${OFFICE_LNG}`,
    { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3500)]) : AbortSignal.timeout(3500) }
  )
  if (!res.ok) throw new Error(`Photon ${res.status}`)
  const { features } = await res.json() as { features: PhotonFeature[] }
  signal?.throwIfAborted()
  const seen = new Set<string>()
  const results: GeoResult[] = []
  for (const f of features) {
    if (f.properties.countrycode !== 'US') continue
    const p = f.properties
    const hit: GeoResult = {
      label: photonLabel(p), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      provider: 'photon', houseNumber: p.housenumber, street: p.street, postcode: p.postcode, city: p.city, state: p.state,
      precision: p.housenumber && p.street ? 'address' : 'approximate',
    }
    if (!validPoint(hit) || seen.has(hit.label)) continue
    // Fuzzy suggestions can still be useful, but must not claim a different house is exact.
    if (!matchesAddress(query, hit)) hit.precision = 'approximate'
    seen.add(hit.label)
    results.push(hit)
  }
  return results.slice(0, count)
}

const GEOCODE_BIAS = `countrycodes=us&viewbox=${OFFICE_LNG - 0.6},${OFFICE_LAT + 0.5},${OFFICE_LNG + 0.6},${OFFICE_LAT - 0.5}&bounded=0`

// This page shares one final-search queue. Public Nominatim's one request/sec
// limit applies to the whole application; this is not a multi-user server limiter.
let nextFinalSearch = 0
async function waitForFinalSearch(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  while (Date.now() < nextFinalSearch) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, nextFinalSearch - Date.now())
      signal.addEventListener('abort', abort, { once: true })
    })
    signal.throwIfAborted()
  }
  // Reserve only an actual start: cancelled waiters cannot fill future slots.
  nextFinalSearch = Date.now() + 1100
}

// Explicit final searches only: Nominatim prohibits autocomplete. Where a ZIP is
// supplied, structured street/ZIP avoids locality gaps (e.g. Danish Drive's OSM
// house is in Williamson County without a Hutto city value). Validate the result
// against the original input; never downgrade a requested house to a road.
export async function geocodeAddress(address: string, signal?: AbortSignal): Promise<GeoResult | null> {
  signal?.throwIfAborted()
  const budget = AbortSignal.timeout(6500)
  const overall = signal ? AbortSignal.any([signal, budget]) : budget
  const wanted = requestedAddress(address)
  const search = wanted.houseNumber && wanted.postcode
    ? new URLSearchParams({ street: `${wanted.houseNumber} ${wanted.street}`, postalcode: wanted.postcode, ...(wanted.state ? { state: wanted.state } : {}) }).toString()
    : `q=${encodeURIComponent(address)}`
  try {
    await waitForFinalSearch(overall)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&${search}&limit=1&${GEOCODE_BIAS}`,
      { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.any([overall, AbortSignal.timeout(3500)]) }
    )
    signal?.throwIfAborted()
    if (res.ok) {
      const data = await res.json()
      signal?.throwIfAborted()
      if (Array.isArray(data) && data.length) {
        const p = data[0].address ?? {}
        const hit: GeoResult = {
          label: data[0].display_name, lat: coordinate(data[0].lat), lon: coordinate(data[0].lon),
          provider: 'nominatim', houseNumber: p.house_number, street: p.road,
          postcode: p.postcode, city: p.city ?? p.town ?? p.village, state: p.state,
          precision: wanted.houseNumber && p.house_number && p.road ? 'address' : 'approximate',
        }
        if (p.country_code === 'us' && matchesAddress(address, hit)) return hit
      }
    }
  } catch { signal?.throwIfAborted() }
  if (overall.aborted) return null
  try {
    const hits = await photonSearch(address, 3, overall)
    signal?.throwIfAborted()
    const hit = hits.find(hit => matchesAddress(address, hit))
    return hit ? wanted.houseNumber ? hit : { ...hit, precision: 'approximate' } : null
  } catch {
    signal?.throwIfAborted()
    return null
  }
}

// Versioned, bounded cache: ignore legacy entries that cannot prove house/street
// consistency and never let an aborted lookup save or reuse a stale result.
const CACHE_PREFIX = 'qg_geo_v2:'
const CACHE_TTL = 30 * 60 * 1000
export async function cachedGeocode(address: string, signal?: AbortSignal): Promise<GeoResult | null> {
  signal?.throwIfAborted()
  const key = `${CACHE_PREFIX}${address.trim().toLowerCase()}`
  try {
    const saved = sessionStorage.getItem(key)
    if (saved) {
      const { hit, savedAt } = JSON.parse(saved)
      if (Number.isFinite(savedAt) && savedAt <= Date.now() && Date.now() - savedAt < CACHE_TTL && requestedAddress(address).houseNumber && hit?.precision === 'address' && matchesAddress(address, hit)) return hit
      sessionStorage.removeItem(key)
    }
  } catch { /* storage unavailable or invalid cache */ }
  const hit = await geocodeAddress(address, signal)
  signal?.throwIfAborted()
  if (hit?.precision === 'address') try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter((key): key is string => !!key?.startsWith(CACHE_PREFIX))
    for (const old of keys.slice(0, Math.max(0, keys.length - 49))) sessionStorage.removeItem(old)
    sessionStorage.setItem(key, JSON.stringify({ hit, savedAt: Date.now() }))
  } catch { /* storage unavailable */ }
  return hit
}
