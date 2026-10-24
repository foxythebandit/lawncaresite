'use client'

import { useMemo, useState, useTransition } from 'react'
import type { OfferFrequency, QuoteOffer } from '@/lib/quote-offer'
import { bookQuote } from './actions'

type Section = { name: string; sqFt: number; coords: [number, number][] | null }
type Start = 'asap' | 'date' | 'unsure'

const EVERY: Partial<Record<OfferFrequency, string>> = { weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month' }
const money = (value: number) => `$${Number.isInteger(value) ? value : value.toFixed(2)}`

/* Satellite photo with the traced areas outlined, using the same Esri imagery as the quote map. */
function MeasurementView({ sections }: { sections: Section[] }) {
  const traced = sections.filter(s => s.coords && s.coords.length >= 3)
  const view = useMemo(() => {
    if (!traced.length) return null
    const R = 6378137
    const project = ([lng, lat]: [number, number]) => [R * lng * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))]
    const points = traced.map(s => s.coords!.map(project))
    const xs = points.flat().map(p => p[0]), ys = points.flat().map(p => p[1])
    const width = 800, height = 560
    let [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const padX = Math.max((maxX - minX) * 0.35, 12), padY = Math.max((maxY - minY) * 0.35, 12)
    minX -= padX; maxX += padX; minY -= padY; maxY += padY
    // Match the image's aspect ratio so the outline lines up with the photo.
    const scale = Math.max((maxX - minX) / width, (maxY - minY) / height)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    minX = cx - scale * width / 2; maxX = cx + scale * width / 2; minY = cy - scale * height / 2; maxY = cy + scale * height / 2
    const image = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${minX},${minY},${maxX},${maxY}&bboxSR=3857&imageSR=3857&size=${width},${height}&format=jpg&f=image`
    const shapes = points.map(poly => poly.map(([x, y]) => `${((x - minX) / scale).toFixed(1)},${((maxY - y) / scale).toFixed(1)}`).join(' '))
    return { image, shapes, width, height }
  }, [traced])
  return <div className="qb-measure">
    {view && <div className="qb-photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={view.image} alt="Satellite photo of your property with the measured lawn outlined" width={view.width} height={view.height} />
      <svg viewBox={`0 0 ${view.width} ${view.height}`} aria-hidden="true">
        {view.shapes.map((points, i) => <polygon key={i} points={points} />)}
      </svg>
    </div>}
    <ul className="qb-areas">
      {sections.map((s, i) => <li key={i}><span>{s.name || `Area ${i + 1}`}</span><b>{s.sqFt.toLocaleString('en-US')} sq ft</b></li>)}
    </ul>
    <p className="qb-fine">We trace the grass we mow from satellite imagery. Beds, driveways and the house are left out. If something looks off, reply to our email or call and we’ll re-check it.</p>
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
  const [showMeasure, setShowMeasure] = useState(false)
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
        {showMeasure ? 'Hide measurement' : 'See how we measured your lawn ›'}</button>}
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
