'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { submitBooking } from '@/app/actions/submit-booking'

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
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef    = useRef<any>(null)
  const rafRef    = useRef<number>(0)
  const liveRef   = useRef<number>(0) // tracks animated live value

  const drawRef = useRef<{
    points:  [number, number][]
    clickFn: ((e: any) => void) | null
    moveFn:  ((e: any) => void) | null
  }>({ points: [], clickFn: null, moveFn: null })

  const [step,     setStep]     = useState<AppStep>('idle')
  const [address,  setAddress]  = useState('')
  const [error,    setError]    = useState('')
  const [sections, setSections] = useState<Section[]>([])
  const [lawnSqFt, setLawnSqFt] = useState<number | null>(null)
  const [animSqFt, setAnimSqFt] = useState(0)
  const [liveSqFt, setLiveSqFt] = useState(0)
  const [freq,     setFreq]     = useState<Frequency>('biweekly')
  const [lastMow,  setLastMow]  = useState('thisweek')
  const [isDrawing,setIsDrawing]= useState(false)
  const [drawCount,setDrawCount]= useState(0)
  const [ptCount,  setPtCount]  = useState(0)

  const [showBooking,   setShowBooking]   = useState(false)
  const [bookingName,   setBookingName]   = useState('')
  const [bookingPhone,  setBookingPhone]  = useState('')
  const [bookingEmail,  setBookingEmail]  = useState('')
  const [bookingDate,   setBookingDate]   = useState('')
  const [bookingStatus,    setBookingStatus]    = useState<'idle' | 'submitting' | 'success'>('idle')
  const [bookingError,     setBookingError]     = useState('')
  const [mapScreenshot,    setMapScreenshot]    = useState('')

  /* ─── Init MapLibre ──────────────────────────────────── */
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    let alive = true
    ;(async () => {
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

  /* ─── Draw helpers ───────────────────────────────────── */
  const updateDrawSource = useCallback(() => {
    const map = mapRef.current
    const pts = drawRef.current.points
    const src = map?.getSource('draw-data') as any
    if (!src || !pts.length) return
    const features: any[] = []
    if (pts.length >= 3) features.push({ type: 'Feature', properties: { t: 'poly' }, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } })
    features.push({ type: 'Feature', properties: { t: 'line' }, geometry: { type: 'LineString', coordinates: pts } })
    pts.forEach(p => features.push({ type: 'Feature', properties: { t: 'pt' }, geometry: { type: 'Point', coordinates: p } }))
    src.setData({ type: 'FeatureCollection', features })
  }, [])

  const stopDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const d = drawRef.current
    if (d.clickFn) map.off('click', d.clickFn)
    if (d.moveFn)  map.off('mousemove', d.moveFn)
    d.clickFn = null; d.moveFn = null; d.points = []
    map.doubleClickZoom.enable()
    map.getCanvas().style.cursor = ''
    ;['draw-fill','draw-line','draw-vertices','draw-preview-line'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
    ;['draw-data','draw-preview'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })
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

    map.addSource('draw-data',    { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addSource('draw-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'draw-fill',         type: 'fill',   source: 'draw-data',    filter: ['==', ['get', 't'], 'poly'], paint: { 'fill-color': '#52b788', 'fill-opacity': 0.18 } })
    map.addLayer({ id: 'draw-line',         type: 'line',   source: 'draw-data',    filter: ['==', ['get', 't'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#52b788', 'line-width': 2.5 } })
    map.addLayer({ id: 'draw-vertices',     type: 'circle', source: 'draw-data',    filter: ['==', ['get', 't'], 'pt'],   paint: { 'circle-radius': 5, 'circle-color': '#52b788', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
    map.addLayer({ id: 'draw-preview-line', type: 'line',   source: 'draw-preview', paint: { 'line-color': '#95dbb8', 'line-width': 2, 'line-dasharray': [5, 5], 'line-opacity': 0.8 } })

    const clickFn = (e: any) => {
      const d = drawRef.current
      d.points = [...d.points, [e.lngLat.lng, e.lngLat.lat]]
      updateDrawSource()
      setPtCount(d.points.length)
      setDrawCount(c => c + 1)
    }

    const moveFn = (e: any) => {
      const d = drawRef.current
      if (!d.points.length) return
      const last   = d.points[d.points.length - 1]
      const cursor: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      const src = map.getSource('draw-preview') as any
      src?.setData({ type: 'FeatureCollection', features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [last, cursor] },
      }]})
    }

    drawRef.current.clickFn = clickFn
    drawRef.current.moveFn  = moveFn
    map.on('click',     clickFn)
    map.on('mousemove', moveFn)
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

  /* ─── Address search ─────────────────────────────────── */
  const handleSearch = useCallback(async (ev?: React.FormEvent) => {
    ev?.preventDefault()
    if (!address.trim() || !mapRef.current) return
    setError('')
    setStep('searching')
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, { headers: { 'Accept-Language': 'en' } })
      const data = await res.json()
      if (!data.length) { setError('Address not found — try adding city or zip.'); setStep('idle'); return }
      mapRef.current.flyTo({ center: [+data[0].lon, +data[0].lat], zoom: 18, duration: 2000 })
      setTimeout(() => { startDraw(); setStep('drawing') }, 2200)
    } catch {
      setError('Search failed. Please try again.')
      setStep('idle')
    }
  }, [address, startDraw])

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
      ;['sections-fill','sections-outline'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
      ;['sections-data'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })
      map.flyTo({ center: [-98.5, 39.8], zoom: 4, duration: 1200 })
    }
    setStep('idle'); setAddress(''); setError('')
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
    setShowBooking(false); setBookingStatus('idle'); setBookingError('')
  }, [])

  const handleBookingSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setBookingStatus('submitting'); setBookingError('')
    const result = await submitBooking({
      name: bookingName, phone: bookingPhone, email: bookingEmail,
      preferred_date: bookingDate, address,
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
                    <div className="mapq-input-wrap">
                      <svg className="mapq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input className="mapq-input" type="text" placeholder="123 Main St, Austin TX…" value={address} onChange={e => setAddress(e.target.value)} autoComplete="street-address" />
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
                        <button className="mapq-link" onClick={handleReset} style={{ display: 'block', width: '100%', textAlign: 'center', fontSize: 12 }}>
                          Start over
                        </button>
                      </>
                    ) : (
                      <button className="mapq-btn-ghost" onClick={handleReset} style={{ width: '100%' }}>
                        Start over
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
                    <p className="mapq-cta-note">No payment now · we'll confirm within 2 hours</p>

                    <button className="mapq-link mapq-reset" onClick={handleReset}>Start over</button>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Map ── */}
          <div className="mapq-map-wrap">
            <div className="mapq-map-border">
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
            </div>
            <p className="mapq-attribution">Satellite imagery © Esri</p>
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
                <h3>You&apos;re on the list!</h3>
                <p>We&apos;ll text or call within 2 hours to confirm your visit date.</p>
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
                      <label>Name</label>
                      <input type="text" placeholder="Jane Smith" required value={bookingName} onChange={e => setBookingName(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label>Phone</label>
                      <input type="tel" placeholder="(512) 555-0100" required value={bookingPhone} onChange={e => setBookingPhone(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label>Email <span className="booking-optional">optional</span></label>
                      <input type="email" placeholder="jane@example.com" value={bookingEmail} onChange={e => setBookingEmail(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label>Preferred first visit <span className="booking-optional">optional</span></label>
                      <input type="date" min={new Date(Date.now() + 86400000).toISOString().split('T')[0]} value={bookingDate} onChange={e => setBookingDate(e.target.value)} />
                    </div>
                  </div>

                  {bookingError && <p className="booking-error">{bookingError}</p>}

                  <button type="submit" className="booking-submit" disabled={bookingStatus === 'submitting'}>
                    {bookingStatus === 'submitting'
                      ? <><span className="mapq-spinner" style={{ borderTopColor: '#fff' }} /> Sending…</>
                      : 'Request this visit →'}
                  </button>
                </form>
                <p className="booking-note">No payment now · we&apos;ll confirm within 2 hours</p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
