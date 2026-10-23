// Satellite imagery shared by the quote map and the staff leads list's background warm-up.
// Mapbox Satellite (sharper, more current) when a token is configured; Esri World Imagery otherwise
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
export const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

// Staff quotes open at zoom 18 on the property. Fetching those same tile URLs
// ahead of time lets the browser cache hand them to MapLibre on open.
export function warmPropertyTiles(lat: number, lon: number, zoom = 18) {
  const retina = window.devicePixelRatio >= 2
  // Mapbox 512px tiles sit one zoom below the map; Esri's 128px Retina tiles one above (see MapQuoteBuilder).
  const z = MAPBOX_TOKEN ? zoom - 1 : retina ? zoom + 1 : zoom
  const tileCss = MAPBOX_TOKEN ? 512 : retina ? 128 : 256
  const n = 2 ** z
  const fx = (lon + 180) / 360 * n
  const rad = lat * Math.PI / 180
  const fy = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n
  const halfW = Math.ceil(Math.min(window.innerWidth, 1100) / 2 / tileCss)
  const halfH = Math.ceil(520 / 2 / tileCss)
  const urls: string[] = []
  for (let dy = -halfH; dy <= halfH; dy++) for (let dx = -halfW; dx <= halfW; dx++) {
    const x = Math.floor(fx) + dx, y = Math.floor(fy) + dy
    urls.push(MAPBOX_TOKEN
      ? `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`
      : `${ESRI_IMAGERY}/${z}/${y}/${x}`)
  }
  for (const url of urls) fetch(url, { priority: 'low' } as RequestInit).catch(() => {})
}
