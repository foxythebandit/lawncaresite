'use client'

import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import { useEffect, useRef, useState, useCallback } from 'react'

type Step = 1 | 2 | 3
type Frequency = 'monthly' | 'biweekly' | 'weekly'

const FREQ: Record<Frequency, { label: string; sub: string; discount: number }> = {
  monthly:  { label: 'Monthly',   sub: '1× / month',  discount: 0  },
  biweekly: { label: 'Bi-weekly', sub: '2× / month',  discount: 10 },
  weekly:   { label: 'Weekly',    sub: '4× / month',  discount: 15 },
}

function calcPrice(sqFt: number): number {
  if (sqFt <= 2000) return 39
  if (sqFt <= 5000) return 39 + Math.round((sqFt - 2000) * 0.013)
  if (sqFt <= 12000) return 78 + Math.round((sqFt - 5000) * 0.010)
  return 148 + Math.round((sqFt - 12000) * 0.007)
}

export default function MapQuoteBuilder() {
  const mapDivRef   = useRef<HTMLDivElement>(null)
  const mapRef      = useRef<any>(null)
  const drawnRef    = useRef<any>(null)

  const [step,      setStep]      = useState<Step>(1)
  const [address,   setAddress]   = useState('')
  const [searching, setSearching] = useState(false)
  const [drawing,   setDrawing]   = useState(false)
  const [sqFt,      setSqFt]      = useState<number | null>(null)
  const [animSqFt,  setAnimSqFt]  = useState(0)
  const [freq,      setFreq]      = useState<Frequency>('biweekly')
  const [error,     setError]     = useState('')
  const [mapReady,  setMapReady]  = useState(false)

  /* ─── Init Leaflet ───────────────────────────────────── */
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    let alive = true

    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet-draw')
      if (!alive || !mapDivRef.current) return

      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(mapDivRef.current, {
        center: [39.8, -98.5],
        zoom: 4,
        zoomControl: false,
        attributionControl: false,
      })

      L.control.zoom({ position: 'topright' }).addTo(map)

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 21 }
      ).addTo(map)

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 21, opacity: 0.75 }
      ).addTo(map)

      const drawn = new (L as any).FeatureGroup()
      map.addLayer(drawn)
      drawnRef.current = drawn

      map.on('draw:created', (e: any) => {
        if (!alive) return
        drawn.clearLayers()
        drawn.addLayer(e.layer)

        const latlngs = e.layer.getLatLngs()[0]
        const m2 = (L as any).GeometryUtil.geodesicArea(latlngs)
        const ft2 = Math.round(m2 * 10.7639)

        setSqFt(ft2)
        setDrawing(false)
        setStep(3)
        map.fitBounds(e.layer.getBounds(), { padding: [56, 56] })
      })

      mapRef.current = map
      if (alive) setMapReady(true)
    })()

    return () => {
      alive = false
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  /* ─── Animate counter ────────────────────────────────── */
  useEffect(() => {
    if (!sqFt) return
    const dur = 1100, t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1)
      const e = 1 - Math.pow(1 - p, 3)
      setAnimSqFt(Math.round(e * sqFt))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [sqFt])

  /* ─── Address search ─────────────────────────────────── */
  const handleSearch = useCallback(async (ev?: React.FormEvent) => {
    ev?.preventDefault()
    if (!address.trim() || !mapRef.current) return
    setSearching(true)
    setError('')
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json()
      if (!data.length) { setError('Address not found — try adding city or zip.'); return }
      mapRef.current.setView([+data[0].lat, +data[0].lon], 19)
      setStep(2)
    } catch {
      setError('Search failed. Please try again.')
    } finally { setSearching(false) }
  }, [address])

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation || !mapRef.current) return
    setSearching(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { mapRef.current.setView([p.coords.latitude, p.coords.longitude], 19); setStep(2); setSearching(false) },
      ()  => { setError('Location denied.'); setSearching(false) }
    )
  }, [])

  /* ─── Draw polygon ───────────────────────────────────── */
  const handleDraw = useCallback(async () => {
    if (!mapRef.current) return
    const L = (await import('leaflet')).default
    drawnRef.current?.clearLayers()
    setSqFt(null)
    if (step === 3) setStep(2)

    const handler = new (L as any).Draw.Polygon(mapRef.current, {
      shapeOptions: {
        color: '#52b788', fillColor: '#52b788',
        fillOpacity: 0.18, weight: 3,
        dashArray: undefined,
      },
    })
    handler.enable()
    setDrawing(true)
  }, [step])

  const handleReset = useCallback(() => {
    drawnRef.current?.clearLayers()
    setSqFt(null)
    setStep(1)
    setAddress('')
    setError('')
  }, [])

  /* ─── Pricing ────────────────────────────────────────── */
  const basePrice  = sqFt ? calcPrice(sqFt) : 0
  const discount   = FREQ[freq].discount
  const finalPrice = sqFt ? Math.round(basePrice * (1 - discount / 100)) : 0

  /* ─── Step colours ───────────────────────────────────── */
  const stepDone   = (n: number) => step > n
  const stepActive = (n: number) => step === n

  return (
    <section className="mapq-section" id="map-quote">

      {/* Decorative blobs */}
      <div className="mapq-blob mapq-blob-a" />
      <div className="mapq-blob mapq-blob-b" />

      <div className="mapq-inner">

        {/* ── Header ── */}
        <div className="mapq-header">
          <div className="section-label" style={{ color: 'var(--green-bright)' }}>Instant Quote</div>
          <h2 className="section-h2" style={{ color: '#fff', marginBottom: 14 }}>
            Map your lawn.{' '}
            <em style={{ color: 'var(--green-bright)', fontStyle: 'italic' }}>See your price.</em>
          </h2>
          <p className="section-sub" style={{ color: 'rgba(255,255,255,.5)', margin: '0 auto', textAlign: 'center', maxWidth: 520 }}>
            Draw your lawn boundary on satellite imagery — we measure the exact square footage
            and give you a real fixed price in seconds.
          </p>
        </div>

        {/* ── Grid ── */}
        <div className="mapq-grid">

          {/* ── Left panel: Steps ── */}
          <div className="mapq-panel">

            {/* Step 1 */}
            <div className="mapq-step">
              <div className={`mapq-step-indicator ${stepDone(1) ? 'done' : stepActive(1) ? 'active' : 'idle'}`}>
                {stepDone(1)
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : '1'}
              </div>
              <div className="mapq-step-line" style={{ opacity: step > 1 ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${stepActive(1) ? 'active' : ''}`}>Find your property</div>
                {stepActive(1) && (
                  <form onSubmit={handleSearch} className="mapq-search-form" style={{ marginTop: 14 }}>
                    <div className="mapq-input-wrap">
                      <svg className="mapq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        className="mapq-input"
                        type="text"
                        placeholder="Enter your address…"
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        disabled={!mapReady}
                        autoComplete="street-address"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button type="submit" className="mapq-btn-primary" disabled={searching || !mapReady}>
                        {searching
                          ? <><span className="mapq-spinner" /> Searching…</>
                          : 'Find it →'}
                      </button>
                      <button type="button" className="mapq-btn-ghost" onClick={handleGeolocate} disabled={searching}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                        </svg>
                        My location
                      </button>
                    </div>
                    {error && <p className="mapq-error">{error}</p>}
                  </form>
                )}
                {stepDone(1) && (
                  <p className="mapq-step-done-text">
                    {address || 'Location found'}
                    <button className="mapq-link" onClick={() => setStep(1)}> · change</button>
                  </p>
                )}
              </div>
            </div>

            {/* Step 2 */}
            <div className="mapq-step">
              <div className={`mapq-step-indicator ${stepDone(2) ? 'done' : stepActive(2) ? 'active' : 'idle'}`}>
                {stepDone(2)
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : '2'}
              </div>
              <div className="mapq-step-line" style={{ opacity: step > 2 ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${stepActive(2) ? 'active' : ''}`}>Trace your lawn</div>
                {stepActive(2) && (
                  <div style={{ marginTop: 14 }}>
                    <p className="mapq-hint">
                      Click point-by-point around your lawn on the satellite map. Double-click the last point to close the shape.
                    </p>
                    <button
                      className="mapq-btn-draw"
                      onClick={handleDraw}
                      disabled={drawing}
                    >
                      {drawing
                        ? <><span className="mapq-pulse-dot" /> Drawing… (double-click to finish)</>
                        : <><PencilIcon /> Draw my lawn</>}
                    </button>
                  </div>
                )}
                {stepDone(2) && (
                  <p className="mapq-step-done-text">
                    Lawn traced
                    <button className="mapq-link" onClick={handleDraw}> · redraw</button>
                  </p>
                )}
              </div>
            </div>

            {/* Step 3 */}
            <div className="mapq-step mapq-step-last">
              <div className={`mapq-step-indicator ${stepActive(3) || stepDone(3) ? 'active' : 'idle'}`}>
                {(stepActive(3) || stepDone(3))
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                    </svg>
                  : '3'}
              </div>
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${stepActive(3) ? 'active' : ''}`}>Your instant quote</div>

                {step === 3 && sqFt && (
                  <div className="mapq-quote-card">

                    {/* Sq ft measurement */}
                    <div className="mapq-sqft-row">
                      <div>
                        <div className="mapq-sqft-num">{animSqFt.toLocaleString()}</div>
                        <div className="mapq-sqft-label">sq ft measured</div>
                      </div>
                      <div className="mapq-sqft-badge">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                        </svg>
                        EV Mowing
                      </div>
                    </div>

                    {/* Frequency selector */}
                    <div className="mapq-freq-label">How often?</div>
                    <div className="mapq-freq-row">
                      {(Object.entries(FREQ) as [Frequency, typeof FREQ[Frequency]][]).map(([key, f]) => (
                        <button
                          key={key}
                          className={`mapq-freq-btn ${freq === key ? 'selected' : ''}`}
                          onClick={() => setFreq(key)}
                        >
                          <span className="mapq-freq-name">{f.label}</span>
                          <span className="mapq-freq-sub">{f.sub}</span>
                          {f.discount > 0 && (
                            <span className="mapq-freq-discount">–{f.discount}%</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Price breakdown */}
                    <div className="mapq-price-rows">
                      <div className="mapq-price-row">
                        <span>Base rate</span>
                        <span>${basePrice}</span>
                      </div>
                      {discount > 0 && (
                        <div className="mapq-price-row mapq-price-discount">
                          <span>{FREQ[freq].label} discount</span>
                          <span>–${basePrice - finalPrice}</span>
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
                          <path d="M2 22c1.25-1.25 2.5-2.5 3.75-3.75M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10"/>
                          <path d="M12 2C6.48 2 2 6.48 2 12"/>
                        </svg>
                        Zero emissions
                      </div>
                    </div>

                    <a href="#map-quote" className="mapq-cta">
                      Book this price
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </a>
                    <p className="mapq-cta-note">No commitment · we confirm within 2 hrs</p>

                    <button className="mapq-link mapq-reset" onClick={handleReset}>Start over</button>
                  </div>
                )}
              </div>
            </div>

          </div>{/* /panel */}

          {/* ── Right: Map ── */}
          <div className="mapq-map-wrap">
            <div className="mapq-map-border">
              <div ref={mapDivRef} className="mapq-map" />

              {/* Step-1 curtain */}
              {step === 1 && (
                <div className="mapq-curtain">
                  <div className="mapq-curtain-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                  </div>
                  <p className="mapq-curtain-text">Enter your address<br />to see your property</p>
                </div>
              )}

              {/* Drawing pill */}
              {drawing && (
                <div className="mapq-draw-pill">
                  <span className="mapq-pulse-dot" />
                  Click to draw · Double-click to finish
                </div>
              )}

              {/* Step-2 hint overlay (before drawing starts) */}
              {step === 2 && !drawing && !sqFt && (
                <div className="mapq-step2-hint">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(82,183,136,.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                  Press "Draw my lawn" then click your boundary
                </div>
              )}
            </div>
            <p className="mapq-attribution">Satellite © Esri · Geocoding © OpenStreetMap contributors</p>
          </div>

        </div>{/* /grid */}
      </div>
    </section>
  )
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}
