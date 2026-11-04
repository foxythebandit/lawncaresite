import { ESRI_IMAGERY } from '@/lib/map-imagery'
import type { Shape } from './TracingMap'

export const TILE = 256
export const COLORS = ['#52b788', '#f4a261', '#4cc9f0', '#e76f51', '#c77dff']

/** Web Mercator world pixels at zoom z (256px tiles). */
export const project = (lng: number, lat: number, z: number) => {
  const scale = TILE * 2 ** z, rad = lat * Math.PI / 180
  return [(lng + 180) / 360 * scale, (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * scale]
}

/** Pixel size of the emailed picture (shown at ~464px wide, so it stays sharp on phones). */
export const MAP_IMAGE = { width: 960, height: 560 }
const TILE_MAX_Z = 19 // Esri always has imagery here; closer views enlarge these tiles.

/** Map view that fits the tracing with a margin: tile zoom, enlargement, and top-left in world pixels. */
export function lawnMapView(shapes: Shape[], width = MAP_IMAGE.width, height = MAP_IMAGE.height) {
  const points = shapes.flatMap(s => s.coords)
  const lngs = points.map(p => p[0]), lats = points.map(p => p[1])
  const [minLng, maxLng, minLat, maxLat] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)]
  let z = 20 // closest view: zoom-19 tiles enlarged at most 2×
  for (; z > 12; z--) {
    const [x1, y1] = project(minLng, maxLat, z), [x2, y2] = project(maxLng, minLat, z)
    if (x2 - x1 <= width * 0.7 && y2 - y1 <= height * 0.7) break
  }
  const [cx, cy] = project((minLng + maxLng) / 2, (minLat + maxLat) / 2, z)
  const tileZ = Math.min(z, TILE_MAX_Z)
  return { z, tileZ, scale: 2 ** (z - tileZ), left: cx - width / 2, top: cy - height / 2 }
}

async function tile(z: number, x: number, y: number) {
  const response = await fetch(`${ESRI_IMAGERY}/${z}/${y}/${x}`, { mode: 'cors' })
  if (!response.ok) throw new Error(`tile ${response.status}`)
  return createImageBitmap(await response.blob())
}

/**
 * The traced lawn on satellite imagery as a JPEG data URL, for the quote email. Drawn in the
 * browser like the website's map screenshot; the same projection as the lead page's TracingMap.
 */
export async function renderLawnMapImage(shapes: Shape[], sqFt: number | null): Promise<string> {
  const { width, height } = MAP_IMAGE
  const view = lawnMapView(shapes)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d9dfd9'; ctx.fillRect(0, 0, width, height)
  const size = TILE * view.scale
  const jobs: Promise<void>[] = []
  for (let ty = Math.floor(view.top / size); ty <= Math.floor((view.top + height) / size); ty++) {
    for (let tx = Math.floor(view.left / size); tx <= Math.floor((view.left + width) / size); tx++) {
      jobs.push(tile(view.tileZ, tx, ty).then(image => { ctx.drawImage(image, tx * size - view.left, ty * size - view.top, size, size) }))
    }
  }
  const loaded = await Promise.allSettled(jobs)
  if (loaded.every(result => result.status === 'rejected')) throw new Error('No satellite imagery loaded.')
  shapes.forEach((shape, i) => {
    ctx.beginPath()
    shape.coords.forEach(([lng, lat], j) => {
      const [x, y] = project(lng, lat, view.z)
      if (j) ctx.lineTo(x - view.left, y - view.top); else ctx.moveTo(x - view.left, y - view.top)
    })
    ctx.closePath()
    ctx.fillStyle = `${COLORS[i % COLORS.length]}55`; ctx.fill()
    ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = COLORS[i % COLORS.length]; ctx.stroke()
  })
  if (sqFt) {
    const label = `${sqFt.toLocaleString('en-US')} sq ft`
    ctx.font = '600 30px sans-serif'
    const w = ctx.measureText(label).width + 36
    ctx.fillStyle = 'rgba(26,58,42,.9)'; ctx.beginPath(); ctx.roundRect(20, height - 76, w, 56, 12); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, 38, height - 48)
  }
  ctx.font = '18px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
  ctx.fillText('Imagery © Esri', width - 12, height - 10)
  return canvas.toDataURL('image/jpeg', 0.82)
}
