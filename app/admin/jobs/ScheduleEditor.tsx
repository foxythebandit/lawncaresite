'use client'

import Link from 'next/link'
import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addDays } from '@/lib/calendar-view'
import { formatMoney, type JobLine } from '@/lib/crm-jobs'
import {
  cadenceLabel, dayOfWeek, ORDINALS, serviceDate, WEEKDAYS, type Cadence, type ScheduleDefinition,
  type SchedulePeriod, type ServiceEditorSource, type ServiceLabel, type ServicePreview,
} from '@/lib/service-schedules'
import { uuid } from '@/lib/uuid'
import type { Json, Tables } from '@/supabase/database.types'
import { reviewService } from './schedule-actions'
import ServiceLabelPicker from './ServiceLabelPicker'
import ServiceImpactPreview from './ServiceImpactPreview'
import JobLineFields from './JobLineFields'

type Mode = 'future' | 'range' | 'pause' | 'end' | 'resume'
type Period = SchedulePeriod & { id: string }
type Property = Pick<Tables<'properties'>, 'id' | 'address'>
type Plan = Pick<Tables<'recurring_agreements'>, 'id' | 'status' | 'updated_at' | 'price_per_visit' | 'end_on'
  | 'service_label_id' | 'anchor_on' | 'interval_unit' | 'interval_count' | 'schedule_review_reason' | 'property_id' | 'items_template'>
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WINDOWS = ['Morning', 'Afternoon', 'Any time']
const pad = (n: number) => String(n).padStart(2, '0')
const monthDays = (month: number) => new Date(Date.UTC(2001, month, 0)).getUTCDate()
const monday = '2027-01-04'

function annualEnd(display: string) {
  const [month, day] = display.split('-')
  return day === 'last' ? `${pad(Number(month) % 12 + 1)}-01` : addDays(`2001-${display}`, 1).slice(5)
}

function annualThrough(end: string) {
  if (end.endsWith('-01')) return `${pad((Number(end.slice(0, 2)) + 10) % 12 + 1)}-last`
  return addDays(`2001-${end}`, -1).slice(5)
}

function MonthDay({ label, value, onChange, last = false }: {
  label: string; value: string; onChange: (value: string) => void; last?: boolean
}) {
  const [month, day] = value.split('-')
  const max = monthDays(Number(month)) - (last ? 1 : 0)
  return <div className="crm-field"><span>{label}</span>
    <div className="service-month-day">
      <select aria-label={`${label} month`} value={month} onChange={event => {
        const next = event.target.value
        onChange(`${next}-${day === 'last' ? day : pad(Math.min(Number(day), monthDays(Number(next)) - (last ? 1 : 0)))}`)
      }}>{MONTHS.map((name, i) => <option key={name} value={pad(i + 1)}>{name}</option>)}</select>
      <select aria-label={`${label} day`} value={day} onChange={event => onChange(`${month}-${event.target.value}`)}>
        {Array.from({ length: max }, (_, i) => <option value={pad(i + 1)} key={i}>{i + 1}</option>)}
        {last && <option value="last">Last day</option>}
      </select>
    </div>
  </div>
}

function RuleFields({ value, onChange, anchor, annual = false, fixedAnchor = false }: {
  value: Cadence; onChange: (rule: Cadence) => void; anchor: string; annual?: boolean; fixedAnchor?: boolean
}) {
  const current = value.frequency === 'paused' ? annual ? monday : anchor : value.anchor_on
  function frequency(next: string) {
    if (next === 'paused') onChange({ frequency: 'paused' })
    if (next === 'weekly' || next === 'biweekly') onChange({ frequency: next, anchor_on: annual ? monday : current })
    if (next === 'monthly') onChange({ frequency: 'monthly', anchor_on: current, pattern: 'day', day: Number(current.slice(8)) || 1 })
  }
  return <div className="service-editor-fields">
    <label className="crm-field">Cadence
      <select aria-label="Cadence" value={value.frequency} onChange={event => frequency(event.target.value)}>
        {value.frequency === 'legacy' && <option value="legacy">Keep saved cadence</option>}
        <option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option>
        <option value="monthly">Monthly</option><option value="paused">No regular visits</option>
      </select>
    </label>
    {(value.frequency === 'weekly' || value.frequency === 'biweekly') && annual && <label className="crm-field">Day of week
      <select value={dayOfWeek(value.anchor_on)} onChange={event => onChange({ ...value, anchor_on: addDays(monday, Number(event.target.value) - 1) })}>
        {WEEKDAYS.map((name, i) => <option value={i + 1} key={name}>{name}</option>)}
      </select>
    </label>}
    {value.frequency !== 'paused' && value.frequency !== 'legacy' && !annual && !fixedAnchor && <label className="crm-field">Repeat dates start from
      <input type="date" value={value.anchor_on} required onChange={event => onChange({ ...value, anchor_on: event.target.value })} />
    </label>}
    {value.frequency === 'monthly' && <>
      <label className="crm-field">Monthly pattern
        <select value={value.pattern} onChange={event => {
          const common = { frequency: 'monthly' as const, anchor_on: value.anchor_on }
          if (event.target.value === 'last_day') onChange({ ...common, pattern: 'last_day' })
          else if (event.target.value === 'ordinal') onChange({ ...common, pattern: 'ordinal', ordinal: 1, weekday: dayOfWeek(current) })
          else onChange({ ...common, pattern: 'day', day: Number(current.slice(8)) || 1 })
        }}><option value="day">Day of month</option><option value="last_day">Last day of month</option><option value="ordinal">Weekday of month</option></select>
      </label>
      {value.pattern === 'day' && <label className="crm-field">Day of month
        <input type="number" min="1" max="31" step="1" required value={Number.isNaN(value.day) ? '' : value.day}
          onChange={event => onChange({ ...value, day: event.target.valueAsNumber })} />
      </label>}
      {value.pattern === 'ordinal' && <>
        <label className="crm-field">Which week<select value={value.ordinal} onChange={event => onChange({ ...value, ordinal: Number(event.target.value) })}>
          {ORDINALS.map((name, i) => <option value={i + 1} key={name}>{name}</option>)}<option value={-1}>Last</option>
        </select></label>
        <label className="crm-field">Day of week<select value={value.weekday} onChange={event => onChange({ ...value, weekday: Number(event.target.value) })}>
          {WEEKDAYS.map((name, i) => <option value={i + 1} key={name}>{name}</option>)}
        </select></label>
      </>}
    </>}
  </div>
}

function PeriodFields({ period, index, annual, onChange, onRemove }: {
  period: Period; index: number; annual: boolean; onChange: (period: Period) => void; onRemove: () => void
}) {
  const updateStart = (start: string) => onChange({ ...period, start,
    rule: !annual && period.rule.frequency !== 'paused' && period.rule.anchor_on === period.start
      ? { ...period.rule, anchor_on: start } : period.rule })
  return <fieldset className="service-editor-subsection">
    <legend>{annual ? 'Annual period' : 'One-time period'} {index + 1}</legend>
    <div className="service-editor-fields">
      {annual ? <>
        <MonthDay label="From" value={period.start} onChange={updateStart} />
        <MonthDay label="Through" value={annualThrough(period.end)} last onChange={value => onChange({ ...period, end: annualEnd(value) })} />
      </> : <>
        <label className="crm-field">From<input type="date" required value={period.start} onChange={event => updateStart(event.target.value)} /></label>
        <label className="crm-field">Through<input type="date" required min={period.start}
          value={period.end ? addDays(period.end, -1) : ''}
          onChange={event => onChange({ ...period, end: event.target.value ? addDays(event.target.value, 1) : '' })} /></label>
      </>}
    </div>
    <RuleFields value={period.rule} annual={annual} fixedAnchor={!annual} anchor={period.start}
      onChange={rule => onChange({ ...period, rule })} />
    <button type="button" className="crm-button crm-button-sm" onClick={onRemove}>Remove {annual ? 'annual' : 'one-time'} period</button>
  </fieldset>
}

export default function ScheduleEditor({ customerId, properties, labels, sources, initialSource, plan, definition,
  initialArrival, today, from, extra, back, backLabel, itemsFromVisit }: {
  customerId: string; properties: Property[]; labels: ServiceLabel[]; sources: ServiceEditorSource[]
  initialSource?: string; plan: Plan | null; definition: ScheduleDefinition | null; initialArrival: string | null
  today: string; from: string; extra: boolean; back: string; backLabel: string; itemsFromVisit: JobLine[]
}) {
  const router = useRouter()
  const selectedSource = sources.find(visit => visit.id === initialSource)
  const [sourceId, setSourceId] = useState(selectedSource?.id ?? '')
  const [propertyId, setPropertyId] = useState(selectedSource?.propertyId ?? plan?.property_id ?? properties[0]?.id ?? '')
  const [address, setAddress] = useState('')
  const sourceLabel = (visit?: ServiceEditorSource) => labels.find(label => label.id === visit?.labelId && !label.retired_at)?.id
  const [labelId, setLabelId] = useState(sourceLabel(selectedSource) ?? plan?.service_label_id ?? '')
  const [price, setPrice] = useState((plan?.price_per_visit ?? selectedSource?.price)?.toFixed(2) ?? '')
  const [arrival, setArrival] = useState(initialArrival ?? selectedSource?.arrival ?? 'Any time')
  const [first, setFirst] = useState(selectedSource?.date ?? today)
  const [effective, setEffective] = useState(from)
  const [through, setThrough] = useState(addDays(from, 27))
  const [end, setEnd] = useState(plan?.end_on ?? '')
  const [mode, setMode] = useState<Mode>(plan && (plan.status === 'paused' || plan.schedule_review_reason) ? 'resume' : 'future')
  const [repeat, setRepeat] = useState(!extra)
  const [base, setBase] = useState<Cadence>(definition?.base ?? (plan ? {
    frequency: 'legacy', anchor_on: plan.anchor_on, unit: plan.interval_unit === 'month' ? 'month' : 'week', count: plan.interval_count,
  } : { frequency: 'weekly', anchor_on: selectedSource?.date ?? today }))
  const [range, setRange] = useState<Cadence>({ frequency: 'paused' })
  const [annual, setAnnual] = useState<Period[]>(() => (definition?.annual ?? []).map((period, i) => ({ ...period, id: `annual-${i}` })))
  const [temporary, setTemporary] = useState<Period[]>(() => (definition?.temporary ?? []).map((period, i) => ({ ...period, id: `once-${i}` })))
  const [keep, setKeep] = useState(false)
  const [notes, setNotes] = useState('')
  const [itemized, setItemized] = useState(false)
  const [priceItems, setPriceItems] = useState<JobLine[]>(() => Array.isArray(plan?.items_template)
    ? (plan.items_template as JobLine[]).map(item => ({ ...item, amount: String(item.amount) })) : [])
  function changePriceItems(items: JobLine[]) {
    setPriceItems(items)
    setItemized(true)
    invalidate()
  }
  const [reviewed, setReviewed] = useState<{ request: Json; preview: ServicePreview; op: string; rules: Cadence[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, startTransition] = useTransition()
  const edit = Boolean(plan && !extra)
  const futureFields = edit ? mode === 'future' : repeat
  const source = sources.find(visit => visit.id === sourceId)
  const useExact = !WINDOWS.includes(arrival) && /^\d{2}:\d{2}$/.test(arrival)
  const [arrivalChoice, setArrivalChoice] = useState(WINDOWS.includes(arrival) ? arrival : useExact ? 'exact' : 'saved')
  const [legacyArrival] = useState(WINDOWS.includes(arrival) || useExact ? '' : arrival)

  function invalidate() { setReviewed(null); setError('') }
  function chooseSource(id: string) {
    setSourceId(id)
    const visit = sources.find(item => item.id === id)
    if (visit) {
      setFirst(visit.date)
      setLabelId(sourceLabel(visit) ?? '')
      setPrice(visit.price.toFixed(2))
    }
    invalidate()
  }
  function newPeriod(isAnnual: boolean) {
    if (isAnnual) setAnnual([...annual, { id: uuid(), start: '03-01', end: '06-01', rule: { frequency: 'biweekly', anchor_on: monday } }])
    else setTemporary([...temporary, { id: uuid(), start: effective, end: addDays(effective, 28), rule: { frequency: 'paused' } }])
    invalidate()
  }
  function moveAnchor(on: string) {
    setEffective(on)
    if (range.frequency !== 'paused') setRange({ ...range, anchor_on: on })
  }
  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const selectedBase = !edit && base.frequency !== 'paused' ? { ...base, anchor_on: first } : base
    const periods = (values: Period[]) => values.map(({ start, end, rule }) => ({ start, end, rule }))
    const rules = { version: 1, base: selectedBase, annual: periods(annual), temporary: periods(temporary),
      excluded_on: definition?.excluded_on ?? [] }
    const request: Json = edit ? {
      mode, from: mode === 'pause' || mode === 'end' ? today : effective,
      ...(mode === 'range' ? { through, rule: range } : {}),
      ...(mode === 'future' ? { definition: rules, label_id: labelId || null, end_on: end || null, arrival,
        ...(itemized ? { items_template: priceItems.map(item => ({
          ...item, description: item.description.trim(),
          amount: (item.kind === 'discount' ? '-' : '') + item.amount.replace(/^-/, ''),
        })) } : { price: Number(price) === Number(plan?.price_per_visit) ? null : price }),
      } : {}),
      ...(mode === 'range' || mode === 'future' ? { keep_unmatched: keep } : {}),
    } : {
      label_id: labelId, property_id: propertyId || null, address: propertyId ? null : address,
      source_id: source?.id ?? null, source_version: source?.version ?? null,
      related_agreement_id: extra ? plan?.id : null, first_on: first, end_on: repeat ? end || null : null,
      definition: repeat ? rules : null, arrival, price, notes,
    }
    const target = edit && plan ? { agreementId: plan.id, version: plan.updated_at } : { customerId }
    startTransition(async () => {
      try {
        const result = await reviewService(target, request)
        if (!result.ok) { setError(result.error); return }
        if (result.review) {
          setReviewed({ request, preview: result.review, op: uuid(), rules: mode === 'range' ? [range]
            : futureFields ? [selectedBase, ...annual.map(p => p.rule), ...temporary.map(p => p.rule)] : [] })
          requestAnimationFrame(() => document.getElementById('service-preview-heading')?.focus())
        }
      } catch { setError('Could not load a preview. Try again.') }
    })
  }
  function commit() {
    if (!reviewed) return
    const target = edit && plan ? { agreementId: plan.id, version: plan.updated_at } : { customerId }
    startTransition(async () => {
      try {
        const result = await reviewService(target, reviewed.request, { operationId: reviewed.op, preview: reviewed.preview.preview })
        if (!result.ok) { setError(result.error); setReviewed(null); return }
        router.push(result.bookingId && !result.agreementId ? `/admin/jobs/${result.bookingId}` :
          `/admin/customers/${customerId}${result.agreementId ? `#schedule-${result.agreementId}` : ''}`)
        router.refresh()
      } catch { setError('The save did not finish. Retry to check the same request.') }
    })
  }

  return <form className="service-editor-form" onSubmit={preview} onChange={invalidate}>
    <fieldset disabled={busy} className="service-editor-main">
      {edit ? <label className="crm-field">Change
        <select value={mode} onChange={event => setMode(event.target.value as Mode)}>
          {plan?.status === 'active' && !plan.schedule_review_reason && <>
            <option value="future">This and future visits</option><option value="range">Date range</option><option value="pause">Pause schedule</option>
          </>}
          {(plan?.status === 'paused' || plan?.schedule_review_reason) && <option value="resume">{plan.schedule_review_reason ? 'Restart schedule' : 'Resume schedule'}</option>}
          <option value="end">End schedule</option>
        </select>
      </label> : <>
        {!extra && !initialSource && <div className="service-editor-fields">
          <label className="crm-field">Property<select value={propertyId} onChange={event => { setPropertyId(event.target.value); chooseSource('') }}>
            {properties.map(property => <option key={property.id} value={property.id}>{property.address}</option>)}<option value="">New address…</option>
          </select></label>
          {!propertyId && <label className="crm-field">Address<input value={address} required maxLength={500} onChange={event => setAddress(event.target.value)} /></label>}
          {repeat && sources.some(item => item.propertyId === propertyId) && <label className="crm-field">First visit
            <select value={sourceId} onChange={event => chooseSource(event.target.value)}>
              <option value="">Book a new visit</option>
              {sources.filter(item => item.propertyId === propertyId).map(item => <option key={item.id} value={item.id}>
                {item.service} · {serviceDate(item.date)} · {formatMoney(item.price)}
              </option>)}
            </select>
          </label>}
        </div>}
        {initialSource && source && <p><strong>First visit</strong> {source.service} · {serviceDate(source.date)} · {formatMoney(source.price)}</p>}
        {!extra && !initialSource && <label className="crm-field">Visit pattern<select value={repeat ? 'repeat' : 'once'}
          onChange={event => { setRepeat(event.target.value === 'repeat'); if (event.target.value === 'once') chooseSource('') }}>
          <option value="repeat">Repeating schedule</option><option value="once">One visit</option>
        </select></label>}
      </>}
      {(edit ? mode === 'future' : true) && <>
        <ServiceLabelPicker labels={labels} value={labelId} onChange={id => { setLabelId(id); invalidate() }}
          locked={extra || Boolean(sourceLabel(source))} required={!edit} />
        <div className="service-editor-fields">
          {!(edit && itemized) && <label className="crm-field">{futureFields ? 'Agreed price per visit ($)' : 'Agreed visit price ($)'}
            <input value={price} inputMode="decimal" required pattern="[0-9]+(\.[0-9]{1,2})?" maxLength={13} onChange={event => setPrice(event.target.value)} />
          </label>}
          {!edit && <label className="crm-field">Visit date<input type="date" value={first} required min={source ? undefined : today}
            readOnly={Boolean(source)} onChange={event => setFirst(event.target.value)} /></label>}
          <label className="crm-field">Arrival<select value={arrivalChoice} onChange={event => {
            setArrivalChoice(event.target.value)
            setArrival(event.target.value === 'exact' ? '09:00' : event.target.value === 'saved' ? legacyArrival : event.target.value)
          }}>
            {WINDOWS.map(window => <option key={window}>{window}</option>)}<option value="exact">Exact time</option>
            {legacyArrival && <option value="saved">{legacyArrival} (saved)</option>}
          </select></label>
          {arrivalChoice === 'exact' && <label className="crm-field">Exact arrival in Austin<input type="time" value={arrival} required
            onChange={event => setArrival(event.target.value)} /></label>}
        </div>
        {edit && <div className="service-editor-subsection">
          <label className="crm-check"><input type="checkbox" checked={itemized} onChange={event => {
            if (event.target.checked && priceItems.length === 0) changePriceItems([{ kind: 'service', description: 'Service', amount: price }])
            else setItemized(event.target.checked)
          }} />Edit future price items</label>
          {itemized && <JobLineFields lines={priceItems} setLines={changePriceItems} />}
          {itemsFromVisit.length > 0 && <button type="button" className="crm-button crm-button-sm"
            onClick={() => changePriceItems(itemsFromVisit)}>Copy saved items from this visit</button>}
        </div>}
        {!edit && !source && <label className="crm-field">Visit note (optional)<textarea value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} /></label>}
      </>}
      {edit && ['future', 'range', 'resume'].includes(mode) && <div className="service-editor-fields">
        <label className="crm-field">{mode === 'resume' ? 'Resume on or after' : 'Apply from'}<input type="date" required min={today} value={effective} onChange={event => moveAnchor(event.target.value)} /></label>
        {mode === 'range' && <label className="crm-field">Through<input type="date" required min={effective} value={through} onChange={event => setThrough(event.target.value)} /></label>}
      </div>}
      {futureFields && <>
        <label className="crm-field">End date (optional)<input type="date" min={edit ? effective : first} value={end} onChange={event => setEnd(event.target.value)} /></label>
        <section className="service-editor-subsection">
          <h2>Regular dates</h2>
          <RuleFields value={base} onChange={setBase} anchor={edit ? effective : first} fixedAnchor={!edit} />
          {base.frequency === 'legacy' && <p className="crm-muted">{cadenceLabel(base)} · Saved dates stay in effect until you choose a new cadence.</p>}
        </section>
        {annual.map((item, i) => <PeriodFields key={item.id} period={item} index={i} annual
          onChange={period => setAnnual(annual.map(p => p.id === period.id ? period : p))}
          onRemove={() => { setAnnual(annual.filter(p => p.id !== item.id)); invalidate() }} />)}
        {temporary.map((item, i) => <PeriodFields key={item.id} period={item} index={i} annual={false}
          onChange={period => setTemporary(temporary.map(p => p.id === period.id ? period : p))}
          onRemove={() => { setTemporary(temporary.filter(p => p.id !== item.id)); invalidate() }} />)}
        <div className="work-visit-actions">
          <button type="button" className="crm-button" onClick={() => newPeriod(true)}>Add annual period</button>
          <button type="button" className="crm-button" onClick={() => newPeriod(false)}>Add one-time period</button>
        </div>
        {(annual.length > 0 || temporary.length > 0) && <p className="crm-muted">Annual periods repeat each year. One-time periods take precedence only on their dates.</p>}
      </>}
      {edit && mode === 'range' && <>
        <RuleFields value={range} onChange={rule => setRange(rule.frequency === 'paused' ? rule : { ...rule, anchor_on: effective })}
          anchor={effective} fixedAnchor />
        <p className="crm-muted">The usual schedule returns after this range. Individually moved visits keep their chosen dates.</p>
      </>}
      {edit && (mode === 'future' || mode === 'range') && <label className="crm-check">
        <input type="checkbox" checked={keep} onChange={event => setKeep(event.target.checked)} />
        Keep edited visits as individual visits when their regular dates are removed
      </label>}
      {edit && mode === 'pause' && <p>Pause upcoming visits until you choose a resume date.</p>}
      {edit && mode === 'end' && <p>End this service and cancel its upcoming visits. Saved history stays available.</p>}
      {edit && mode === 'resume' && <p>Review which dates return. Individually skipped and canceled visits stay in history.</p>}
    </fieldset>
    {reviewed && <ServiceImpactPreview preview={reviewed.preview} rules={reviewed.rules} />}
    {error && <p className="work-visit-error" role="alert">{error}</p>}
    <div className="work-visit-actions">
      {reviewed ? <button type="button" className="crm-button crm-button-primary" onClick={commit} disabled={busy || reviewed.preview.conflicts.length > 0}>Save reviewed change</button>
        : <button type="submit" className="crm-button crm-button-primary" disabled={busy}>{busy ? 'Loading preview…' : 'Preview changes'}</button>}
      <Link href={back} className="crm-button">{backLabel}</Link>
    </div>
  </form>
}
