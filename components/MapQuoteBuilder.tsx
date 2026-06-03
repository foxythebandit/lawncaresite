'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState, useCallback } from 'react'

/* ── Types ────────────────────────────────────────────── */
type AppStep = 'idle' | 'searching' | 'analyzing' | 'animating' | 'done' | 'editing'
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

const SCAN_MSGS = [
  'Locating property…',
  'Reading satellite imagery…',
  'Detecting lawn boundaries…',
  'Calculating area…',
]

const SECT_COLORS = ['#52b788', '#74c9a0', '#2d9e6b', '#38a878', '#95dbb8']

/* ── Helpers ──────────────────────────────────────────── */

function uid() { return Math.random().toString(36).slice(2, 8) }

function mockProperty(center: [number, number]) {
  const [lng, lat] = center
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLat = 1 / 364000
  const dLng = dLat / cosLat

  const lW = 78 * dLng
  const lD = 115 * dLat
  const lot: [number, number][] = [
    [lng - lW * 0.50, lat - lD * 0.42],
    [lng + lW * 0.52, lat - lD * 0.40],
    [lng + lW * 0.50, lat + lD * 0.58],
    [lng - lW * 0.48, lat + lD * 0.60],
    [lng - lW * 0.50, lat - lD * 0.42],
  ]

  const bW = 40 * dLng, bD = 52 * dLat, bY = -lD * 0.06
  const building: [number, number][] = [
    [lng - bW * 0.5, lat + bY - bD * 0.5],
    [lng + bW * 0.5, lat + bY - bD * 0.5],
    [lng + bW * 0.5, lat + bY + bD * 0.5],
    [lng - bW * 0.5, lat + bY + bD * 0.5],
    [lng - bW * 0.5, lat + bY - bD * 0.5],
  ]

  const lotSqFt      = Math.round(78 * 115)
  const buildingSqFt = Math.round(40 * 52)
  const hardscapeSqFt = Math.round(lotSqFt * 0.13)
  const lawnSqFt     = lotSqFt - buildingSqFt - hardscapeSqFt

  return { lot, building, lotSqFt, buildingSqFt, hardscapeSqFt, lawnSqFt }
}

function calcPrice(sqFt: number): number {
  if (sqFt <= 2000)  return 39
  if (sqFt <= 5000)  return 39  + Math.round((sqFt - 2000)  * 0.013)
  if (sqFt <= 12000) return 78  + Math.round((sqFt - 5000)  * 0.010)
  return                      148 + Math.round((sqFt - 12000) * 0.007)
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function traceGrad(p: number): unknown {
  if (p <= 0) return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(82,183,136,0)', 1, 'rgba(82,183,136,0)']
  if (p >= 1) return ['interpolate', ['linear'], ['line-progress'], 0, '#52b788', 1, '#52b788']
  const stops: Array<[number, string]> = [[0, '#52b788']]
  const edge = p - 0.01
  if (edge > 0) stops.push([edge, '#52b788'])
  stops.push([p, 'rgba(82,183,136,0)'], [1, 'rgba(82,183,136,0)'])
  return ['interpolate', ['linear'], ['line-progress'], ...stops.flat()]
}

function glowGrad(p: number): unknown {
  if (p < 0.05) return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(82,183,136,0)', 1, 'rgba(82,183,136,0)']
  if (p >= 1)   return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(82,183,136,0)', 1, 'rgba(82,183,136,0)']
  const tail = Math.min(p - 0.01, 0.15)
  const stops: Array<[number, string]> = [
    [0,              'rgba(82,183,136,0)'],
    [p - tail,       'rgba(82,183,136,0)'],
    [p - tail * 0.3, 'rgba(82,183,136,0.45)'],
    [p,              'rgba(140,230,180,1)'],
  ]
  const after = p + 0.005
  if (after < 1) stops.push([after, 'rgba(82,183,136,0)'])
  stops.push([1, 'rgba(82,183,136,0)'])
  return ['interpolate', ['linear'], ['line-progress'], ...stops.flat()]
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

/* ── Component ────────────────────────────────────────── */
export default function MapQuoteBuilder() {
  const mapDivRef  = useRef<HTMLDivElement>(null)
  const mapRef     = useRef<any>(null)
  const rafRef     = useRef<number>(0)
  // Holds mutable draw state to avoid stale closures in event handlers
  const drawRef    = useRef<{
    points: [number, number][]
    timer: ReturnType<typeof setTimeout> | null
    clickFn: ((e: any) => void) | null
    dblFn:   (() => void) | null
  }>({ points: [], timer: null, clickFn: null, dblFn: null })

  const [step,      setStep]      = useState<AppStep>('idle')
  const [address,   setAddress]   = useState('')
  const [error,     setError]     = useState('')
  const [scanMsg,   setScanMsg]   = useState(SCAN_MSGS[0])
  const [sections,  setSections]  = useState<Section[]>([])
  const [lawnSqFt,  setLawnSqFt]  = useState<number | null>(null)
  const [lotSqFt,   setLotSqFt]   = useState<number | null>(null)
  const [animSqFt,  setAnimSqFt]  = useState(0)
  const [freq,      setFreq]      = useState<Frequency>('biweekly')
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawCount, setDrawCount] = useState(0) // forces re-render during draw

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
      })
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
      mapRef.current = map
    })()
    return () => { alive = false; cancelAnimationFrame(rafRef.current); mapRef.current?.remove(); mapRef.current = null }
  }, [])

  /* ─── sq ft counter ──────────────────────────────────── */
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

  /* ─── Scan message cycler ───────────────────────────── */
  useEffect(() => {
    if (step !== 'analyzing') return
    let i = 0
    const iv = setInterval(() => setScanMsg(SCAN_MSGS[i = (i + 1) % SCAN_MSGS.length]), 700)
    return () => clearInterval(iv)
  }, [step])

  /* ─── Sync sections → map ────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('sections-data') as any
    if (src) src.setData(sectionsGeoJSON(sections))
  }, [sections])

  /* ─── Animate property ───────────────────────────────── */
  const animateProperty = useCallback(async (center: [number, number]) => {
    const map = mapRef.current
    if (!map) return

    const { lot, building, lawnSqFt: lsf, lotSqFt: lotsf } = mockProperty(center)

    // Clean up prior state
    ;['lot-fill','lot-trace','lot-glow','building-fill','sections-fill','sections-outline'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
    ;['lot-line','lot-poly','lot-building','sections-data'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })

    const lngs = lot.map(c => c[0]), lats = lot.map(c => c[1])
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 110, maxZoom: 19, duration: 1800 })

    await new Promise(r => setTimeout(r, 2400))
    setStep('animating')

    map.addSource('lot-line', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lot } } })
    map.addSource('lot-poly',     { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [lot] } } })
    map.addSource('lot-building', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [building] } } })

    map.addLayer({ id: 'lot-glow',  type: 'line', source: 'lot-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 20, 'line-blur': 10, 'line-gradient': glowGrad(0) as any } })
    map.addLayer({ id: 'lot-trace', type: 'line', source: 'lot-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 3, 'line-gradient': traceGrad(0) as any } })

    const TRACE_DUR = 2600, t0 = performance.now()
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        const raw = Math.min((now - t0) / TRACE_DUR, 1), p = easeInOut(raw)
        map.setPaintProperty('lot-trace', 'line-gradient', traceGrad(p))
        map.setPaintProperty('lot-glow',  'line-gradient', glowGrad(p))
        if (raw < 1) { rafRef.current = requestAnimationFrame(tick) } else { resolve() }
      }
      rafRef.current = requestAnimationFrame(tick)
    })

    map.setPaintProperty('lot-trace', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, '#52b788', 1, '#52b788'])
    map.setPaintProperty('lot-glow',  'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(82,183,136,0)', 1, 'rgba(82,183,136,0)'])

    map.addLayer({ id: 'lot-fill',      type: 'fill', source: 'lot-poly',     paint: { 'fill-color': '#52b788', 'fill-opacity': 0 } }, 'lot-glow')
    map.addLayer({ id: 'building-fill', type: 'fill', source: 'lot-building', paint: { 'fill-color': '#0d2118', 'fill-opacity': 0 } })

    const f0 = performance.now()
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        const t = Math.min((now - f0) / 750, 1), p = 1 - Math.pow(1 - t, 2)
        map.setPaintProperty('lot-fill',      'fill-opacity', p * 0.22)
        map.setPaintProperty('building-fill', 'fill-opacity', p * 0.55)
        if (t < 1) { rafRef.current = requestAnimationFrame(tick) } else { resolve() }
      }
      rafRef.current = requestAnimationFrame(tick)
    })

    // Store initial detected section
    setSections([{ id: uid(), name: 'Detected area', sqFt: lsf, coords: lot }])
    setLawnSqFt(lsf)
    setLotSqFt(lotsf)
    setStep('done')
  }, [])

  /* ─── Address search ─────────────────────────────────── */
  const handleSearch = useCallback(async (ev?: React.FormEvent) => {
    ev?.preventDefault()
    if (!address.trim() || !mapRef.current) return
    setError(''); setStep('searching'); setScanMsg(SCAN_MSGS[0])
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, { headers: { 'Accept-Language': 'en' } })
      const data = await res.json()
      if (!data.length) { setError('Address not found — try adding city or zip.'); setStep('idle'); return }
      setStep('analyzing')
      await animateProperty([+data[0].lon, +data[0].lat])
    } catch { setError('Search failed. Please try again.'); setStep('idle') }
  }, [address, animateProperty])

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
    if (d.dblFn)   map.off('dblclick', d.dblFn)
    if (d.timer)   clearTimeout(d.timer)
    d.clickFn = null; d.dblFn = null; d.timer = null; d.points = []
    map.doubleClickZoom.enable()
    map.getCanvas().style.cursor = ''
    ;['draw-fill','draw-line','draw-vertices'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
    try { map.getSource('draw-data') && map.removeSource('draw-data') } catch {}
    setIsDrawing(false); setDrawCount(0)
  }, [])

  const startDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    stopDraw() // clean up if already drawing

    map.doubleClickZoom.disable()
    map.getCanvas().style.cursor = 'crosshair'
    drawRef.current.points = []

    map.addSource('draw-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'draw-fill',     type: 'fill',   source: 'draw-data', filter: ['==', ['get', 't'], 'poly'], paint: { 'fill-color': '#52b788', 'fill-opacity': 0.12 } })
    map.addLayer({ id: 'draw-line',     type: 'line',   source: 'draw-data', filter: ['==', ['get', 't'], 'line'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#52b788', 'line-width': 2.5, 'line-dasharray': [4, 3] } })
    map.addLayer({ id: 'draw-vertices', type: 'circle', source: 'draw-data', filter: ['==', ['get', 't'], 'pt'],   paint: { 'circle-radius': 5, 'circle-color': '#52b788', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })

    const clickFn = (e: any) => {
      const d = drawRef.current
      if (d.timer) clearTimeout(d.timer)
      d.timer = setTimeout(() => {
        d.points = [...d.points, [e.lngLat.lng, e.lngLat.lat]]
        updateDrawSource()
        setDrawCount(c => c + 1)
      }, 180)
    }

    const dblFn = () => {
      const d = drawRef.current
      if (d.timer) clearTimeout(d.timer)
      const pts = d.points
      if (pts.length < 3) { stopDraw(); return }
      const closed = [...pts, pts[0]]
      const sqFt   = polygonSqFt(pts)
      setSections(prev => {
        const next = [...prev, { id: uid(), name: `Area ${prev.length + 1}`, sqFt, coords: closed }]
        return next
      })
      stopDraw()
    }

    drawRef.current.clickFn = clickFn
    drawRef.current.dblFn   = dblFn
    map.on('click', clickFn)
    map.on('dblclick', dblFn)
    setIsDrawing(true)
  }, [stopDraw, updateDrawSource])

  /* ─── Edit mode ──────────────────────────────────────── */
  const enterEditMode = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    // Swap lot layers → sections layers
    ;['lot-fill','lot-trace','lot-glow','building-fill'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })

    if (!map.getSource('sections-data')) {
      map.addSource('sections-data', { type: 'geojson', data: sectionsGeoJSON([]) })
      map.addLayer({ id: 'sections-fill',    type: 'fill', source: 'sections-data', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } })
      map.addLayer({ id: 'sections-outline', type: 'line', source: 'sections-data', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
    }
    setStep('editing')
  }, [])

  const deleteSection = useCallback((id: string) => {
    setSections(prev => prev.filter(s => s.id !== id))
  }, [])

  const applyEdit = useCallback(() => {
    if (isDrawing) stopDraw()
    setSections(prev => {
      const total = prev.reduce((s, sec) => s + sec.sqFt, 0)
      setLawnSqFt(total)
      return prev
    })
    setStep('done')
  }, [isDrawing, stopDraw])

  /* ─── Reset ──────────────────────────────────────────── */
  const handleReset = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    stopDraw()
    const map = mapRef.current
    if (map) {
      ;['lot-fill','lot-trace','lot-glow','building-fill','sections-fill','sections-outline'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
      ;['lot-line','lot-poly','lot-building','sections-data'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })
      map.flyTo({ center: [-98.5, 39.8], zoom: 4, duration: 1200 })
    }
    setStep('idle'); setAddress(''); setError('')
    setLawnSqFt(null); setLotSqFt(null); setAnimSqFt(0); setSections([])
  }, [stopDraw])

  /* ─── Pricing ────────────────────────────────────────── */
  const editTotal  = sections.reduce((s, sec) => s + sec.sqFt, 0)
  const basePrice  = lawnSqFt ? calcPrice(lawnSqFt) : 0
  const discount   = FREQ[freq].discount
  const finalPrice = lawnSqFt ? Math.round(basePrice * (1 - discount / 100)) : 0

  const isAnalyzing = step === 'analyzing' || step === 'animating'
  const isDone      = step === 'done' || step === 'editing'

  /* ─── JSX ────────────────────────────────────────────── */
  return (
    <section className="mapq-section" id="map-quote">
      <div className="mapq-blob mapq-blob-a" />
      <div className="mapq-blob mapq-blob-b" />

      <div className="mapq-inner">
        <div className="mapq-header">
          <div className="section-label" style={{ color: 'var(--green-bright)' }}>Instant Quote</div>
          <h2 className="section-h2" style={{ color: '#fff', marginBottom: 14 }}>
            Enter your address.{' '}
            <em style={{ color: 'var(--green-bright)', fontStyle: 'italic' }}>We handle the rest.</em>
          </h2>
          <p className="section-sub" style={{ color: 'rgba(255,255,255,.5)', margin: '0 auto', textAlign: 'center', maxWidth: 520 }}>
            Our system reads satellite imagery, automatically detects your lawn boundary, and gives you a fixed price — no drawing required.
          </p>
        </div>

        <div className="mapq-grid">
          {/* ── Left panel ── */}
          <div className="mapq-panel">

            {/* Step 1 */}
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
                      <svg className="mapq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input className="mapq-input" type="text" placeholder="123 Main St, Austin TX…" value={address} onChange={e => setAddress(e.target.value)} autoComplete="street-address" />
                    </div>
                    <button type="submit" className="mapq-btn-primary" style={{ marginTop: 10, width: '100%' }} disabled={step === 'searching' || !address.trim()}>
                      {step === 'searching' ? <><span className="mapq-spinner" /> Finding…</> : 'Analyze my lawn →'}
                    </button>
                    {error && <p className="mapq-error">{error}</p>}
                  </form>
                )}
                {step !== 'idle' && step !== 'searching' && (
                  <p className="mapq-step-done-text">{address}<button className="mapq-link" onClick={handleReset}> · new search</button></p>
                )}
              </div>
            </div>

            {/* Step 2 — auto */}
            <div className="mapq-step">
              <div className={`mapq-step-indicator ${isDone ? 'done' : isAnalyzing ? 'active' : 'idle'}`}>
                {isDone ? <CheckIcon /> : isAnalyzing ? <span className="mapq-spinner" style={{ borderTopColor: 'var(--green-deep)', width: 14, height: 14, borderWidth: 2 }} /> : '2'}
              </div>
              <div className="mapq-step-line" style={{ opacity: isDone ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${isAnalyzing ? 'active' : ''}`}>
                  {step === 'animating' ? 'Drawing boundaries…' : 'Analyzing property'}
                </div>
                {step === 'analyzing' && (
                  <div style={{ marginTop: 10 }}>
                    <p className="mapq-scan-text">{scanMsg}</p>
                    <div className="mapq-scan-bar"><div className="mapq-scan-bar-fill" /></div>
                  </div>
                )}
                {step === 'animating' && <p className="mapq-scan-text" style={{ marginTop: 10 }}>Tracing your lawn on the satellite map…</p>}
                {isDone && lotSqFt && <p className="mapq-step-done-text">{lotSqFt.toLocaleString()} sq ft lot detected</p>}
              </div>
            </div>

            {/* Step 3 — quote or edit */}
            <div className="mapq-step mapq-step-last">
              <div className={`mapq-step-indicator ${isDone ? (step === 'editing' ? 'done' : 'active') : 'idle'}`}>
                {step === 'editing'
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  : isDone
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    : '3'}
              </div>
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${isDone ? 'active' : ''}`}>
                  {step === 'editing' ? 'Adjust sections' : 'Your instant quote'}
                </div>

                {/* ── Quote card ── */}
                {step === 'done' && lawnSqFt && (
                  <div className="mapq-quote-card">
                    <div className="mapq-area-breakdown">
                      <div className="mapq-area-row">
                        <span className="mapq-area-swatch" style={{ background: 'rgba(82,183,136,.35)' }} />
                        <span>Total lot</span>
                        <span>{lotSqFt?.toLocaleString()} sq ft</span>
                      </div>
                      <div className="mapq-area-row">
                        <span className="mapq-area-swatch" style={{ background: 'rgba(13,33,24,.9)' }} />
                        <span>House + hardscape</span>
                        <span>–{((lotSqFt ?? 0) - lawnSqFt).toLocaleString()} sq ft</span>
                      </div>
                      <div className="mapq-area-row mapq-area-highlight">
                        <span className="mapq-area-swatch" style={{ background: '#52b788' }} />
                        <span>Lawn to mow</span>
                        <span className="mapq-sqft-anim">{animSqFt.toLocaleString()} sq ft</span>
                      </div>
                    </div>

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

                    <div className="mapq-price-rows">
                      <div className="mapq-price-row"><span>Base rate</span><span>${basePrice}</span></div>
                      {discount > 0 && (
                        <div className="mapq-price-row mapq-price-discount">
                          <span>{FREQ[freq].label} discount</span><span>–${basePrice - finalPrice}</span>
                        </div>
                      )}
                    </div>

                    <div className="mapq-price-total">
                      <div>
                        <div className="mapq-price-val">${finalPrice}</div>
                        <div className="mapq-price-per">per visit · fixed price</div>
                      </div>
                      <div className="mapq-eco-badge">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
                        Zero emissions
                      </div>
                    </div>

                    <a href="#map-quote" className="mapq-cta">
                      Book this price
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </a>
                    <p className="mapq-cta-note">No commitment · confirmed within 2 hrs</p>

                    {/* Adjust link */}
                    <button className="mapq-adjust-btn" onClick={enterEditMode}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      AI measurement off? Adjust it
                    </button>

                    <p className="mapq-mock-note">* Area estimated — confirmed on first visit</p>
                    <button className="mapq-link mapq-reset" onClick={handleReset}>Start over</button>
                  </div>
                )}

                {/* ── Edit panel ── */}
                {step === 'editing' && (
                  <div className="mapq-edit-panel">
                    <p className="mapq-edit-hint">Each colored area on the map is a section. Delete wrong ones and draw the correct boundaries.</p>

                    <div className="mapq-sections-list">
                      {sections.map((sec, i) => (
                        <div key={sec.id} className="mapq-section-row">
                          <span className="mapq-section-dot" style={{ background: SECT_COLORS[i % SECT_COLORS.length] }} />
                          <span className="mapq-section-name">{sec.name}</span>
                          <span className="mapq-section-sqft">{sec.sqFt.toLocaleString()} <span>sq ft</span></span>
                          <button className="mapq-delete-btn" onClick={() => deleteSection(sec.id)} title="Remove section">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      ))}
                      {sections.length === 0 && (
                        <p className="mapq-empty-sections">No sections yet — draw your lawn areas below.</p>
                      )}
                    </div>

                    <div className="mapq-edit-total">
                      Total: <strong>{editTotal.toLocaleString()} sq ft</strong>
                    </div>

                    {isDrawing ? (
                      <div className="mapq-drawing-hint">
                        <span className="mapq-pulse-dot" />
                        Click to place points · Double-click to close
                        <button className="mapq-link" style={{ marginLeft: 8 }} onClick={stopDraw}>Cancel</button>
                      </div>
                    ) : (
                      <button className="mapq-btn-draw" onClick={startDraw}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        Draw another area
                      </button>
                    )}

                    <button className="mapq-btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={applyEdit}>
                      <CheckIcon /> Update quote
                    </button>
                    <button className="mapq-link" style={{ display: 'block', textAlign: 'center', marginTop: 10 }} onClick={() => setStep('done')}>
                      ← Back without saving
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>{/* /panel */}

          {/* ── Map ── */}
          <div className="mapq-map-wrap">
            <div className="mapq-map-border">
              <div ref={mapDivRef} className="mapq-map" />

              {step === 'idle' && (
                <div className="mapq-curtain">
                  <div className="mapq-curtain-icon">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </div>
                  <p className="mapq-curtain-text">Enter your address to begin</p>
                </div>
              )}

              {step === 'analyzing' && (
                <div className="mapq-scan-overlay"><div className="mapq-scan-line" /></div>
              )}

              {step === 'animating' && (
                <div className="mapq-draw-pill">
                  <span className="mapq-pulse-dot" /> Tracing lawn boundary…
                </div>
              )}

              {step === 'editing' && isDrawing && (
                <div className="mapq-draw-pill mapq-draw-pill-edit">
                  <span className="mapq-pulse-dot" />
                  {drawCount > 0 ? `${drawCount} point${drawCount !== 1 ? 's' : ''} placed · double-click to finish` : 'Click on the map to start drawing'}
                </div>
              )}

              {step === 'editing' && !isDrawing && (
                <div className="mapq-edit-map-badge">Edit mode · {sections.length} section{sections.length !== 1 ? 's' : ''}</div>
              )}
            </div>
            <p className="mapq-attribution">Satellite © Esri · Geocoding © OpenStreetMap contributors · Measurements estimated</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
