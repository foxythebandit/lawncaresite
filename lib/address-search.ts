// Both website address fields use the same Photon labels, US filter, and Austin bias.
// 807 E 47th St, Austin TX
export const OFFICE_LAT = 30.3049
export const OFFICE_LNG = -97.7184

export type GeoResult = { label: string; lat: number; lon: number }

type PhotonFeature = {
  geometry: { coordinates: [number, number] }
  properties: { name?: string; housenumber?: string; street?: string; city?: string; state?: string; postcode?: string; countrycode?: string }
}

function photonLabel(p: PhotonFeature['properties']): string {
  const line1 = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street ?? p.name ?? ''
  return [line1, p.city, [p.state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

export async function photonSearch(query: string, limit: number, signal?: AbortSignal): Promise<GeoResult[]> {
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit * 2}&lang=en&lat=${OFFICE_LAT}&lon=${OFFICE_LNG}`,
    { signal }
  )
  if (!res.ok) throw new Error(`Photon ${res.status}`)
  const { features } = await res.json() as { features: PhotonFeature[] }
  const seen = new Set<string>()
  const results: GeoResult[] = []
  for (const f of features) {
    if (f.properties.countrycode !== 'US') continue
    const label = photonLabel(f.properties)
    if (!label || seen.has(label)) continue
    seen.add(label)
    results.push({ label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })
  }
  return results.slice(0, limit)
}

// Bias geocoding toward Austin (lon/lat box ~35 mi around the office) so vague
// entries like "123 Main St" resolve locally instead of in another state
const GEOCODE_BIAS = `countrycodes=us&viewbox=${OFFICE_LNG - 0.6},${OFFICE_LAT + 0.5},${OFFICE_LNG + 0.6},${OFFICE_LAT - 0.5}&bounded=0`

// Suggestions come from Photon: Nominatim's usage policy forbids
// search-as-you-type, and it starts refusing (429/403, no CORS header) once
// a visitor's IP sends a burst of requests — which broke the address box.
// The final search still prefers Nominatim (better at exact house numbers)
// and falls back to Photon if it errors, times out or finds nothing.
export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&${GEOCODE_BIAS}`,
      { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(5000) }
    )
    if (res.ok) {
      const data = await res.json()
      if (data.length) return { label: data[0].display_name, lat: +data[0].lat, lon: +data[0].lon }
    }
  } catch { /* blocked, rate-limited or timed out — fall through to Photon */ }
  const [hit] = await photonSearch(address, 1)
  return hit ?? null
}

// Staff map opens reuse a lookup the leads list already made in the background.
export async function cachedGeocode(address: string): Promise<GeoResult | null> {
  const key = `qg_geo:${address.trim().toLowerCase()}`
  try { const saved = sessionStorage.getItem(key); if (saved) return JSON.parse(saved) as GeoResult } catch { /* storage unavailable */ }
  const hit = await geocodeAddress(address)
  if (hit) try { sessionStorage.setItem(key, JSON.stringify(hit)) } catch { /* storage unavailable */ }
  return hit
}
