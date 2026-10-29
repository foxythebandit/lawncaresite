import { ESRI_IMAGERY } from '@/lib/map-imagery'

export type Shape = { name?: string; sqFt?: number; coords: [number, number][] }
const TILE = 256
const COLORS = ['#52b788', '#f4a261', '#4cc9f0', '#e76f51', '#c77dff']

/** Traced shapes that have coordinates, from the lead's tracing or the saved staff quote. */
export function tracedShapes(...sources: unknown[]): Shape[] {
  for (const source of sources) {
    const shapes = (Array.isArray(source) ? source : []).filter((s): s is Shape =>
      !!s && typeof s === 'object' && Array.isArray((s as Shape).coords) && (s as Shape).coords.length >= 3
      && (s as Shape).coords.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
    if (shapes.length) return shapes
  }
  return []
}

const project = (lng: number, lat: number, z: number) => {
  const scale = TILE * 2 ** z, rad = lat * Math.PI / 180
  return [(lng + 180) / 360 * scale, (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * scale]
}

/**
 * Satellite tiles with the customer's tracing drawn on top (PLAN.md 3.3 S12, 4.1c). Server-rendered:
 * plain <img> tiles plus one SVG, no map library, so the lead page paints with the map in place.
 */
export default function TracingMap({ shapes, width = 640, height = 300, label }: { shapes: Shape[]; width?: number; height?: number; label: string }) {
  const points = shapes.flatMap(s => s.coords)
  const lngs = points.map(p => p[0]), lats = points.map(p => p[1])
  const [minLng, maxLng, minLat, maxLat] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)]
  // Highest zoom (≤ 19, where Esri always has imagery) that fits the tracing with a margin.
  let z = 19
  for (; z > 12; z--) {
    const [x1, y1] = project(minLng, maxLat, z), [x2, y2] = project(maxLng, minLat, z)
    if (x2 - x1 <= width * 0.72 && y2 - y1 <= height * 0.72) break
  }
  const [cx, cy] = project((minLng + maxLng) / 2, (minLat + maxLat) / 2, z)
  const left = cx - width / 2, top = cy - height / 2
  const tiles: { x: number; y: number }[] = []
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) tiles.push({ x: tx, y: ty })
  }
  const pct = (value: number, of: number) => `${(value / of) * 100}%`
  return <div className="crm-tracing-map" style={{ aspectRatio: `${width} / ${height}` }} role="img" aria-label={label}>
    {tiles.map(t => // eslint-disable-next-line @next/next/no-img-element
      <img key={`${t.x}-${t.y}`} src={`${ESRI_IMAGERY}/${z}/${t.y}/${t.x}`} alt="" loading="lazy" decoding="async" draggable={false}
        style={{ left: pct(t.x * TILE - left, width), top: pct(t.y * TILE - top, height), width: pct(TILE, width), height: pct(TILE, height) }} />)}
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {shapes.map((shape, i) => <polygon key={i} points={shape.coords.map(([lng, lat]) => { const [x, y] = project(lng, lat, z); return `${(x - left).toFixed(1)},${(y - top).toFixed(1)}` }).join(' ')}
        fill={COLORS[i % COLORS.length]} fillOpacity={0.28} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
    </svg>
  </div>
}
