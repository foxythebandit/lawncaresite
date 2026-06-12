'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { submitBooking } from '@/app/actions/submit-booking'
import { getParcel }    from '@/app/actions/get-parcel'

/* ── Types ────────────────────────────────────────────── */
type AppStep = 'idle' | 'searching' | 'drawing' | 'done' | 'editing'
type Frequency = 'monthly' | 'biweekly' | 'weekly'

interface Section {
  id: string
  name: string
  sqFt: number
  coords: [number, number][] | null
}

/* ── Constants ────────────────────────────────────────── */
const FREQ: Record<Frequency, { label: string; sub: string; discount: number }> = {
  monthly:  { label: 'Monthly',   sub: '1× / month',  discount: 0  },
  biweekly: { label: 'Bi-weekly', sub: '2× / month',  discount: 10 },
  weekly:   { label: 'Weekly',    sub: '4× / month',  discount: 15 },
}

const SECT_COLORS = ['#52b788', '#74c9a0', '#2d9e6b', '#38a878', '#95dbb8']

const MOWER_CURSOR = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='38' height='28' viewBox='0 0 38 28'><line x1='10' y1='14' x2='3' y2='4' stroke='white' stroke-width='1.5' stroke-linecap='round'/><line x1='3' y1='4' x2='8' y2='4' stroke='white' stroke-width='1.5' stroke-linecap='round'/><rect x='7' y='11' width='23' height='8' rx='2.5' fill='%2352b788' stroke='white' stroke-width='1'/><path d='M30,12 L36,10.5 L36,15.5 Z' fill='%2395dbb8'/><circle cx='26' cy='22' r='4.5' fill='%231a3a2a' stroke='white' stroke-width='1'/><circle cx='26' cy='22' r='1.8' fill='%2352b788'/><circle cx='11' cy='22' r='5' fill='%231a3a2a' stroke='white' stroke-width='1'/><circle cx='11' cy='22' r='2' fill='%2352b788'/><rect x='13' y='13.5' width='9' height='3' rx='1' fill='%231a3a2a'/><rect x='14' y='14' width='6' height='2' rx='0.5' fill='%2395dbb8'/></svg>") 36 13, crosshair`

const LAST_MOW_OPTS = [
  { key: 'thisweek', label: 'This week',  sub: '0–7 days'  },
  { key: 'biweekly', label: '2–3 weeks',  sub: '~2–3 wks'  },
  { key: 'month',    label: '~1 month',   sub: '3–5 weeks' },
  { key: 'overdue',  label: '2+ months',  sub: '6+ weeks'  },
]
const LAST_MOW_WEEKS: Record<string, number> = {
  thisweek: 0.5, biweekly: 2.5, month: 4, overdue: 9,
}

/* ── Helpers ──────────────────────────────────────────── */
function uid() { return Math.random().toString(36).slice(2, 8) }

function calcPrice(sqFt: number): number {
  if (sqFt <= 2000)  return 65
  if (sqFt <= 5000)  return 65  + Math.round((sqFt - 2000)  * 0.018)
  if (sqFt <= 12000) return 119 + Math.round((sqFt - 5000)  * 0.013)
  return                      210 + Math.round((sqFt - 12000) * 0.009)
}

function getSeasonInfo(month: number) {
  if (month >= 4 && month <= 7)
    return { name: 'Peak season',     multiplier: 1.0, note: 'Grass grows up to 1″ per week right now', color: '#52b788' }
  if (month === 2 || month === 3 || month === 8 || month === 9)
    return { name: 'Shoulder season', multiplier: 0.5, note: 'Moderate growth this time of year',       color: '#95dbb8' }
  return   { name: 'Dormant season',  multiplier: 0.1, note: 'Minimal growth — no cleanup fees apply',  color: 'rgba(255,255,255,.35)' }
}

function calcOvergrowthFee(weeks: number, multiplier: number): { fee: number; label: string } {
  const score = weeks * multiplier
  if (score >= 6)   return { fee: 45, label: 'Heavy first-cut cleanup' }
  if (score >= 3)   return { fee: 25, label: 'First-cut cleanup' }
  if (score >= 1.5) return { fee: 15, label: 'Light cleanup fee' }
  return                   { fee: 0,  label: '' }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Flat-earth shoelace area in sq ft */
function polygonSqFt(coords: [number, number][]): number {
  if (coords.length < 3) return 0
  const cosLat = Math.cos(coords[0][1] * Math.PI / 180)
  const pts = coords.map(([lng, lat]) => [lng * cosLat * 111319.9, lat * 111319.9])
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return Math.round(Math.abs(area) / 2 * 10.7639)
}

function sectionsGeoJSON(sections: Section[]): object {
  return {
    type: 'FeatureCollection',
    features: sections
      .filter(s => s.coords && s.coords.length >= 3)
      .map((s, i) => ({
        type: 'Feature',
        properties: { color: SECT_COLORS[i % SECT_COLORS.length] },
        geometry: { type: 'Polygon', coordinates: [s.coords!] },
      })),
  }
}

/* ── Icons ────────────────────────────────────────────── */
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

/* ── Component ────────────────────────────────────────── */
export default function MapQuoteBuilder() {
  const mapDivRef        = useRef<HTMLDivElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const mapRef           = useRef<any>(null)
  const rafRef           = useRef<number>(0)
  const liveRef          = useRef<number>(0)
  const cursorLngLatRef  = useRef<[number, number] | null>(null)

  const drawRef = useRef<{
    points:    [number, number][]
    clickFn:   ((e: any) => void) | null
    moveFn:    ((e: any) => void) | null
    mapMoveFn: (() => void) | null
  }>({ points: [], clickFn: null, moveFn: null, mapMoveFn: null })

  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestAbortRef = useRef<AbortController | null>(null)
  const addressWrapRef  = useRef<HTMLDivElement>(null)

  const [step,        setStep]        = useState<AppStep>('idle')
  const [address,     setAddress]     = useState('')
  const [error,       setError]       = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeSug,   setActiveSug]   = useState(-1)
  const [sections, setSections] = useState<Section[]>([])
  const [lawnSqFt, setLawnSqFt] = useState<number | null>(null)
  const [animSqFt, setAnimSqFt] = useState(0)
  const [liveSqFt, setLiveSqFt] = useState(0)
  const [freq,     setFreq]     = useState<Frequency>('biweekly')
  const [lastMow,  setLastMow]  = useState('thisweek')
  const [isDrawing,setIsDrawing]= useState(false)
  const [drawCount,setDrawCount]= useState(0)
  const [ptCount,  setPtCount]  = useState(0)

  const [showManualSqFt,  setShowManualSqFt]  = useState(false)
  const [manualSqFtInput, setManualSqFtInput] = useState('')

  const [showBooking,   setShowBooking]   = useState(false)
  const [bookingName,   setBookingName]   = useState('')
  const [bookingPhone,  setBookingPhone]  = useState('')
  const [bookingEmail,  setBookingEmail]  = useState('')
  const [bookingDate,   setBookingDate]   = useState<Date | undefined>(undefined)
  const [bookingStatus,    setBookingStatus]    = useState<'idle' | 'submitting' | 'success'>('idle')
  const [bookingError,     setBookingError]     = useState('')
  const [mapScreenshot,    setMapScreenshot]    = useState('')

  /* ─── Init MapLibre ──────────────────────────────────── */
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    let alive = true
    ;(async () => {
      try {
      const ml = (await import('maplibre-gl')).default
      if (!alive || !mapDivRef.current) return
      const map = new ml.Map({
        container: mapDivRef.current,
        style: {
          version: 8,
          sources: {
            satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
            labels:    { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 },
          },
          layers: [
            { id: 'satellite-layer', type: 'raster', source: 'satellite' },
            { id: 'labels-layer',    type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.75 } },
          ],
          glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        },
        center: [-98.5, 39.8], zoom: 4, maxZoom: 21, attributionControl: false,
        // @ts-ignore — preserveDrawingBuffer needed for canvas.toDataURL()
        preserveDrawingBuffer: true,
      })
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
      mapRef.current = map
      } catch { /* map unavailable — user sees the static fallback UI */ }
    })()
    return () => { alive = false; cancelAnimationFrame(rafRef.current); mapRef.current?.remove(); mapRef.current = null }
  }, [])

  /* ─── Final sq ft counter (on completion) ───────────── */
  useEffect(() => {
    if (!lawnSqFt) return
    setAnimSqFt(0)
    const dur = 1000, t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1)
      setAnimSqFt(Math.round(easeInOut(p) * lawnSqFt))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [lawnSqFt])

  /* ─── Live counter (during drawing) ─────────────────── */
  useEffect(() => {
    const pts = drawRef.current.points
    const target = pts.length >= 2 ? polygonSqFt(pts) : 0
    const from = liveRef.current
    if (target === from) return
    const diff = target - from
    const dur = 350, t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      const val = Math.round(from + diff * ease)
      setLiveSqFt(val)
      if (p < 1) { rafRef.current = requestAnimationFrame(tick) }
      else { liveRef.current = target }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [drawCount])

  /* ─── Derive lawnSqFt from sections ─────────────────── */
  useEffect(() => {
    const total = sections.reduce((s, sec) => s + sec.sqFt, 0)
    setLawnSqFt(total > 0 ? total : null)
  }, [sections])

  /* ─── Sync sections → map ────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('sections-data') as any
    if (src) src.setData(sectionsGeoJSON(sections))
  }, [sections])

  /* ─── Address autocomplete ──────────────────────────── */
  const fetchSuggestions = useCallback((query: string) => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    if (query.length < 3) { setSuggestions([]); return }
    suggestTimerRef.current = setTimeout(async () => {
      suggestAbortRef.current?.abort()
      suggestAbortRef.current = new AbortController()
      try {
        const res  = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=0&countrycodes=us`,
          { headers: { 'Accept-Language': 'en' }, signal: suggestAbortRef.current.signal }
        )
        const data = await res.json()
        setSuggestions(data.map((d: { display_name: string }) => d.display_name))
      } catch { /* aborted or network error — ignore */ }
    }, 350)
  }, [])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (addressWrapRef.current && !addressWrapRef.current.contains(e.target as Node))
        setSuggestions([])
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  /* ─── Draw helpers ───────────────────────────────────── */
  const updateDrawSource = useCallback(() => {
    const map = mapRef.current
    const pts = drawRef.current.points
    const src = map?.getSource('draw-data') as any
    if (!src || !pts.length) return
    const features: any[] = []
    // Polygon fill is handled by canvas — only lines + vertices here
    features.push({ type: 'Feature', properties: { t: 'line' }, geometry: { type: 'LineString', coordinates: pts } })
    pts.forEach(p => features.push({ type: 'Feature', properties: { t: 'pt' }, geometry: { type: 'Point', coordinates: p } }))
    src.setData({ type: 'FeatureCollection', features })
  }, [])

  const stopDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const d = drawRef.current
    if (d.clickFn)   map.off('click',     d.clickFn)
    if (d.moveFn)    map.off('mousemove', d.moveFn)
    if (d.mapMoveFn) map.off('move',      d.mapMoveFn)
    d.clickFn = null; d.moveFn = null; d.mapMoveFn = null; d.points = []
    cursorLngLatRef.current = null
    // Clear the canvas preview line
    const canvas = previewCanvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    map.doubleClickZoom.enable()
    map.getCanvas().style.cursor = ''
    ;['draw-line','draw-vertices'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
    ;['draw-data'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })
    setIsDrawing(false); setDrawCount(0); setPtCount(0)
    setLiveSqFt(0); liveRef.current = 0
  }, [])

  const savePolygon = useCallback((pts: [number, number][]) => {
    if (pts.length < 3) return
    const closed = [...pts, pts[0]]
    const sqFt   = polygonSqFt(pts)
    const map = mapRef.current
    if (map && !map.getSource('sections-data')) {
      map.addSource('sections-data', { type: 'geojson', data: sectionsGeoJSON([]) })
      map.addLayer({ id: 'sections-fill',    type: 'fill', source: 'sections-data', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'sections-outline', type: 'line', source: 'sections-data', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
    }
    setSections(prev => [...prev, { id: uid(), name: prev.length === 0 ? 'Lawn' : `Zone ${prev.length + 1}`, sqFt, coords: closed }])
  }, [])

  const commitPolygon = useCallback((pts: [number, number][]) => {
    if (pts.length < 3) return
    stopDraw()
    savePolygon(pts)
    setStep('done')
  }, [stopDraw, savePolygon])

  const startDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    stopDraw()

    map.doubleClickZoom.disable()
    map.getCanvas().style.cursor = MOWER_CURSOR
    drawRef.current.points = []

    map.addSource('draw-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'draw-line',     type: 'line',   source: 'draw-data', filter: ['==', ['get', 't'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#52b788', 'line-width': 2.5 } })
    map.addLayer({ id: 'draw-vertices', type: 'circle', source: 'draw-data', filter: ['==', ['get', 't'], 'pt'],   paint: { 'circle-radius': 5, 'circle-color': '#52b788', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })

    // Canvas draws both the polygon preview fill and the rubber-band line — no MapLibre worker
    const drawPreview = (cursor: [number, number]) => {
      const canvas = previewCanvasRef.current
      const container = mapDivRef.current
      if (!canvas || !container) return
      const dpr = window.devicePixelRatio || 1
      const w = container.clientWidth
      const h = container.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width  = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const d = drawRef.current
      if (!d.points.length) return
      ctx.save()
      ctx.scale(dpr, dpr)

      // Semi-transparent polygon fill including cursor as next vertex
      if (d.points.length >= 2) {
        const allPts = [...d.points, cursor]
        const firstPx = map.project(allPts[0] as any)
        ctx.beginPath()
        ctx.moveTo(firstPx.x, firstPx.y)
        for (let i = 1; i < allPts.length; i++) {
          const px = map.project(allPts[i] as any)
          ctx.lineTo(px.x, px.y)
        }
        ctx.closePath()
        ctx.fillStyle   = '#52b788'
        ctx.globalAlpha = 0.15
        ctx.fill()
        ctx.setLineDash([])
        ctx.strokeStyle = '#52b788'
        ctx.lineWidth   = 1
        ctx.globalAlpha = 0.25
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // Rubber-band dashed line from last confirmed point to cursor
      const last     = d.points[d.points.length - 1]
      const lastPx   = map.project(last as any)
      const cursorPx = map.project(cursor as any)
      ctx.beginPath()
      ctx.setLineDash([8, 6])
      ctx.strokeStyle = '#95dbb8'
      ctx.lineWidth   = 2
      ctx.globalAlpha = 0.85
      ctx.lineCap     = 'round'
      ctx.moveTo(lastPx.x, lastPx.y)
      ctx.lineTo(cursorPx.x, cursorPx.y)
      ctx.stroke()
      ctx.restore()
    }

    let lastLiveUpdate = 0
    const clickFn = (e: any) => {
      const d = drawRef.current
      d.points = [...d.points, [e.lngLat.lng, e.lngLat.lat]]
      updateDrawSource()
      setPtCount(d.points.length)
      setDrawCount(c => c + 1)
    }

    const moveFn = (e: any) => {
      const cursor: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      cursorLngLatRef.current = cursor
      const d = drawRef.current
      if (!d.points.length) return
      drawPreview(cursor)
      // Update live sq ft at ~30fps so React re-renders stay cheap
      const now = Date.now()
      if (d.points.length >= 2 && now - lastLiveUpdate > 33) {
        lastLiveUpdate = now
        setLiveSqFt(polygonSqFt([...d.points, cursor]))
      }
    }

    const mapMoveFn = () => {
      if (cursorLngLatRef.current && drawRef.current.points.length)
        drawPreview(cursorLngLatRef.current)
    }

    drawRef.current.clickFn   = clickFn
    drawRef.current.moveFn    = moveFn
    drawRef.current.mapMoveFn = mapMoveFn
    map.on('click',     clickFn)
    map.on('mousemove', moveFn)
    map.on('move',      mapMoveFn)
    setIsDrawing(true)
  }, [stopDraw, updateDrawSource])

  /* ─── Finish button ──────────────────────────────────── */
  const handleFinish = useCallback(() => {
    commitPolygon(drawRef.current.points)
  }, [commitPolygon])

  /* ─── Finish & immediately draw another zone ─────────── */
  const handleFinishAndAdd = useCallback(() => {
    const pts = [...drawRef.current.points]
    if (pts.length < 3) return
    stopDraw()
    savePolygon(pts)
    setStep('editing')
    startDraw()
  }, [stopDraw, savePolygon, startDraw])

  /* ─── Parcel boundary overlay ────────────────────────── */
  const drawParcelBoundary = useCallback((coords: [number, number][]) => {
    const map = mapRef.current
    if (!map) return
    try { map.getLayer('parcel-outline') && map.removeLayer('parcel-outline') } catch {}
    try { map.getSource('parcel-boundary') && map.removeSource('parcel-boundary') } catch {}
    map.addSource('parcel-boundary', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} },
    })
    map.addLayer({
      id: 'parcel-outline',
      type: 'line',
      source: 'parcel-boundary',
      paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.45, 'line-dasharray': [4, 3] },
    })
  }, [])

  /* ─── Address search ─────────────────────────────────── */
  const handleSearch = useCallback(async (ev?: React.FormEvent) => {
    ev?.preventDefault()
    if (!address.trim() || !mapRef.current) return
    setSuggestions([])
    setError('')
    setStep('searching')
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, { headers: { 'Accept-Language': 'en' } })
      const data = await res.json()
      if (!data.length) { setError('Address not found — try adding city or zip.'); setStep('idle'); return }
      const lat = +data[0].lat, lon = +data[0].lon
      mapRef.current.flyTo({ center: [lon, lat], zoom: 18, duration: 2000 })
      // Fetch parcel boundary in parallel with the fly animation
      getParcel(address, lat, lon).then(parcel => {
        if (parcel) drawParcelBoundary(parcel.coordinates)
      })
      setTimeout(() => { startDraw(); setStep('drawing') }, 2200)
    } catch {
      setError('Search failed. Please try again.')
      setStep('idle')
    }
  }, [address, startDraw, drawParcelBoundary])

  /* ─── Cancel current trace (keep address/map position) ── */
  const cancelTrace = useCallback(() => {
    if (step === 'editing') {
      stopDraw()
      setStep('done')
    } else {
      stopDraw()
      startDraw()
    }
  }, [step, stopDraw, startDraw])

  /* ─── Manual sq ft entry ────────────────────────────── */
  const handleManualSqFt = useCallback(() => {
    const val = parseInt(manualSqFtInput.replace(/\D/g, ''), 10)
    if (!val || val < 100) return
    stopDraw()
    setSections([{ id: uid(), name: 'Lawn', sqFt: val, coords: null }])
    setShowManualSqFt(false)
    setManualSqFtInput('')
    setStep('done')
  }, [manualSqFtInput, stopDraw])

  /* ─── Edit mode ──────────────────────────────────────── */
  const enterEditMode = useCallback(() => {
    setStep('editing')
    startDraw()
  }, [startDraw])

  const deleteSection = useCallback((id: string) => {
    setSections(prev => prev.filter(s => s.id !== id))
  }, [])

  /* ─── Reset ──────────────────────────────────────────── */
  const handleReset = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    stopDraw()
    const map = mapRef.current
    if (map) {
      ;['sections-fill','sections-outline','parcel-outline'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
      ;['sections-data','parcel-boundary'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })
      map.flyTo({ center: [-98.5, 39.8], zoom: 4, duration: 1200 })
    }
    setStep('idle'); setAddress(''); setError(''); setSuggestions([])
    setLawnSqFt(null); setAnimSqFt(0); setSections([]); setLastMow('thisweek')
  }, [stopDraw])

  /* ─── Booking modal ─────────────────────────────────── */
  useEffect(() => {
    if (!showBooking) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeBooking() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showBooking])

  /* ─── Pricing ────────────────────────────────────────── */
  const season         = getSeasonInfo(new Date().getMonth())
  const mowWeeks       = LAST_MOW_WEEKS[lastMow] ?? 0.5
  const { fee: overgrowthFee, label: overgrowthLabel } = calcOvergrowthFee(mowWeeks, season.multiplier)
  const basePrice      = lawnSqFt ? calcPrice(lawnSqFt) : 0
  const discount       = FREQ[freq].discount
  const ongoingPrice   = lawnSqFt ? Math.round(basePrice * (1 - discount / 100)) : 0
  const firstVisitPrice = ongoingPrice + overgrowthFee
  const isDone         = step === 'done' || step === 'editing'

  const closeBooking = useCallback(() => {
    setShowBooking(false); setBookingStatus('idle'); setBookingError(''); setMapScreenshot('')
  }, [])

  const handleBookingSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setBookingStatus('submitting'); setBookingError('')
    const result = await submitBooking({
      name: bookingName, phone: bookingPhone, email: bookingEmail,
      preferred_date: bookingDate ? bookingDate.toLocaleDateString('en-CA') : '', address,
      sq_ft: lawnSqFt, frequency: FREQ[freq].label,
      price_per_visit: ongoingPrice, first_visit_price: firstVisitPrice,
      overgrowth_fee: overgrowthFee, last_mow: lastMow,
      map_screenshot: mapScreenshot,
    }).catch(() => ({ success: false, error: 'Something went wrong. Please try again.' }))
    if (result.success) { setBookingStatus('success') }
    else { setBookingStatus('idle'); setBookingError(result.error ?? 'Something went wrong.') }
  }, [bookingName, bookingPhone, bookingEmail, bookingDate, address, lawnSqFt, freq, ongoingPrice, firstVisitPrice, overgrowthFee, lastMow])

  /* ─── JSX ────────────────────────────────────────────── */
  return (
    <section className="mapq-section" id="map-quote">
      <div className="mapq-blob mapq-blob-a" />
      <div className="mapq-blob mapq-blob-b" />

      <div className="mapq-inner">
        <div className="mapq-header">
          <div className="section-label" style={{ color: 'var(--green-bright)' }}>Instant Quote</div>
          <h2 className="section-h2" style={{ color: '#fff', marginBottom: 14 }}>
            Trace your lawn.{' '}
            <em style={{ color: 'var(--green-bright)', fontStyle: 'italic' }}>Get your price.</em>
          </h2>
          <p className="section-sub" style={{ color: 'rgba(255,255,255,.5)', margin: '0 auto', textAlign: 'center', maxWidth: 480 }}>
            Enter your address, trace your lawn on the satellite map, and get a fixed price instantly — no estimates, no surprises.
          </p>
        </div>

        <div className="mapq-grid">
          {/* ── Left panel ── */}
          <div className="mapq-panel">

            {/* Step 1 — Address */}
            <div className="mapq-step">
              <div className={`mapq-step-indicator ${step !== 'idle' && step !== 'searching' ? 'done' : 'active'}`}>
                {step !== 'idle' && step !== 'searching' ? <CheckIcon /> : '1'}
              </div>
              <div className="mapq-step-line" style={{ opacity: step !== 'idle' && step !== 'searching' ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${step === 'idle' || step === 'searching' ? 'active' : ''}`}>Your address</div>
                {(step === 'idle' || step === 'searching') && (
                  <form onSubmit={handleSearch} style={{ marginTop: 14 }}>
                    <div className="mapq-input-wrap" ref={addressWrapRef}>
                      <svg className="mapq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        className="mapq-input"
                        type="text"
                        placeholder="123 Main St, Austin TX…"
                        value={address}
                        autoComplete="off"
                        aria-label="Your street address"
                        aria-autocomplete="list"
                        aria-expanded={suggestions.length > 0}
                        onChange={e => { setAddress(e.target.value); setActiveSug(-1); fetchSuggestions(e.target.value) }}
                        onKeyDown={e => {
                          if (!suggestions.length) return
                          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSug(i => Math.min(i + 1, suggestions.length - 1)) }
                          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSug(i => Math.max(i - 1, -1)) }
                          else if (e.key === 'Enter' && activeSug >= 0) { e.preventDefault(); setAddress(suggestions[activeSug]); setSuggestions([]); setActiveSug(-1) }
                          else if (e.key === 'Escape') { setSuggestions([]); setActiveSug(-1) }
                        }}
                      />
                      {suggestions.length > 0 && (
                        <div className="mapq-suggestions" role="listbox">
                          {suggestions.map((s, i) => (
                            <div
                              key={i}
                              className={`mapq-suggestion${i === activeSug ? ' active' : ''}`}
                              role="option"
                              aria-selected={i === activeSug}
                              onPointerDown={e => { e.preventDefault(); setAddress(s); setSuggestions([]); setActiveSug(-1) }}
                            >
                              {s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="submit" className="mapq-btn-primary" style={{ marginTop: 10, width: '100%' }} disabled={step === 'searching' || !address.trim()}>
                      {step === 'searching' ? <><span className="mapq-spinner" /> Flying there…</> : 'Find my property →'}
                    </button>
                    {error && <p className="mapq-error">{error}</p>}
                  </form>
                )}
                {step !== 'idle' && step !== 'searching' && (
                  <p className="mapq-step-done-text">{address}<button className="mapq-link" onClick={handleReset}> · new search</button></p>
                )}
              </div>
            </div>

            {/* Step 2 — Trace */}
            <div className="mapq-step">
              <div className={`mapq-step-indicator ${isDone && !isDrawing ? 'done' : isDrawing ? 'active' : 'idle'}`}>
                {isDone && !isDrawing ? <CheckIcon /> : '2'}
              </div>
              <div className="mapq-step-line" style={{ opacity: isDone && !isDrawing ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${isDrawing ? 'active' : ''}`}>
                  Trace your lawn
                </div>

                {isDrawing && (
                  <div style={{ marginTop: 14 }}>
                    {/* Live counter — the gamification hook */}
                    <div className="mapq-live-counter">
                      <div className="mapq-live-sqft">{liveSqFt > 0 ? liveSqFt.toLocaleString() : '—'}</div>
                      <div className="mapq-live-label">sq ft traced</div>
                      {ptCount > 0 && (
                        <div className="mapq-live-pts">{ptCount} point{ptCount !== 1 ? 's' : ''} placed</div>
                      )}
                    </div>

                    <p className="mapq-hint">
                      {ptCount < 3
                        ? 'Click around your lawn to place points'
                        : 'Keep going — hit Finish when done'}
                    </p>

                    {ptCount >= 3 ? (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <button className="mapq-btn-primary" onClick={handleFinish} style={{ flex: 1 }}>
                            Finish ✓
                          </button>
                          <button className="mapq-btn-ghost" onClick={handleFinishAndAdd} style={{ flex: 1 }}>
                            + Add zone
                          </button>
                        </div>
                        <button className="mapq-link" onClick={cancelTrace} style={{ display: 'block', width: '100%', textAlign: 'center', fontSize: 12 }}>
                          Restart trace
                        </button>
                      </>
                    ) : (
                      <button className="mapq-btn-ghost" onClick={cancelTrace} style={{ width: '100%' }}>
                        Restart trace
                      </button>
                    )}
                  </div>
                )}

                {!isDrawing && isDone && lawnSqFt && (
                  <p className="mapq-step-done-text">
                    {lawnSqFt.toLocaleString()} sq ft traced
                  </p>
                )}
              </div>
            </div>

            {/* Step 3 — Quote */}
            <div className="mapq-step mapq-step-last">
              <div className={`mapq-step-indicator ${isDone ? 'active' : 'idle'}`}>
                {isDone
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  : '3'}
              </div>
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${isDone ? 'active' : ''}`}>Your instant quote</div>

                {isDone && lawnSqFt && (
                  <div className="mapq-quote-card">

                    {/* Area summary */}
                    <div className="mapq-sqft-row">
                      <div>
                        <div className="mapq-sqft-num">{animSqFt.toLocaleString()}</div>
                        <div className="mapq-sqft-label">sq ft of lawn</div>
                      </div>
                      <div className="mapq-sqft-badge">
                        <span className="mapq-pulse-dot" />
                        Traced
                      </div>
                    </div>

                    {/* Add zone button */}
                    {step === 'done' && (
                      <button className="mapq-btn-ghost" onClick={enterEditMode} style={{ width: '100%', marginBottom: 16 }}>
                        + Add another area
                      </button>
                    )}

                    {/* Sections list (editing) */}
                    {step === 'editing' && sections.length > 0 && (
                      <div className="mapq-area-breakdown" style={{ marginBottom: 16 }}>
                        {sections.map(s => (
                          <div key={s.id} className="mapq-area-row">
                            <span className="mapq-area-swatch" style={{ background: '#52b788' }} />
                            <span className="mapq-area-highlight">{s.name}</span>
                            <span>{s.sqFt.toLocaleString()} sq ft</span>
                            <button className="mapq-link" onClick={() => deleteSection(s.id)} style={{ marginLeft: 6 }}>×</button>
                          </div>
                        ))}
                        {isDrawing && (
                          <div className="mapq-area-row">
                            <span className="mapq-area-swatch" style={{ background: '#74c9a0', opacity: 0.5 }} />
                            <span style={{ opacity: 0.5 }}>Drawing…</span>
                            <span className="mapq-sqft-anim">{liveSqFt > 0 ? liveSqFt.toLocaleString() : '—'}</span>
                          </div>
                        )}
                        {isDrawing && ptCount >= 3 && (
                          <button className="mapq-btn-primary" onClick={handleFinish} style={{ width: '100%', marginTop: 8 }}>
                            Add this zone ✓
                          </button>
                        )}
                      </div>
                    )}

                    <div className="mapq-freq-label">How often?</div>
                    <div className="mapq-freq-row">
                      {(Object.entries(FREQ) as [Frequency, typeof FREQ[Frequency]][]).map(([key, f]) => (
                        <button key={key} className={`mapq-freq-btn ${freq === key ? 'selected' : ''}`} onClick={() => setFreq(key)}>
                          <span className="mapq-freq-name">{f.label}</span>
                          <span className="mapq-freq-sub">{f.sub}</span>
                          {f.discount > 0 && <span className="mapq-freq-discount">–{f.discount}%</span>}
                        </button>
                      ))}
                    </div>

                    {/* Season-aware overgrowth selector */}
                    <div className="mapq-season-tag">
                      <span className="mapq-season-dot" style={{ background: season.color }} />
                      <span>{season.name} — {season.note}</span>
                    </div>
                    <div className="mapq-freq-label">When was it last mowed?</div>
                    <div className="mapq-last-mow-grid">
                      {LAST_MOW_OPTS.map(opt => (
                        <button key={opt.key} className={`mapq-cond-btn ${lastMow === opt.key ? 'selected' : ''}`} onClick={() => setLastMow(opt.key)}>
                          <span className="mapq-cond-name">{opt.label}</span>
                          <span className="mapq-cond-sub">{opt.sub}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mapq-price-rows">
                      <div className="mapq-price-row"><span>Base rate</span><span>${basePrice}</span></div>
                      {discount > 0 && (
                        <div className="mapq-price-row mapq-price-discount">
                          <span>{FREQ[freq].label} discount</span><span>–${basePrice - ongoingPrice}</span>
                        </div>
                      )}
                      {overgrowthFee > 0 && (
                        <div className="mapq-price-row mapq-price-overgrowth">
                          <span>{overgrowthLabel} <span className="mapq-price-once">(first visit only)</span></span>
                          <span>+${overgrowthFee}</span>
                        </div>
                      )}
                    </div>

                    <div className="mapq-price-total">
                      <div>
                        <div className="mapq-price-val">${ongoingPrice}</div>
                        <div className="mapq-price-per">
                          per visit · fixed{overgrowthFee > 0 ? ` · first visit $${firstVisitPrice}` : ''}
                        </div>
                      </div>
                      <div className="mapq-eco-badge">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
                          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
                        </svg>
                        Zero emissions
                      </div>
                    </div>

                    <button className="mapq-cta" onClick={() => {
                      const map = mapRef.current
                      if (!map) { setShowBooking(true); return }
                      map.triggerRepaint()
                      map.once('render', () => {
                        const src = map.getCanvas()
                        const offscreen = document.createElement('canvas')
                        offscreen.width = src.width
                        offscreen.height = src.height
                        offscreen.getContext('2d')?.drawImage(src, 0, 0)
                        setMapScreenshot(offscreen.toDataURL('image/jpeg', 0.8))
                        setShowBooking(true)
                      })
                    }}>
                      Book this visit
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </button>
                    <p className="mapq-cta-note">Pay when the job is done · we'll confirm as soon as possible</p>
                    <p className="mapq-cta-note" style={{ marginTop: 6 }}>On your first visit, we&apos;ll measure the actual mowed area and adjust your price if needed.</p>

                    <button className="mapq-link mapq-reset" onClick={handleReset}>Start over</button>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Map ── */}
          <div className="mapq-map-wrap">
            <div className="mapq-map-border" style={{ position: 'relative' }}>
              {step === 'idle' && (
                <div className="mapq-curtain">
                  <div className="mapq-curtain-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(82,183,136,.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                  </div>
                  <p className="mapq-curtain-text">Enter your address<br/>to load your property</p>
                </div>
              )}

              {step === 'searching' && (
                <div className="mapq-curtain">
                  <div className="mapq-curtain-icon">
                    <span className="mapq-spinner" style={{ width: 28, height: 28, borderWidth: 3, borderTopColor: 'var(--green-bright)' }} />
                  </div>
                  <p className="mapq-curtain-text">Flying to your property…</p>
                </div>
              )}

              {isDrawing && (
                <div className="mapq-draw-pill">
                  <span className="mapq-pulse-dot" />
                  {ptCount < 3 ? 'Click to place points — trace your lawn' : `${ptCount} points · hit Finish to close`}
                </div>
              )}

              <div ref={mapDivRef} className="mapq-map" />
              <canvas ref={previewCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }} />
            </div>
            <p className="mapq-attribution">Satellite imagery © Esri</p>
            {(step === 'drawing' || step === 'editing') && !showManualSqFt && (
              <button
                onClick={() => setShowManualSqFt(true)}
                style={{ marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.06)', border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(149,219,184,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/>
                  <line x1="8" y1="7" x2="8" y2="17"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="16" y1="7" x2="16" y2="17"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>Can&apos;t see your lawn clearly?</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Enter sq ft manually to get your quote</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            )}
            {showManualSqFt && (
              <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Enter your approximate lawn area</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="e.g. 3500"
                    value={manualSqFtInput}
                    onChange={e => setManualSqFtInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleManualSqFt()}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none' }}
                    autoFocus
                  />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>sq ft</span>
                  <button className="mapq-btn-primary" onClick={handleManualSqFt} style={{ whiteSpace: 'nowrap', padding: '8px 14px' }}>
                    Get quote →
                  </button>
                </div>
                <button className="mapq-link" onClick={() => { setShowManualSqFt(false); setManualSqFtInput('') }} style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                  ← Back to tracing
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Booking modal ── */}
      {showBooking && (
        <div className="booking-overlay" onClick={e => { if (e.target === e.currentTarget) closeBooking() }}>
          <div className="booking-modal">

            {bookingStatus === 'success' ? (
              <div className="booking-success">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--green-bright)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="20 6 9 17 4 12"/>
                </svg>
                <h3>Request locked in.</h3>
                <p>We&apos;ll reach out to confirm your date.</p>
                <button className="booking-success-btn" onClick={closeBooking}>Done</button>
              </div>
            ) : (
              <>
                <button className="booking-close" onClick={closeBooking} aria-label="Close">×</button>
                <h3 className="booking-title">Confirm your booking</h3>

                <div className="booking-summary">
                  <div className="booking-summary-addr">{address}</div>
                  <div className="booking-summary-stats">
                    <span>{lawnSqFt?.toLocaleString()} sq ft</span>
                    <span className="booking-dot">·</span>
                    <span>{FREQ[freq].label}</span>
                    <span className="booking-dot">·</span>
                    <span>${ongoingPrice}/visit</span>
                    {overgrowthFee > 0 && (
                      <><span className="booking-dot">·</span><span>First visit ${firstVisitPrice}</span></>
                    )}
                  </div>
                </div>

                <form onSubmit={handleBookingSubmit}>
                  <div className="booking-fields">
                    <div className="booking-field">
                      <label htmlFor="booking-name">Name</label>
                      <input id="booking-name" type="text" placeholder="Jane Smith" required autoComplete="name" value={bookingName} onChange={e => setBookingName(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label htmlFor="booking-phone">Phone</label>
                      <input id="booking-phone" type="tel" placeholder="(512) 555-0100" required autoComplete="tel" value={bookingPhone} onChange={e => setBookingPhone(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label htmlFor="booking-email">Email <span className="booking-optional">optional</span></label>
                      <input id="booking-email" type="email" placeholder="jane@example.com" autoComplete="email" value={bookingEmail} onChange={e => setBookingEmail(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label>Preferred first visit <span className="booking-optional">optional</span></label>
                      <div className="booking-daypicker-wrap">
                        <DayPicker
                          mode="single"
                          selected={bookingDate}
                          onSelect={setBookingDate}
                          disabled={{ before: (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0,0,0,0); return d })() }}
                          startMonth={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d })()}
                          classNames={{ root: 'booking-daypicker' }}
                        />
                      </div>
                    </div>
                  </div>

                  {bookingError && <p className="booking-error" role="alert">{bookingError}</p>}

                  <button type="submit" className="booking-submit" disabled={bookingStatus === 'submitting'}>
                    {bookingStatus === 'submitting'
                      ? <><span className="mapq-spinner" style={{ borderTopColor: '#fff' }} /> Sending…</>
                      : 'Request this visit →'}
                  </button>
                </form>
                <p className="booking-note">No payment now · we&apos;ll confirm as soon as possible</p>
              </>
            )}
          </div>
        </div>
      )}

      <p className="mapq-text-fallback">
        Prefer to talk to a person?{' '}
        <a href="mailto:hello@quietgreen.co?subject=Quote%20Request&body=Hi%2C%20I%27d%20like%20a%20quote%20for%20my%20lawn%20at%20">
          Email us your address
        </a>{' '}
        and we'll send you a price.
      </p>
    </section>
  )
}
