'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ESRI_IMAGERY, MAPBOX_TOKEN } from '@/lib/map-imagery'
import { emailMoney, type QuoteEmailRow } from '@/lib/quote-email'
import { bookQuote } from './actions'

type Section = { name: string; sqFt: number; coords: [number, number][] | null }
type Start = 'asap' | 'date' | 'unsure'

type PublicOffer = { sqFt: number; mowing: boolean; rows: QuoteEmailRow[]; message: string }

/* Live satellite map of the property with the traced lawn outlined, using the same imagery as the staff quote map. */
function MeasurementView({ sections }: { sections: Section[] }) {
  const mapDiv = useRef<HTMLDivElement>(null)
  const hasTraced = sections.some(s => s.coords && s.coords.length >= 3)
  useEffect(() => {
    const traced = sections.filter(s => s.coords && s.coords.length >= 3)
    if (!mapDiv.current || !traced.length) return
    let map: import('maplibre-gl').Map | undefined
    let alive = true
    import('maplibre-gl').then(({ default: ml }) => {
      if (!alive || !mapDiv.current) return
      const points = traced.flatMap(s => s.coords!)
      const lngs = points.map(p => p[0]), lats = points.map(p => p[1])
      map = new ml.Map({
        container: mapDiv.current,
        style: { version: 8, sources: {
          satellite: MAPBOX_TOKEN
            ? { type: 'raster', tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`], tileSize: 512, maxzoom: 22 }
            : { type: 'raster', tiles: [`${ESRI_IMAGERY}/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
          lawn: { type: 'geojson', data: { type: 'FeatureCollection', features: traced.map(s => ({
            type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [s.coords!] } })) } },
        }, layers: [
          { id: 'satellite', type: 'raster', source: 'satellite' },
          { id: 'lawn-fill', type: 'fill', source: 'lawn', paint: { 'fill-color': '#52b788', 'fill-opacity': 0.3 } },
          { id: 'lawn-line', type: 'line', source: 'lawn', paint: { 'line-color': '#52f0a0', 'line-width': 2.5 } },
        ] },
        bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        // Stop at the imagery's sharpest level so the house and yard stay in view.
        fitBoundsOptions: { padding: 56, maxZoom: MAPBOX_TOKEN ? 20 : 19 },
        maxZoom: 21, attributionControl: false, cooperativeGestures: true,
      })
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
      map.addControl(new ml.FullscreenControl(), 'top-right')
    })
    return () => { alive = false; map?.remove() }
  }, [sections])
  return <div className="qb-measure">
    {hasTraced && <>
      <div ref={mapDiv} className="qb-map" aria-label="Satellite map of your property with the measured lawn outlined" />
      <p className="qb-fine">Satellite imagery © {MAPBOX_TOKEN ? 'Mapbox, Maxar' : 'Esri'}. Use + and − to zoom, or the full-screen button to look closer.</p>
    </>}
    <ul className="qb-areas">
      {sections.map((s, i) => <li key={i}><span>{s.name || `Area ${i + 1}`}</span><b>{s.sqFt.toLocaleString('en-US')} sq ft</b></li>)}
    </ul>
    <p className="qb-fine">We trace only the grass we mow. Beds, driveways and the house are left out. If something looks off, reply to our email or call and we’ll re-check it.</p>
  </div>
}


export default function QuoteBooking({ token, firstName, address, offer, sections, email: savedEmail, notice, closed, historicalTotal }: {
  token: string; firstName: string | null; address: string; offer?: PublicOffer; sections: Section[]
  email: string; notice?: React.ReactNode; closed?: boolean; historicalTotal?: number | null
}) {
  const [start, setStart] = useState<Start>('asap')
  const [date, setDate] = useState('')
  const [timeOfDay, setTimeOfDay] = useState('Any time')
  const [notes, setNotes] = useState('')
  const [showMeasure, setShowMeasure] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState(savedEmail)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    startTransition(async () => {
      const result = await bookQuote({ token, freq: offer?.rows.length === 1 ? offer.rows[0].freq : undefined, start, date, timeOfDay, notes, email })
        .catch(() => ({ error: 'Something went wrong. Please try again or call us.' }))
      if ('error' in result) setError(result.error)
      else setDone(true)
    })
  }

  if (done) return <main className="qb-page"><div className="qb-wrap qb-done">
    <div className="qb-check" aria-hidden="true">✓</div>
    <h1>Request received</h1>
    <p className="qb-sub">We’ll get in touch to confirm your first visit{start === 'date' && date ? `. You requested ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}` : ''}.</p>
  </div></main>

  return <main className="qb-page"><div className="qb-wrap">
    <p className="qb-brand">QuietGreen</p>
    <h1>{offer ? (firstName ? `${firstName}, here’s your quote` : 'Your quote') : 'Your visit request'}</h1>
    {notice}
    {offer?.message && <p className="qb-sub qb-message">{offer.message}</p>}

    <section className="qb-card">
      <h2>Your property</h2>
      <div className="qb-row"><span>Address</span><b>{address}</b></div>
      {!!offer?.sqFt && <div className="qb-row"><span>Lawn measured</span><b>{offer.sqFt.toLocaleString('en-US')} sq ft</b></div>}
      {sections.length > 0 && <button type="button" className="qb-link" aria-expanded={showMeasure} onClick={() => setShowMeasure(v => !v)}>
        {showMeasure ? 'Hide map' : 'See how we measured your lawn ›'}</button>}
      {showMeasure && sections.length > 0 && <MeasurementView sections={sections} />}
    </section>

    {offer && <section className="qb-card">
      <h2>{offer.rows.length > 1 ? 'Your original quoted services' : 'Your quoted service'}</h2>
      {offer.rows.length > 1 && <p className="qb-sub">We’ll review these terms with you before confirming the first visit.</p>}
      {offer.rows.map(row => <div key={row.freq} className="qb-terms">
        <div className="qb-row">
          <b>{offer.mowing ? row.freq === 'onetime' ? 'One-time mowing' : `${row.label} mowing`
            : row.freq === 'onetime' ? row.label : `${row.label} · ${row.detail}`}</b>
          {row.firstVisitCents === null && <b>{emailMoney(row.perVisitCents)}{row.freq !== 'onetime' ? ' / visit' : ''}</b>}
        </div>
        {row.when && <p className="qb-sub">{row.when}</p>}
        {row.regularItems.map((item, index) => <div className="qb-row" key={index}><span>{item.description}</span><span>{emailMoney(Math.round(Number(item.amount) * 100))}</span></div>)}
        {row.firstVisitCents !== null && <>
          <div className="qb-row"><span>Standard price</span><span>{emailMoney(row.perVisitCents)}{row.freq !== 'onetime' ? ' / visit' : ''}</span></div>
          <div className="qb-row"><b>Introductory visit</b><b>{emailMoney(row.firstVisitCents)}</b></div>
        </>}

      </div>)}
    </section>}
    {historicalTotal != null && <section className="qb-card"><h2>Previously accepted quote</h2>
      <div className="qb-row"><span>Saved total</span><b>{emailMoney(historicalTotal)}</b></div>
    </section>}

    {!closed && <form id="quote-request" onSubmit={submit}>
      <section className="qb-card">
        <h2>When would you like us to come?</h2>
        <div className="qb-chips">
          {([['asap', 'As soon as possible'], ['date', 'Pick a date'], ['unsure', 'Not sure yet']] as [Start, string][]).map(([value, label]) =>
            <button key={value} type="button" className="qb-chip" aria-pressed={start === value} onClick={() => setStart(value)}>{label}</button>)}
        </div>
        {start === 'date' && <label className="qb-field">Preferred first visit<input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} required /></label>}
        <label className="qb-field">Time of day<select value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)}><option>Any time</option><option>Morning</option><option>Afternoon</option></select></label>
        <label className="qb-field">Email for follow-up<input type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label className="qb-field">Anything we should know?<textarea rows={2} maxLength={1500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></label>
      </section>
      {error && <p className="qb-error" role="alert">{error}</p>}
      <button type="submit" className="qb-btn" disabled={pending}>{pending ? 'Saving request…' : 'Request first visit'}</button>
      <p className="qb-fine qb-center">We’ll confirm the date with you. No payment is due now.</p>
    </form>}
  </div></main>
}
