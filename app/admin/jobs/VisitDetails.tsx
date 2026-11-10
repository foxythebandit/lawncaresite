'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/supabase/database.types'
import { addVisitToPlan, changeJob, confirmFirstVisit, createPaymentLink, editProjectedVisit, linkJobIdentity, markComplete, recordManualPayment, reviewPlanMove, saveJobItems, scheduleJobAndEmail, updateContactDetails, updateNotes, type ProjectedVisitEdit } from '../actions'
import type { FirstVisitTerms } from '@/lib/crm-contracts'
import { frequencyLabel } from '@/lib/quote-offer'
import { formatPhone } from '@/lib/format-phone'
import { customerDisplayName } from '@/lib/lead-labels'
import { dateLabel, visitHref, visitStatus, visitTime } from '@/lib/calendar-view'
import { serviceEditorHref, type ServicePreview } from '@/lib/service-schedules'
import { formatMoney, jobPrice, type IntroCompletionReview, type JobLine } from '@/lib/crm-jobs'
import { formatAttributionLabel } from '@/lib/attribution'
import { bookingPrice } from '@/lib/lead-summary'
import { uuid } from '@/lib/uuid'
import type { Shape } from '../leads/TracingMap'
import Icon from '../icons'
import LawnMap from '../LawnMap'
import PriceSteps from '../PriceSteps'
import ReminderButtons from '../ReminderButtons'
import ServiceImpactPreview from './ServiceImpactPreview'
import JobLineFields from './JobLineFields'

type Agreement = Tables<'recurring_agreements'>
type Booking = Omit<Tables<'bookings'>, 'id'>
type Target = { bookingId: string; occurrence?: never } | { bookingId?: never; occurrence: { agreementId: string; revisionId: string; on: string } }
type Customer = Pick<Tables<'customers'>, 'id' | 'name' | 'phone'>
type Property = Pick<Tables<'properties'>, 'id' | 'customer_id' | 'address'>
type Payment = Pick<Tables<'job_payments'>, 'id' | 'amount' | 'paid_on' | 'method' | 'provenance'>
type Candidate = Pick<Agreement, 'id' | 'interval_count' | 'interval_unit' | 'price_per_visit' | 'next_on'> & { service_labels?: { name: string } | null }
type Result = { success: boolean; error?: string; data?: Record<string, unknown> }
const PANELS = {
  complete: 'Mark done',
  date: 'Visit date and arrival',
  note: 'Visit note',
  payment: 'Record payment',
  price: 'Visit items and price',
  schedule: 'Service schedule',
  link: 'Link customer and property',
  contact: 'Visit contact',
  more: 'More visit actions',
  details: 'Property and request details',
  reminder: 'Remind customer',
} as const
type Panel = keyof typeof PANELS

const dateText = (value: string) => dateLabel(value, { month: 'short', day: 'numeric', year: 'numeric' })
const cadence = (plan: Candidate) => `Every ${plan.interval_count === 1 ? '' : plan.interval_count + ' '}${plan.interval_unit}${plan.interval_count === 1 ? '' : 's'}`
const field = (data: FormData, name: string) => String(data.get(name) ?? '')

function addonDetails(addons: Record<string, unknown>) {
  return Object.entries(addons).map(([name, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return name
    const fields = raw as Record<string, unknown>
    const details = [
      typeof fields.sq_ft === 'number' ? `${fields.sq_ft.toLocaleString()} sq ft` : null,
      typeof fields.area === 'string' ? `area: ${fields.area}` : null,
      typeof fields.depth_in === 'number' ? `${fields.depth_in} in deep` : null,
      typeof fields.cu_yd === 'number' ? `${fields.cu_yd} cu yd` : null,
      typeof fields.severity === 'string' ? `${fields.severity} overgrowth` : null,
      typeof fields.price === 'number' ? `starting at ${formatMoney(fields.price)}` : null,
      Array.isArray(fields.hazards) ? `hazards: ${fields.hazards.join(', ')}` : null,
      fields.haul_away === true ? 'hauled away' : null,
    ].filter(Boolean)
    return details.length ? `${name} (${details.join(', ')})` : name
  }).join(' · ')
}

export default function VisitDetails({ bookingId, occurrence, booking, today, back, agreement, reviewReason, scheduleSummary, simpleShift, serviceLabel, customers, properties, candidates, items, payments,
  quotedVisit, mapUrl, shapes, emailConfigured, firstReview }: {
  booking: Booking; today: string; back: string; agreement: Agreement | null; reviewReason: string | null; scheduleSummary: string | null; simpleShift: boolean; serviceLabel?: string
  customers: Customer[]; properties: Property[]; candidates: Candidate[]; items: JobLine[]; payments: Payment[]
  firstReview?: { terms: FirstVisitTerms; leadVersion: string | null; customerId: string | null; propertyId: string | null; labels: { id: string; name: string; semantic_key: string | null }[] }
  quotedVisit: boolean; mapUrl: string | null; shapes: Shape[]; emailConfigured: boolean
} & Target) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [busy, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [savedHref, setSavedHref] = useState<string | null>(null)
  const operation = useRef<{ key: string; id: string } | null>(null)
  const versions = useRef({ visit: booking.updated_at, agreement: agreement?.updated_at })
  const trigger = useRef<HTMLElement | null>(null)
  const editorHeading = useRef<HTMLHeadingElement>(null)
  const pageHeading = useRef<HTMLHeadingElement>(null)
  const [selectedCustomer, setSelectedCustomer] = useState('new')
  const [selectedProperty, setSelectedProperty] = useState('new')
  const [lines, setLines] = useState(items)
  const [introReview, setIntroReview] = useState<IntroCompletionReview | null>(null)
  const [wholeMove, setWholeMove] = useState(false)
  const [movePreview, setMovePreview] = useState<{ key: string; preview: ServicePreview } | null>(null)
  const paymentLink = booking.payment_link
  const total = jobPrice(booking)
  const paid = payments.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100
  const paymentStatus = paid > 0 ? paid >= total ? 'Paid in full' : 'Partly paid' : booking.amount_charged != null ? 'Older payment record' : 'Unpaid'
  const name = customerDisplayName(booking)
  const pending = booking.status === 'pending'
  const confirmed = booking.status === 'confirmed'
  const current = pending || confirmed
  const linked = Boolean(booking.customer_id && booking.property_id)
  const visitDate = booking.confirmed_date ?? booking.preferred_date
  const status = visitStatus(booking.status, booking.confirmed_date, today)
  const needsSchedule = confirmed && !agreement && !booking.one_time && Boolean(booking.frequency?.trim()) && !/^(one[ -]?time|single|once)$/i.test(booking.frequency!.trim())
  const hasEmail = emailConfigured && Boolean(booking.email)
  const serviceItems = items.filter(item => item.kind === 'service')
  const serviceName = serviceLabel ?? (serviceItems.map(item => item.description).join(' + ') || 'Service visit')
  const firstVisit = quotedVisit || (!booking.agreement_id && !booking.occurrence_on)
  const origin = visitHref({ booking_id: bookingId ?? null, agreement_id: occurrence?.agreementId ?? null,
    revision_id: occurrence?.revisionId ?? null, cadence_on: occurrence?.on ?? null }, back)
  const awaitingFirst = agreement?.status === 'active' && !agreement.generation_starts_on && !agreement.schedule_review_reason
  const scheduleEditor = booking.customer_id && agreement && !awaitingFirst ? serviceEditorHref(booking.customer_id, {
    schedule: agreement.id, from: booking.occurrence_on ?? visitDate ?? undefined, origin,
  }) : null
  const addExtra = booking.customer_id && agreement?.service_label_id && agreement.status !== 'ended'
    ? serviceEditorHref(booking.customer_id, { schedule: agreement.id, extra: true, origin }) : null
  const startSchedule = booking.customer_id && linked && bookingId && !agreement && (confirmed || booking.status === 'completed')
    ? serviceEditorHref(booking.customer_id, { visit: bookingId, origin }) : null
  const phoneDigits = booking.phone.replace(/\D/g, '').slice(-10)
  const samePhone = phoneDigits.length === 10
    ? customers.filter(c => c.phone?.replace(/\D/g, '').slice(-10) === phoneDigits) : []

  useEffect(() => { if (panel) editorHeading.current?.focus() }, [panel])

  function open(next: Panel, opener?: HTMLElement) {
    if (opener) trigger.current = opener
    versions.current = { visit: booking.updated_at, agreement: agreement?.updated_at }
    setError('')
    setMessage('')
    if (next === 'complete') setIntroReview(null)
    if (next === 'date') {
      setWholeMove(false)
      setMovePreview(null)
      setSelectedCustomer(firstReview?.customerId ?? (samePhone.length ? '' : 'new'))
      setSelectedProperty(firstReview?.propertyId ?? 'new')
    }
    if (next === 'price') setLines(items.length ? items : [{ kind: 'service', description: 'Service', amount: total.toFixed(2) }])
    if (next === 'link') { setSelectedCustomer('new'); setSelectedProperty('new') }
    setPanel(next)
  }

  function close() {
    setPanel(null)
    setError('')
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus()
      else pageHeading.current?.focus()
    })
  }

  function run(key: string, action: (id: string) => Promise<Result>, success: string) {
    if (busy) return
    if (!operation.current || operation.current.key !== key) operation.current = { key, id: uuid() }
    const id = operation.current.id
    setError('')
    setMessage('')
    startTransition(async () => {
      try {
        const result = await action(id)
        if (!result.success) {
          setError(result.error ?? 'Could not save this visit.')
          setIntroReview(panel === 'complete' ? result.data?.introReview as IntroCompletionReview | undefined ?? null : null)
          return
        }
        operation.current = null
        close()
        const warning = typeof result.data?.warning === 'string' ? result.data.warning : null
        setMessage(warning ?? success)
        if (occurrence) {
          const id = result.data?.booking_id
          const href = typeof id === 'string' ? `/admin/jobs/${id}?returnTo=${encodeURIComponent(back)}` : back
          if (warning) setSavedHref(href)
          else router.replace(href)
        } else router.refresh()
      } catch {
        setError('The request did not finish. Retry the same action to check whether it saved.')
      }
    })
  }

  const command = (id: string, operationId: string) => ({ bookingId: id, expectedUpdatedAt: versions.current.visit, operationId })

  function runVisit(key: string, edit: ProjectedVisitEdit,
    saved: (id: string, operationId: string) => Promise<Result>, success: string) {
    run(key, operationId => occurrence ? editProjectedVisit({ ...occurrence, operationId, ...edit })
      : saved(bookingId, operationId), success)
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const action = submitter?.value ?? ''
    const key = JSON.stringify([panel, action, [...form], panel === 'price' ? lines : null])
    if (panel === 'date') {
      const date = field(form, 'date')
      const time = field(form, 'time').trim()
      const email = form.has('email')
      if (pending && bookingId && firstReview) {
        run(key, operationId => confirmFirstVisit({ ...command(bookingId, operationId), leadVersion: firstReview.leadVersion,
          date, time, email, customerId: selectedCustomer === 'new' ? null : selectedCustomer,
          propertyId: selectedProperty === 'new' ? null : selectedProperty, name: field(form, 'name'), address: field(form, 'address'),
          labelId: field(form, 'label') || null, frequency: firstReview.terms.locked ? firstReview.terms.frequency : field(form, 'frequency'),
          reviewedTerms: form.has('reviewed-terms') }), 'Visit confirmed.')
      } else if (wholeMove && agreement) {
        const request = { agreementId: agreement.id, date, time, email,
          ...(occurrence ? { revisionId: occurrence.revisionId, on: occurrence.on } : { bookingId, version: versions.current.visit }) }
        if (movePreview?.key === key) {
          const preview = movePreview.preview.preview
          run(key, operationId => reviewPlanMove({ ...request, operationId, preview }), 'Schedule updated.')
        } else {
          setError('')
          startTransition(async () => {
            try {
              const result = await reviewPlanMove(request)
              if (!result.success) { setError(result.error); return }
              setMovePreview({ key, preview: result.data as unknown as ServicePreview })
              requestAnimationFrame(() => document.getElementById('service-preview-heading')?.focus())
            } catch {
              setError('The request did not finish. Review the dates again.')
            }
          })
        }
      } else {
        runVisit(key, { action: 'reschedule', date, time, email }, (id, op) =>
          (email ? scheduleJobAndEmail : changeJob)({ ...command(id, op), action: 'reschedule', date, time }),
        'Visit rescheduled.')
      }
    } else if (panel === 'complete') {
      const date = field(form, 'date')
      const review = introReview?.token
      runVisit(key + (review ?? ''), { action: 'complete', date, introReview: review },
        (id, op) => markComplete(id, { expected_updated_at: versions.current.visit, operation_id: op, completed_at: date, introReview: review }),
        'Visit marked done.')
    } else if (panel === 'note') {
      const note = field(form, 'note')
      runVisit(key, { action: 'notes', note }, (id, op) => updateNotes({ ...command(id, op), note }), 'Visit note saved.')
    } else if (panel === 'payment') {
      const amount = field(form, 'amount'), date = field(form, 'date'), method = field(form, 'method')
      runVisit(key, { action: 'payment', amount, date, method }, (id, op) => recordManualPayment({ bookingId: id, operationId: op, amount, paidOn: date, method }), 'Payment recorded.')
    } else if (panel === 'price') {
      runVisit(key, { action: 'items', items: lines }, (id, op) => saveJobItems({ ...command(id, op), items: lines }), 'Visit price saved.')
    } else if (panel === 'contact') {
      const contact = { name: field(form, 'name'), phone: field(form, 'phone'), email: field(form, 'email') }
      runVisit(key, { action: 'contact', ...contact }, id => updateContactDetails(id, { expectedUpdatedAt: versions.current.visit, ...contact }), 'Visit contact saved.')
    } else if (panel === 'link' && bookingId) {
      run(key, op => linkJobIdentity({ ...command(bookingId, op),
        customerId: selectedCustomer === 'new' ? null : selectedCustomer,
        propertyId: selectedProperty === 'new' ? null : selectedProperty,
        customer: selectedCustomer === 'new' ? { name: field(form, 'name'), phone: booking.phone, email: booking.email ?? '' } : null,
        property: selectedProperty === 'new' ? { address: field(form, 'address') } : null,
      }), 'Customer and property linked.')
    } else if (panel === 'schedule' && action === 'join' && bookingId) {
      run(key, op => addVisitToPlan({ ...command(bookingId, op), agreementId: field(form, 'plan') }), 'Visit joined the service schedule.')
    }
  }

  const edit = (label: string, target: Panel, primary = false, icon?: 'check' | 'calendar' | 'note') =>
    <button type="button" className={`crm-button${primary && !panel ? ' crm-button-primary' : ''}`} disabled={busy}
      onClick={event => open(target, event.currentTarget)}>{icon && <Icon name={icon} size={16} />}{label}</button>

  const btn = (label: string, value?: string, primary = true) =>
    <button type="submit" value={value} className={`crm-button${primary ? ' crm-button-primary' : ''}`} disabled={busy}>{busy ? 'Saving…' : label}</button>

  if (savedHref) return <div className="crm-page work-visit-page">
    <Link href={back} className="crm-back"><Icon name="arrowLeft" size={16} />Back to calendar</Link>
    <div className="work-visit-card"><p role="status">{message}</p><Link className="crm-button" href={savedHref}>Open saved visit</Link></div>
  </div>

  return <div className="crm-page work-visit-page">
    <Link href={back} className="crm-back"><Icon name="arrowLeft" size={16} />Back to calendar</Link>
    <header className="work-visit-card work-visit-hero">
      <div className="work-visit-title">
        <div><p className="crm-eyebrow">{serviceName}</p><h1 ref={pageHeading} tabIndex={-1}>{name}</h1>
          {booking.address && booking.address !== name && <p>{booking.address}</p>}
          {booking.phone && <a href={`tel:${booking.phone}`}>{formatPhone(booking.phone)}</a>}
        </div>
        <span className="work-visit-status" data-status={status}>{status === 'Done' && <Icon name="check" size={14} />}{status}</span>
      </div>
      <dl className="work-visit-facts">
        <div><dt>{pending ? 'Preferred date' : 'Visit date'}</dt><dd>{visitDate ? dateText(visitDate) : 'Not set'}</dd></div>
        <div><dt>Arrival</dt><dd>{visitTime(pending ? booking.preferred_time : booking.confirmed_time)}</dd></div>
        <div><dt>Visit price</dt><dd>{(booking.job_total ?? booking.first_visit_price ?? booking.price_per_visit) == null ? 'Not set' : formatMoney(total)}</dd></div>
      </dl>
      {booking.completed_at && booking.status === 'completed' && <p className="crm-muted">Completed {dateText(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(booking.completed_at)))}.</p>}
      <div className="work-visit-actions">
        {pending && edit('Confirm first visit', 'date', true, 'calendar')}
        {confirmed && edit('Mark done', 'complete', true, 'check')}
        {confirmed && edit('Reschedule', 'date', false, 'calendar')}
        {edit(booking.notes ? 'Edit note' : 'Add note', 'note', false, 'note')}
        {edit('More actions', 'more')}
      </div>
    </header>

    {message && <p className="work-visit-feedback" role="status">{message}</p>}
    {panel && <section className="work-visit-card work-visit-editor" aria-labelledby="visit-editor-heading">
      <div className="work-visit-section-head">
        <h2 id="visit-editor-heading" tabIndex={-1} ref={editorHeading}>{PANELS[panel]}</h2>
        <button type="button" className="crm-button crm-button-ghost" onClick={close} disabled={busy}>Close</button>
      </div>
      {error && <p className="work-visit-error" role="alert">{error}</p>}
      <form key={panel} onSubmit={save} onChange={panel === 'date' ? () => setMovePreview(null) : undefined}>
        {panel === 'date' && <>
          {firstReview && pending && <>
            <p className="crm-muted">Review the identity, agreed work, and preferred date. Confirming saves them together.</p>
            {firstReview.terms.multiple && <p role="alert">This request stays in review while more than one promised service needs clarification.
              {booking.lead_id && <> <Link href={`/admin/leads/${booking.lead_id}`}>Review the original terms</Link> and arrange each agreed service separately.</>}</p>}
            {firstReview.terms.first_total == null && !firstReview.terms.multiple && <div className="work-visit-actions">{edit('Set agreed items and price', 'price')}</div>}
            {firstReview.terms.items_changed && <p role="alert">The visit items were edited. Confirm the original requested terms below or arrange the changed work separately.</p>}
            {firstReview.terms.first_items && <ul className="work-visit-records">
              {firstReview.terms.first_items.map((item, index) => <li key={index}>{item.description}<strong>{formatMoney(item.amount)}</strong></li>)}
            </ul>}
            {firstReview.terms.first_total != null && <p><strong>First visit {formatMoney(firstReview.terms.first_total)}</strong>
              {firstReview.terms.frequency !== 'onetime' && <> · {frequencyLabel(firstReview.terms.frequency)} {formatMoney(firstReview.terms.regular_total)} per visit</>}
            </p>}
            <div className="work-visit-fields work-visit-identity">
              {booking.customer_id ? <p>Linked customer · {name}</p> : <label className="crm-field">Customer<select name="customer" value={selectedCustomer} required
                onChange={event => { setSelectedCustomer(event.target.value); setSelectedProperty('new') }}>
                {samePhone.length > 0 && <option value="" disabled>Choose a customer</option>}
                <option value="new">Create new customer</option>
                {samePhone.map(c => <option key={c.id} value={c.id}>Possible match · {customerDisplayName(c)} · {formatPhone(c.phone)}</option>)}
                {customers.filter(c => !samePhone.includes(c)).map(c => <option key={c.id} value={c.id}>{customerDisplayName(c)} · {formatPhone(c.phone)}</option>)}
              </select></label>}
              {selectedCustomer === 'new' && <label className="crm-field">New customer name<input name="name" maxLength={150} defaultValue={name} required /></label>}
              {booking.property_id ? <p>Linked property · {booking.address}</p> : selectedCustomer && selectedCustomer !== 'new' && <label className="crm-field">Property<select name="property" value={selectedProperty}
                onChange={event => setSelectedProperty(event.target.value)}>
                <option value="new">Create new property</option>
                {properties.filter(p => p.customer_id === selectedCustomer).map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
              </select></label>}
              {selectedProperty === 'new' && <label className="crm-field">Reviewed property address<input name="address" maxLength={500}
                defaultValue={booking.address} readOnly={firstReview.terms.locked} required /></label>}
              {!booking.service_label_id && (!firstReview.terms.mowing || !firstReview.labels.some(label => label.semantic_key === 'mowing'))
                && <label className="crm-field">Service label<select aria-label="Service label" name="label" required={firstReview.terms.frequency !== 'onetime' || firstReview.terms.mowing}>
                <option value="">{firstReview.terms.frequency !== 'onetime' || firstReview.terms.mowing ? 'Choose a service label' : 'Keep visit description'}</option>
                {firstReview.labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}
              </select></label>}
              {!firstReview.terms.locked && <label className="crm-field">Repeat<select name="frequency" defaultValue={firstReview.terms.frequency}>
                <option value="onetime">Single visit</option><option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option>
              </select></label>}
            </div>
            {(firstReview.terms.needs_review || firstReview.terms.items_changed) && <label className="crm-check"><input type="checkbox" name="reviewed-terms" required />
              I reviewed the original quote and agreed this service with the customer.</label>}
          </>}
          <div className="work-visit-fields">
            <label className="crm-field">Visit date<input name="date" type="date" required disabled={busy} defaultValue={visitDate ?? ''} /></label>
            <label className="crm-field">Arrival time or window<input name="time" maxLength={80} disabled={busy} defaultValue={(pending ? booking.preferred_time : booking.confirmed_time) ?? ''} placeholder="Morning, Afternoon, or HH:MM" /></label>
          </div>
          {confirmed && agreement?.status === 'active' && !reviewReason && simpleShift && <label className="crm-check"><input type="checkbox" name="whole" checked={wholeMove} disabled={busy} onChange={event => setWholeMove(event.target.checked)} />Move this and future visits</label>}
          {confirmed && scheduleEditor && agreement?.status === 'active' && !simpleShift && <p className="crm-muted">This service has its own date rules. <Link href={scheduleEditor}>Edit its future schedule</Link> to review changes together.</p>}
          {hasEmail && <label className="crm-check"><input type="checkbox" name="email" disabled={busy} />Email this date to the customer</label>}
          {movePreview && <ServiceImpactPreview preview={movePreview.preview} moving />}
          <div className="work-visit-actions">
            <button type="submit" className="crm-button crm-button-primary" disabled={busy || Boolean(movePreview?.preview.conflicts.length) || (pending && (!firstReview || firstReview.terms.multiple || firstReview.terms.first_total == null))}>
              {busy ? 'Working…' : pending ? 'Confirm visit' : wholeMove ? movePreview ? 'Save reviewed dates' : 'Review dates' : 'Save visit date'}
            </button>
          </div>
        </>}
        {panel === 'complete' && <>
          {needsSchedule ? <>
            <p role="alert">Review this recurring visit’s service schedule before marking it done.</p>
            <div className="work-visit-actions">
              {edit(linked ? 'Review schedule' : 'Link customer and property', linked ? 'schedule' : 'link')}
              {bookingId && <button type="button" className="crm-button" disabled={busy} onClick={() => run('one-time', op => changeJob({ ...command(bookingId, op), action: 'mark_one_time' }), 'This visit is marked one-time.')}>Mark this visit one-time</button>}
            </div>
          </> : <>
            <p className="crm-muted">Record when the work was completed. Payment is a separate action.</p>
            <label className="crm-field">Date completed<input name="date" type="date" required defaultValue={today}
              onChange={() => { setIntroReview(null); setError('') }} /></label>
            {introReview?.earlierVisitId && <p><Link href={visitHref({ booking_id: introReview.earlierVisitId, agreement_id: null,
              revision_id: null, cadence_on: null }, back)}>Review the earlier visit</Link></p>}
            {introReview?.allocatedAmount != null && <ul className="work-visit-records">
              <li>Visit holding the introductory price{introReview.allocatedOn ? ` · ${dateText(introReview.allocatedOn)}` : ''}
                <strong>{formatMoney(introReview.allocatedAmount)}{introReview.move && ` → ${formatMoney(introReview.replacementAmount)}`}</strong></li>
              <li>This visit <strong>{formatMoney(introReview.visitAmount)}{introReview.move && ` → ${formatMoney(introReview.introAmount)}`}</strong></li>
            </ul>}
            <div className="work-visit-actions">{btn(introReview?.token ? 'Save reviewed completion' : 'Save completion')}</div>
          </>}
        </>}
        {panel === 'note' && <>
          <label className="crm-field">Internal visit note<textarea name="note" rows={4} maxLength={2000} defaultValue={booking.notes ?? ''} placeholder="Gate code, dog, where to park…" /></label>
          <div className="work-visit-actions">{btn('Save note')}</div>
        </>}
        {panel === 'payment' && <>
          <div className="work-visit-fields">
            <label className="crm-field">Paid amount<input name="amount" type="number" min=".01" step=".01" required defaultValue={Math.max(0, total - paid).toFixed(2)} /></label>
            <label className="crm-field">Date paid<input name="date" type="date" required defaultValue={today} /></label>
            <label className="crm-field">Payment method<select name="method"><option>Cash</option><option>Stripe</option><option>Venmo</option><option>Zelle</option><option>Other</option></select></label>
          </div>
          <div className="work-visit-actions">{btn('Save payment')}</div>
        </>}
        {panel === 'price' && <>
          <p className="crm-muted">Saved visit total {formatMoney(total)}{booking.accepted_quote_snapshot ? ' · Accepted quote saved in history' : ''}</p>
          {(current || agreement && agreement.status !== 'ended') ? <>
            <JobLineFields lines={lines} setLines={setLines} />
            {agreement && agreement.status !== 'ended' && <p className="crm-muted">A future price applies to untouched visits in this service schedule.</p>}
            <div className="work-visit-actions">
              {current && btn('Save this visit price', 'visit')}
              {scheduleEditor && agreement?.status !== 'ended' && <Link className="crm-button" href={scheduleEditor}>Review future visit price</Link>}
            </div>
          </> : <ul className="work-visit-records">{items.map((item, index) => <li key={index}>{item.description}<strong>{formatMoney(item.amount)}</strong></li>)}</ul>}
        </>}
        {panel === 'contact' && <>
          <p className="crm-muted">Update the point of contact for this visit.</p>
          <div className="work-visit-fields">
            <label className="crm-field">Visit contact name<input name="name" required defaultValue={booking.name} /></label>
            <label className="crm-field">Visit contact phone<input name="phone" type="tel" required defaultValue={booking.phone} /></label>
            <label className="crm-field">Visit contact email<input name="email" type="email" defaultValue={booking.email ?? ''} /></label>
          </div>
          <div className="work-visit-actions">{btn('Save contact')}</div>
        </>}
        {panel === 'link' && <>
          <p className="crm-muted">Review the customer and property before linking. Phone matches are suggestions.</p>
          <div className="work-visit-fields">
            <label className="crm-field">Customer<select aria-label="Customer" value={selectedCustomer} onChange={e => { setSelectedCustomer(e.target.value); setSelectedProperty('new') }}>
              <option value="new">Create new customer</option>
              {samePhone.map(c => <option key={c.id} value={c.id}>Possible match · {customerDisplayName(c)} · {formatPhone(c.phone)}</option>)}
              {customers.filter(c => !samePhone.includes(c)).map(c => <option key={c.id} value={c.id}>{customerDisplayName(c)} · {formatPhone(c.phone)}</option>)}
            </select></label>
            {selectedCustomer === 'new' && <label className="crm-field">New customer name<input name="name" required defaultValue={booking.name} /></label>}
            {selectedCustomer !== 'new' && <label className="crm-field">Property<select aria-label="Property" value={selectedProperty} onChange={e => setSelectedProperty(e.target.value)}>
              <option value="new">Create new property</option>
              {properties.filter(p => p.customer_id === selectedCustomer).map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
            </select></label>}
            {selectedProperty === 'new' && <label className="crm-field">New property address<input name="address" required defaultValue={booking.address} /></label>}
          </div>
          <div className="work-visit-actions">{btn('Link reviewed identity')}</div>
        </>}
        {panel === 'schedule' && (agreement ? <>
          <p className="crm-muted">{scheduleSummary ?? cadence(agreement)} · {formatMoney(agreement.price_per_visit)} per visit</p>
          {reviewReason && <p role="alert">{reviewReason}</p>}
          {reviewReason && !agreement.schedule_review_reason && <Link className="crm-button" href="/admin/jobs?attention=schedule_review">Review conflicting visits</Link>}
          {agreement.status !== 'ended' && scheduleEditor && <div className="work-visit-actions">
            <Link className="crm-button crm-button-primary" href={scheduleEditor}>
              {agreement.schedule_review_reason ? 'Review restart' : agreement.status === 'paused' ? 'Review resume' : 'Review schedule changes'}
            </Link>
            {addExtra && <Link className="crm-button" href={addExtra}>Add extra visit</Link>}
          </div>}
        </> : !linked ? <>
          <p>Link a customer and property before setting a schedule.</p>
          <div className="work-visit-actions">{edit('Link customer and property', 'link')}</div>
        </> : <>
          {candidates.length > 0 && <>
            <label className="crm-field">Choose a service schedule<select name="plan" required defaultValue="">
              <option value="" disabled>Select schedule</option>
              {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.service_labels?.name ?? 'Saved service'} · {cadence(candidate)} · {formatMoney(candidate.price_per_visit)} per visit · Next {dateText(candidate.next_on)}</option>)}
            </select></label>
            <p className="crm-muted">This visit keeps its agreed price when it joins.</p>
          </>}
          <div className="work-visit-actions">
            {candidates.length > 0 && btn('Join selected schedule', 'join')}
            {startSchedule && <Link className={`crm-button${candidates.length ? '' : ' crm-button-primary'}`} href={startSchedule}>Start schedule from this visit</Link>}
            {pending && !candidates.length && <p>Confirm the visit date before setting a repeating schedule.</p>}
          </div>
        </>)}
        {panel === 'more' && <div className="work-visit-actions">
          {edit('Edit visit contact', 'contact')}
          {!linked && edit('Link customer and property', 'link')}
          {edit('Property and request details', 'details')}
          {confirmed && edit('Send a reminder', 'reminder')}
          {current && agreement && <button type="button" className="crm-button" disabled={busy}
            onClick={() => { if (window.confirm('Skip this visit?')) runVisit('skip', { action: 'skip' }, (id, op) => changeJob({ ...command(id, op), action: 'skip' }), 'Visit skipped.') }}>Skip this visit</button>}
          {current && <button type="button" className="crm-button crm-button-danger" disabled={busy}
            onClick={() => { if (window.confirm(quotedVisit && !agreement ? 'Cancel this visit and mark the accepted quote canceled?' : 'Cancel this visit and keep it in history?')) runVisit('cancel', { action: 'cancel' }, (id, op) => changeJob({ ...command(id, op), action: 'cancel' }), 'Visit canceled.') }}>Cancel this visit</button>}
        </div>}
        {panel === 'details' && <>
          {booking.sq_ft != null && <p>Lawn size {booking.sq_ft.toLocaleString()} sq ft</p>}
          {formatAttributionLabel(booking) && <p>Source {formatAttributionLabel(booking)}</p>}
          {bookingPrice(booking) && <PriceSteps price={bookingPrice(booking)!} firstVisit={firstVisit} />}
          {firstVisit && (booking.overgrowth_fee ?? 0) > 0 && <p>First visit cleanup fee {formatMoney(booking.overgrowth_fee)}</p>}
          {booking.addon_interest && typeof booking.addon_interest === 'object' && !Array.isArray(booking.addon_interest) && <p>{addonDetails(booking.addon_interest)}</p>}
          {booking.accepted_quote_snapshot != null && <p className="crm-muted">Accepted quote saved with this visit.</p>}
          <LawnMap screenshotUrl={mapUrl} shapes={shapes} sqFt={booking.sq_ft} />
          {!mapUrl && !shapes.length && !booking.sq_ft && <p className="crm-muted">No lawn measurement saved.</p>}
        </>}
        {panel === 'reminder' && <ReminderButtons bookingId={bookingId} name={booking.name} phone={booking.phone} email={booking.email}
          confirmedDate={booking.confirmed_date} confirmedTime={booking.confirmed_time} lastReminderSentAt={booking.last_reminder_sent_at}
          emailAction={occurrence ? () => run('reminder', operationId => editProjectedVisit({ ...occurrence, operationId, action: 'reminder' }), 'Reminder sent.') : undefined}
          emailBusy={busy} />}
      </form>
    </section>}

    <div className="work-visit-grid">
      <section className="work-visit-card work-visit-notes">
        <h2>Notes</h2>
        <h3>Visit note</h3><p className={booking.notes ? 'work-visit-note' : 'crm-muted'}>{booking.notes || 'No internal note yet.'}</p>
        {booking.customer_notes && <><h3>Customer note</h3><p className="work-visit-note">{booking.customer_notes}</p></>}
      </section>
      <section className="work-visit-card">
        <div className="work-visit-section-head"><h2>Payment</h2><span className="work-visit-status" data-status={paymentStatus}>{paymentStatus}</span></div>
        <p>{formatMoney(paid)} recorded · {formatMoney(total)} visit price</p>
        {payments.length > 0 && <ul className="work-visit-records">{payments.map(payment => <li key={payment.id}>
          <span>{dateText(payment.paid_on)} · {payment.method} ({payment.provenance === 'manual' ? 'staff recorded' : 'processor verified'})</span><strong>{formatMoney(payment.amount)}</strong>
        </li>)}</ul>}
        {booking.amount_charged != null && <p className="crm-muted">Older record {formatMoney(booking.amount_charged)} via {booking.payment_method ?? 'unspecified method'}. Settlement is unverified.</p>}
        <div className="work-visit-actions">
          {edit('Record payment', 'payment')}
          {paymentLink ? <>
            <a className="crm-button" href={paymentLink} target="_blank" rel="noopener noreferrer">Open payment link</a>
            {booking.phone && <a className="crm-button" href={`sms:${booking.phone}&body=${encodeURIComponent(`Here is your QuietGreen payment link: ${paymentLink}`)}`}>Text link</a>}
          </> : (confirmed || booking.status === 'completed') && <button type="button" className="crm-button" disabled={busy || total <= 0}
            onClick={() => runVisit('payment-link', { action: 'payment_link' }, async id => {
              const result = await createPaymentLink(id, total, booking.name, booking.address)
              if ('error' in result) return { success: false, error: result.error }
              return { success: true }
            }, 'Payment link created.')}>Create payment link</button>}
          {edit('Items and price', 'price')}
        </div>
        {!panel && error && <p className="work-visit-error" role="alert">{error}</p>}
      </section>
      <section className="work-visit-card">
        <h2>Service schedule</h2>
        {agreement ? <>
          <p>{scheduleSummary ?? cadence(agreement)} · {formatMoney(agreement.price_per_visit)} per visit</p>
          <p className="crm-muted">{reviewReason ? 'Needs schedule review' : awaitingFirst ? 'Awaiting first-visit confirmation' : agreement.status === 'active' ? `Active · Next ${dateText(agreement.next_on)}` : agreement.status === 'paused' ? 'Paused' : 'Ended'}</p>
          {occurrence && reviewReason && <p className="crm-muted">{reviewReason}</p>}
        </> : <p className="crm-muted">{needsSchedule ? 'Review the schedule for this recurring visit.' : 'No repeating schedule for this visit.'}</p>}
        {!awaitingFirst && (agreement || current || booking.status === 'completed') && <div className="work-visit-actions">{edit(agreement ? 'Edit schedule' : 'Set schedule', 'schedule')}</div>}
      </section>
      <section className="work-visit-card">
        <h2>Contact and property</h2>
        <div className="work-visit-actions">
          {booking.address && <a className="crm-button" href={`https://maps.google.com/?q=${encodeURIComponent(booking.address)}`} target="_blank" rel="noopener noreferrer"><Icon name="navigation" size={15} />Map</a>}
          {booking.phone && <><a className="crm-button" href={`tel:${booking.phone}`}><Icon name="phone" size={15} />Call</a>
            <a className="crm-button" href={`sms:${booking.phone}`}><Icon name="message" size={15} />Text</a></>}
          {booking.email && <a className="crm-button" href={`mailto:${booking.email}`}><Icon name="mail" size={15} />Email</a>}
        </div>
        {booking.customer_id ? <Link className="work-visit-history" href={`/admin/customers/${booking.customer_id}`}>Customer history <Icon name="arrowRight" size={15} /></Link>
          : booking.phone ? <Link className="work-visit-history" href={`/admin/client/${encodeURIComponent(booking.phone)}`}>Unlinked phone history <Icon name="arrowRight" size={15} /></Link> : null}
      </section>
    </div>
  </div>
}
