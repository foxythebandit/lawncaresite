'use server'

export interface ParcelResult {
  coordinates: [number, number][]
}

export async function getParcel(lat: number, lon: number): Promise<ParcelResult | null> {
  const token = process.env.REGRID_TOKEN
  if (!token) return null
  try {
    const res = await fetch(
      `https://app.regrid.com/api/v1/parcel/point.json?lat=${lat}&lon=${lon}&token=${token}`,
      { next: { revalidate: 86400 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const feature = data?.parcels?.features?.[0]
    const ring = feature?.geometry?.coordinates?.[0] as [number, number][] | undefined
    if (!ring || ring.length < 3) return null
    return { coordinates: ring }
  } catch {
    return null
  }
}
