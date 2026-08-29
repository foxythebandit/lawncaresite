'use server'

export interface ParcelResult {
  coordinates: [number, number][]
}

// Free, no-key county GIS parcel layers — tried before falling back to paid Regrid.
const COUNTY_SOURCES = [
  { name: 'Travis',     url: 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/EXTERNAL_tcad_parcel/FeatureServer/0/query' },
  { name: 'Williamson', url: 'https://gis.wilco.org/arcgis/rest/services/public/county_wcad_parcels/MapServer/0/query' },
]

async function queryCountyParcel(url: string, lat: number, lon: number): Promise<ParcelResult | null> {
  const qs = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    f: 'geojson',
  })
  const res = await fetch(`${url}?${qs}`, { next: { revalidate: 86400 } })
  if (!res.ok) return null
  const data = await res.json()
  const ring: [number, number][] | undefined = data?.features?.[0]?.geometry?.coordinates?.[0]
  if (!ring || ring.length < 3) return null
  return { coordinates: ring }
}

async function getParcelFromRegrid(address: string, lat: number, lon: number): Promise<ParcelResult | null> {
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

export async function getParcel(address: string, lat: number, lon: number): Promise<ParcelResult | null> {
  for (const source of COUNTY_SOURCES) {
    try {
      const result = await queryCountyParcel(source.url, lat, lon)
      if (result) return result
    } catch (err) {
      console.error(`[${source.name} County GIS] error:`, err)
    }
  }
  return getParcelFromRegrid(address, lat, lon)
}
