'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ESRI_IMAGERY, MAPBOX_TOKEN } from '@/lib/map-imagery'
import type { OfferFrequency, QuoteOffer } from '@/lib/quote-offer'
import { bookQuote } from './actions'

type Section = { name: string; sqFt: number; coords: [number, number][] | null }
type Start = 'asap' | 'date' | 'unsure'

const EVERY: Partial<Record<OfferFrequency, string>> = { weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month' }
const money = (value: number) => `$${Number.isInteger(value) ? value : value.toFixed(2)}`

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
        fitBoundsOptions: { padding: 48, maxZoom: 20 },
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
      <p className="qb-fine">Satellite imagery © {MAPBOX_TOKEN ? 'Mapbox, Maxar' : 'Esri'}. Use + / − or ⤢ for full screen to look closer.</p>
    </>}
    <ul className="qb-areas">
      {sections.map((s, i) => <li key={i}><span>{s.name || `Area ${i + 1}`}</span><b>{s.sqFt.toLocaleString('en-US')} sq ft</b></li>)}
    </ul>
    <p className="qb-fine">We trace only the grass we mow. Beds, driveways and the house are left out. If something looks off, reply to our email or call and we’ll re-check it.</p>
  </div>
}

export default function QuoteBooking({ token, firstName, address, services, offer, sections }: {
  token: string; firstName: string | null; address: string; services: string[]; offer: QuoteOffer; sections: Section[]
}) {
  const [freq, setFreq] = useState<OfferFrequency>(offer.quoted)
  const [start, setStart] = useState<Start>('asap')
  const [date, setDate] = useState('')
  const [timeOfDay, setTimeOfDay] = useState('Any time')
  const [notes, setNotes] = useState('')
  const [showMeasure, setShowMeasure] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  const [submissionId] = useState(() => `qb-${crypto.randomUUID()}`)
  const option = offer.options.find(o => o.freq === freq) ?? offer.options[0]
  const today = new Date().toLocaleDateString('en-CA')
  const jobName = offer.recurring ? (freq === 'onetime' ? 'one-time mowing' : `${option.label.toLowerCase()} mowing`) : 'this job'

  function submit() {
    setError('')
    if (start === 'date' && !date) { setError('Pick a start date, or choose another option.'); return }
    startTransition(async () => {
      const result = await bookQuote({ token, submissionId, freq, start, date, timeOfDay, notes }).catch(() => ({ error: 'Something went wrong. Please try again or call us.' }))
      if ('error' in result) setError(result.error)
      else setDone(true)
    })
  }

  if (done) return <main className="qb-page"><div className="qb-wrap qb-done">
    <div className="qb-check" aria-hidden="true">✓</div>
    <h1>You’re booked in!</h1>
    <p className="qb-sub">{jobName[0].toUpperCase() + jobName.slice(1)}{start === 'date' && date ? `, starting ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}` : start === 'asap' ? ', as soon as we can' : ''}. We’ll call you to confirm your first visit.</p>
  </div></main>

  return <main className="qb-page"><div className="qb-wrap">
    <p className="qb-brand">QuietGreen</p>
    <h1>{firstName ? `${firstName}, here’s your quote` : 'Your quote'}</h1>
    <p className="qb-sub">Double-check the details, choose how often, and pick a start. No payment now.</p>

    <section className="qb-card">
      <h2>Your property</h2>
      <div className="qb-row"><span>Address</span><b>{address}</b></div>
      {offer.sqFt > 0 && <div className="qb-row"><span>Lawn measured</span><b>{offer.sqFt.toLocaleString('en-US')} sq ft</b></div>}
      <div className="qb-row"><span>Service</span><b>{services.join(', ')}</b></div>
      {sections.length > 0 && <button type="button" className="qb-link" aria-expanded={showMeasure} onClick={() => setShowMeasure(v => !v)}>
        {showMeasure ? 'Hide map' : 'See how we measured your lawn ›'}</button>}
      {showMeasure && <MeasurementView sections={sections} />}
    </section>

    {offer.recurring ? <section className="qb-card">
      <h2>How often?</h2>
      {offer.options.map(o => <button key={o.freq} type="button" className="qb-opt" aria-pressed={freq === o.freq} onClick={() => setFreq(o.freq)}>
        <span><span className="qb-opt-l">{o.label}{o.freq === offer.quoted && <span className="qb-tag">Quoted</span>}</span><span className="qb-opt-d">{o.detail}</span></span>
        <span className="qb-opt-p">{money(o.price)}<small>{o.freq === 'onetime' ? 'one time' : 'per visit'}</small></span>
      </button>)}
    </section> : <section className="qb-card">
      <h2>Your price</h2>
      <div className="qb-row"><span>Quoted total</span><b>{money(option.price)}</b></div>
    </section>}

    <section className="qb-card">
      <h2>When should we start?</h2>
      <div className="qb-chips">
        {([['asap', 'As soon as possible'], ['date', 'Pick a date'], ['unsure', 'Not sure yet, call me']] as [Start, string][]).map(([value, label]) =>
          <button key={value} type="button" className="qb-chip" aria-pressed={start === value} onClick={() => setStart(value)}>{label}</button>)}
      </div>
      {start === 'date' && <label className="qb-field">Preferred first visit<input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} /></label>}
      <label className="qb-field">Time of day<select value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)}><option>Any time</option><option>Morning</option><option>Afternoon</option></select></label>
      <label className="qb-field">Anything we should know? (gate code, pets, areas to skip)<textarea rows={2} maxLength={1500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></label>
    </section>

    {option.firstVisit !== option.price
      ? <><div className="qb-total"><span>First visit (30% off)</span><b>{money(option.firstVisit)}</b></div>
        <div className="qb-row qb-then"><span>Then</span><b>{money(option.price)} {EVERY[freq]}</b></div></>
      : <div className="qb-total"><span>Total</span><b>{money(option.price)}</b></div>}
    {error && <p className="qb-error" role="alert">{error}</p>}
    <button type="button" className="qb-btn" disabled={pending} onClick={submit}>{pending ? 'Booking…' : `Book ${jobName}`}</button>
    <p className="qb-fine qb-center">You’re not charged now. We’ll call to confirm your first date. Change or cancel anytime.</p>
  </div></main>
}
