'use server'

export interface ParcelResult {
  coordinates: [number, number][]
}

export async function getParcel(address: string, lat: number, lon: number): Promise<ParcelResult | null> {
  const token = process.env.REGRID_TOKEN
  if (!token) return null

  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }

  try {
    // Step 1: typeahead by address string
    const taRes = await fetch(
      `https://app.regrid.com/api/v2/parcels/typeahead?query=${encodeURIComponent(address)}&token=${token}`,
      { headers, cache: 'no-store' }
    )
    if (!taRes.ok) return null
    const taData = await taRes.json()
    const features: any[] = taData?.parcel_centroids?.features ?? []
    if (!features.length) return null

    // Pick the typeahead result closest to the Nominatim coordinates
    let best: any = null, bestDist = Infinity
    for (const f of features) {
      const [fLon, fLat] = f.geometry?.coordinates ?? [0, 0]
      const d = Math.sqrt((fLat - lat) ** 2 + (fLon - lon) ** 2)
      if (d < bestDist) { bestDist = d; best = f }
    }
    // ~0.005° ≈ 500m — if nothing is that close, we don't have this parcel
    if (!best || bestDist > 0.005) return null
    const path: string = best.properties?.path
    if (!path) return null

    // Step 2: fetch full parcel geometry by path
    const parcelRes = await fetch(
      `https://app.regrid.com/api/v2/parcels/path?path=${encodeURIComponent(path)}&token=${token}`,
      { headers, next: { revalidate: 86400 } }
    )
    if (!parcelRes.ok) return null
    const parcelData = await parcelRes.json()
    const ring = parcelData?.parcels?.features?.[0]?.geometry?.coordinates?.[0] as [number, number][] | undefined
    if (!ring || ring.length < 3) return null
    return { coordinates: ring }
  } catch (err) {
    console.error('[Regrid] error:', err)
    return null
  }
}
