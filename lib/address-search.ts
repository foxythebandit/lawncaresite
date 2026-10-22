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
