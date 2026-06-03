'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState, useCallback } from 'react'

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

/* ── Helpers ──────────────────────────────────────────── */
function uid() { return Math.random().toString(36).slice(2, 8) }

function calcPrice(sqFt: number): number {
  if (sqFt <= 2000)  return 39
  if (sqFt <= 5000)  return 39  + Math.round((sqFt - 2000)  * 0.013)
  if (sqFt <= 12000) return 78  + Math.round((sqFt - 5000)  * 0.010)
  return                      148 + Math.round((sqFt - 12000) * 0.007)
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
    points: [number, number][]
    timer:   ReturnType<typeof setTimeout> | null
    clickFn: ((e: any) => void) | null
    dblFn:   (() => void) | null
  }>({ points: [], timer: null, clickFn: null, dblFn: null })

  const [step,     setStep]     = useState<AppStep>('idle')
  const [address,  setAddress]  = useState('')
  const [error,    setError]    = useState('')
  const [sections, setSections] = useState<Section[]>([])
  const [lawnSqFt, setLawnSqFt] = useState<number | null>(null)
  const [animSqFt, setAnimSqFt] = useState(0)
  const [liveSqFt, setLiveSqFt] = useState(0)
  const [freq,     setFreq]     = useState<Frequency>('biweekly')
  const [isDrawing,setIsDrawing]= useState(false)
  const [drawCount,setDrawCount]= useState(0)
  const [ptCount,  setPtCount]  = useState(0)

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
    if (d.dblFn)   map.off('dblclick', d.dblFn)
    if (d.timer)   clearTimeout(d.timer)
    d.clickFn = null; d.dblFn = null; d.timer = null; d.points = []
    map.doubleClickZoom.enable()
    map.getCanvas().style.cursor = ''
    ;['draw-fill','draw-line','draw-vertices'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
    try { map.getSource('draw-data') && map.removeSource('draw-data') } catch {}
    setIsDrawing(false); setDrawCount(0); setPtCount(0)
    setLiveSqFt(0); liveRef.current = 0
  }, [])

  const commitPolygon = useCallback((pts: [number, number][]) => {
    if (pts.length < 3) return
    const closed = [...pts, pts[0]]
    const sqFt   = polygonSqFt(pts)
    stopDraw()

    const map = mapRef.current
    if (map && !map.getSource('sections-data')) {
      map.addSource('sections-data', { type: 'geojson', data: sectionsGeoJSON([]) })
      map.addLayer({ id: 'sections-fill',    type: 'fill', source: 'sections-data', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'sections-outline', type: 'line', source: 'sections-data', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
    }

    setSections(prev => {
      const next = [...prev, { id: uid(), name: prev.length === 0 ? 'Lawn' : `Zone ${prev.length + 1}`, sqFt, coords: closed }]
      const total = next.reduce((s, sec) => s + sec.sqFt, 0)
      setLawnSqFt(total)
      return next
    })
    setStep('done')
  }, [stopDraw])

  const startDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    stopDraw()

    map.doubleClickZoom.disable()
    map.getCanvas().style.cursor = 'crosshair'
    drawRef.current.points = []

    map.addSource('draw-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'draw-fill',     type: 'fill',   source: 'draw-data', filter: ['==', ['get', 't'], 'poly'], paint: { 'fill-color': '#52b788', 'fill-opacity': 0.18 } })
    map.addLayer({ id: 'draw-line',     type: 'line',   source: 'draw-data', filter: ['==', ['get', 't'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#52b788', 'line-width': 2.5 } })
    map.addLayer({ id: 'draw-vertices', type: 'circle', source: 'draw-data', filter: ['==', ['get', 't'], 'pt'],   paint: { 'circle-radius': 5, 'circle-color': '#52b788', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })

    const clickFn = (e: any) => {
      const d = drawRef.current
      if (d.timer) clearTimeout(d.timer)
      d.timer = setTimeout(() => {
        d.points = [...d.points, [e.lngLat.lng, e.lngLat.lat]]
        updateDrawSource()
        setPtCount(d.points.length)
        setDrawCount(c => c + 1)
      }, 180)
    }

    const dblFn = () => {
      const d = drawRef.current
      if (d.timer) clearTimeout(d.timer)
      commitPolygon(d.points)
    }

    drawRef.current.clickFn = clickFn
    drawRef.current.dblFn   = dblFn
    map.on('click', clickFn)
    map.on('dblclick', dblFn)
    setIsDrawing(true)
  }, [stopDraw, updateDrawSource, commitPolygon])

  /* ─── Finish button ──────────────────────────────────── */
  const handleFinish = useCallback(() => {
    const d = drawRef.current
    if (d.timer) clearTimeout(d.timer)
    commitPolygon(d.points)
  }, [commitPolygon])

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
    setSections(prev => {
      const next = prev.filter(s => s.id !== id)
      setLawnSqFt(next.reduce((s, sec) => s + sec.sqFt, 0) || null)
      return next
    })
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
    setLawnSqFt(null); setAnimSqFt(0); setSections([])
  }, [stopDraw])

  /* ─── Pricing ────────────────────────────────────────── */
  const basePrice  = lawnSqFt ? calcPrice(lawnSqFt) : 0
  const discount   = FREQ[freq].discount
  const finalPrice = lawnSqFt ? Math.round(basePrice * (1 - discount / 100)) : 0
  const isDone     = step === 'done' || step === 'editing'

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
              <div className={`mapq-step-indicator ${isDone ? 'done' : step === 'drawing' ? 'active' : 'idle'}`}>
                {isDone ? <CheckIcon /> : '2'}
              </div>
              <div className="mapq-step-line" style={{ opacity: isDone ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${step === 'drawing' ? 'active' : ''}`}>
                  Trace your lawn
                </div>

                {step === 'drawing' && (
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
                        : 'Keep going — double-click anywhere to close and finish'}
                    </p>

                    {ptCount >= 3 && (
                      <button className="mapq-btn-primary" onClick={handleFinish} style={{ width: '100%', marginBottom: 8 }}>
                        Finish tracing ✓
                      </button>
                    )}
                    <button className="mapq-btn-ghost" onClick={handleReset} style={{ width: '100%' }}>
                      Start over
                    </button>
                  </div>
                )}

                {isDone && lawnSqFt && (
                  <p className="mapq-step-done-text">
                    {lawnSqFt.toLocaleString()} sq ft traced
                    {step === 'done' && <button className="mapq-link" onClick={enterEditMode}> · add a zone</button>}
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
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
                          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
                        </svg>
                        Zero emissions
                      </div>
                    </div>

                    <a href="mailto:hello@quietgreen.com" className="mapq-cta">
                      Book this visit
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </a>
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

              {step === 'drawing' && (
                <div className="mapq-draw-pill">
                  <span className="mapq-pulse-dot" />
                  {ptCount < 3 ? 'Click to place points — trace your lawn' : `${ptCount} points · double-click or tap Finish to close`}
                </div>
              )}

              <div ref={mapDivRef} className="mapq-map" />
            </div>
            <p className="mapq-attribution">Satellite imagery © Esri</p>
          </div>
        </div>
      </div>
    </section>
  )
}
