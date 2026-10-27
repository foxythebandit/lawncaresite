export type PropertyPoint = { lat: number; lng: number }

export type PropertyConfirmation = PropertyPoint & {
  address: string
  contactAddress: string | null
}

export function isPropertyPoint(value: unknown): value is PropertyPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as PropertyPoint
  return typeof point.lat === 'number' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point.lng === 'number' && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
}

// A Maps viewport (@lat,lng) is not necessarily the selected property. Only
// explicit place coordinates are accepted; this helper never follows links.
export function parseManualPropertyLocation(input: string): PropertyPoint | null {
  const number = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)'
  const pair = input.trim().match(new RegExp(`^(${number})\\s*,\\s*(${number})$`))
  if (pair) {
    const point = { lat: Number(pair[1]), lng: Number(pair[2]) }
    return isPropertyPoint(point) ? point : null
  }
  try {
    const url = new URL(input.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || !['google.com', 'www.google.com'].includes(url.hostname) || url.port
      || !url.pathname.startsWith('/maps/')) return null
    const path = decodeURIComponent(url.pathname)
    const matches = [...path.matchAll(new RegExp(`!3d(${number})!4d(${number})(?=!|/|$)`, 'g'))]
    // More than one coordinate pair is ambiguous, even if one looks plausible.
    if (matches.length !== 1) return null
    const point = { lat: Number(matches[0][1]), lng: Number(matches[0][2]) }
    return isPropertyPoint(point) ? point : null
  } catch {
    return null
  }
}

export function isPropertyConfirmed(
  confirmation: unknown, address: string, contactAddress: string | null, point: unknown,
): confirmation is PropertyConfirmation {
  if (!isPropertyPoint(confirmation) || !isPropertyPoint(point)) return false
  const saved = confirmation as PropertyConfirmation
  return !!address.trim() && saved.address === address && saved.contactAddress === contactAddress
    && saved.lat === point.lat && saved.lng === point.lng
}
