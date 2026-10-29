'use client'

import { formatPhone } from '@/lib/format-phone'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { changeAgreement, changeJob, createPaymentLink, linkJobIdentity, markComplete, recordManualPayment, saveJobItems, scheduleJobAndEmail, startJobAgreement, updateContactDetails, updateNotes } from './actions'
import { formatMoney, jobPrice, jobStatusLabel, type JobLine } from '@/lib/crm-jobs'
import { formatAttributionLabel } from '@/lib/attribution'
import ReminderButtons from './ReminderButtons'
import PriceSteps from './PriceSteps'
import LawnMap from './LawnMap'
import type { Shape } from './leads/TracingMap'
import { bookingPrice, money as dollars } from '@/lib/lead-summary'
import Icon from './icons'
import { uuid } from '@/lib/uuid'

export type Booking = {
  id: string; updated_at: string; name: string; phone: string; email: string | null
  address: string; status: string; preferred_date: string | null; confirmed_date: string | null
  confirmed_time: string | null; completed_at: string | null; frequency: string | null
  first_visit_price?: number | null; overgrowth_fee?: number | null
  price_per_visit: number | null; job_total: number | string | null; sq_ft: number | null
  notes: string | null; customer_notes: string | null; map_screenshot_url: string | null
  payment_link: string | null; amount_charged: number | null; payment_method: string | null
  customer_id: string | null; property_id: string | null; agreement_id: string | null
  occurrence_on: string | null; accepted_quote_snapshot: unknown; one_time: boolean
  last_reminder_sent_at: string | null; created_at: string
  gclid: string | null; utm_source: string | null; utm_medium: string | null
  utm_campaign: string | null; utm_term: string | null; utm_content: string | null
  addon_interest: Record<string, unknown> | null
}

type Customer = { id: string; name: string | null; phone: string | null; email: string | null }
type Property = { id: string; customer_id: string; address: string }
type Agreement = {
  id: string; status: string; updated_at: string; anchor_on: string; next_on: string
  interval_unit: 'week' | 'month'; interval_count: number; price_per_visit: number | string | null
  items_template: JobLine[]
}
type Payment = { id: string; amount: number | string; paid_on: string; method: string; provenance: string }

type Props = {
  booking: Booking; historyCount?: number; customers?: Customer[]; properties?: Property[]
  agreement?: Agreement | null; futureJobIds?: string[]; items?: JobLine[]; payments?: Payment[]
  emailConfigured?: boolean; quotedVisit?: boolean
  /** The lead's website tracing, drawn when the visit has no saved map image. */
  shapes?: Shape[]
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const money = formatMoney
const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
      typeof fields.price === 'number' ? `starting at ${money(fields.price)}` : null,
      Array.isArray(fields.hazards) ? `hazards: ${fields.hazards.join(', ')}` : null,
      fields.haul_away === true ? 'hauled away' : null,
    ].filter(Boolean)
    return `${name}${details.length ? ` — ${details.join(', ')}` : ''}`
  }).join('; ')
}

export default function BookingCard({ booking, historyCount = 1, customers = [], properties = [], agreement, futureJobIds = [], items = [], payments = [], emailConfigured = false, quotedVisit = false, shapes = [] }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const operation = useRef<{ key: string; id: string } | null>(null)
  const [visitDate, setVisitDate] = useState(booking.confirmed_date ?? booking.preferred_date ?? '')
  const [visitTime, setVisitTime] = useState(booking.confirmed_time ?? '')
  const [completedOn, setCompletedOn] = useState(today())
  const [notes, setNotes] = useState(booking.notes ?? '')
  const [contactName, setContactName] = useState(booking.name)
  const [contactPhone, setContactPhone] = useState(booking.phone)
  const [contactEmail, setContactEmail] = useState(booking.email ?? '')
  const [showContact, setShowContact] = useState(false)
  const [lines, setLines] = useState<JobLine[]>(items.length ? items : [{ kind: 'service', description: 'Service', amount: jobPrice(booking).toFixed(2) }])
  const [paymentAmount, setPaymentAmount] = useState(jobPrice(booking).toFixed(2))
  const [paidOn, setPaidOn] = useState(today())
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [paymentLink, setPaymentLink] = useState(booking.payment_link)
  const [linkBusy, setLinkBusy] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState('new')
  const [selectedPropertyId, setSelectedPropertyId] = useState('new')
  const [newCustomerName, setNewCustomerName] = useState(booking.name)
  const [newPropertyAddress, setNewPropertyAddress] = useState(booking.address)
  const [intervalUnit, setIntervalUnit] = useState<'week' | 'month'>('week')
  const [intervalCount, setIntervalCount] = useState(1)
  const [nextOn, setNextOn] = useState('')
  const [resumeOn, setResumeOn] = useState('')
  const [showAgreement, setShowAgreement] = useState(false)
  const lawnLine = (items.length ? items : []).find(line => line.kind === 'service' && /(mow|lawn)/i.test(line.description))
  const [planPrice, setPlanPrice] = useState((lawnLine ? Number(lawnLine.amount) : jobPrice(booking)).toFixed(2))
  const [showPricing, setShowPricing] = useState(false)

  const relatedProperties = properties.filter(p => p.customer_id === selectedCustomerId)
  const samePhone = customers.filter(c => (c.phone ?? '').replace(/\D/g, '') === booking.phone.replace(/\D/g, ''))
  const actualPaid = payments.reduce((total, row) => total + Number(row.amount), 0)
  const source = formatAttributionLabel(booking)
  const price = bookingPrice(booking)
  // Plan visits after the first carry the plan's prices; the first-visit discount was the first one's.
  const firstVisit = quotedVisit || (!booking.agreement_id && !booking.occurrence_on)

  function opId(key: string) {
    if (!operation.current || operation.current.key !== key) operation.current = { key, id: uuid() }
    return operation.current.id
  }
  function run(key: string, action: (id: string) => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>, success: string) {
    setError(''); setNotice('')
    const id = opId(key)
    startTransition(async () => {
      try {
        const result = await action(id)
        if (!result.success) { setError(result.error ?? 'Could not save. Please retry.'); return }
        operation.current = null
        setNotice(typeof result.data?.warning === 'string' ? result.data.warning : success)
        router.refresh()
      } catch {
        setError('The request did not finish. Retry to check the same operation before trying a new one.')
      }
    })
  }
  function changeLine(index: number, patch: Partial<JobLine>) {
    setLines(previous => previous.map((line, i) => i === index ? { ...line, ...patch } : line))
  }
  const current = booking.status === 'pending' || booking.status === 'confirmed'
  const linked = Boolean(booking.customer_id && booking.property_id)

  const visitDateText = booking.confirmed_date ? dateLabel(booking.confirmed_date) : booking.preferred_date ? `Requested ${dateLabel(booking.preferred_date)}` : 'No date set'
  const needsOneTimeDecision = !agreement && !booking.one_time && Boolean(booking.frequency) && !/^(one[ -]?time|single|once)$/i.test((booking.frequency ?? '').trim())

  return <div className="admin-card">
    <button className="admin-card-summary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      <span className="admin-card-summary-who">
        <span className="admin-card-summary-name">{booking.name}</span>
        <span className="admin-card-summary-addr">{booking.address}</span>
      </span>
      <span className="admin-card-summary-date">{booking.confirmed_date ? dateLabel(booking.confirmed_date) : booking.preferred_date ? <em>Req. {dateLabel(booking.preferred_date)}</em> : <em>No date</em>}</span>
      <span className={`admin-badge admin-badge-${booking.status}`}>{jobStatusLabel(booking.status)}</span>
      <span className="admin-card-summary-price">{money(jobPrice(booking))}</span>
      <Icon name="chevronDown" size={16} className="admin-card-summary-chevron" />
    </button>
    {expanded && <div className="admin-card-body">
      <div className="admin-card-facts">
        <div className="admin-card-fact"><span>Property</span><span>{booking.address}</span></div>
        <div className="admin-card-fact"><span>Visit</span><span>{visitDateText} {booking.confirmed_time ?? ''}</span></div>
        {booking.sq_ft != null && <div className="admin-card-fact"><span>Lawn size</span><span>{booking.sq_ft.toLocaleString()} sq ft</span></div>}
        <div className="admin-card-fact"><span>Job total · paid</span><span>{money(jobPrice(booking))} · {money(actualPaid)}</span></div>
        {source && <div className="admin-card-fact"><span>Source</span><span>{source}</span></div>}
      </div>
      {price && <div className="admin-card-price">
        <PriceSteps price={price} firstVisit={firstVisit} />
        {firstVisit && (booking.overgrowth_fee ?? 0) > 0 && <dl className="crm-kv"><div><dt>Cleanup fee</dt><dd>{dollars(booking.overgrowth_fee! * 100)} <small>in first visit</small></dd></div></dl>}
      </div>}
      {(booking.accepted_quote_snapshot != null || booking.customer_notes || (booking.addon_interest && Object.keys(booking.addon_interest).length > 0)) && <div className="admin-card-notes">
        {booking.accepted_quote_snapshot != null && <div className="admin-card-row">Accepted quote is saved with this job. Operational edits below preserve it.</div>}
        {booking.customer_notes && <div className="admin-customer-note"><strong>Customer note</strong><p>{booking.customer_notes}</p></div>}
        {booking.addon_interest && Object.keys(booking.addon_interest).length > 0 && <div className="admin-customer-note"><strong>Submitted add-on interest</strong><p>{addonDetails(booking.addon_interest)}</p></div>}
      </div>}
      {(booking.map_screenshot_url || shapes.length > 0) && <div className="admin-card-map"><LawnMap screenshotUrl={booking.map_screenshot_url} shapes={shapes} sqFt={booking.sq_ft} /></div>}
      <div className="admin-card-actions">
        <a href={`tel:${booking.phone}`} className="crm-button crm-button-primary admin-action-call"><Icon name="phone" size={15} />Call {formatPhone(booking.phone)}</a>
        <a href={`sms:${booking.phone}`} className="crm-button admin-action-text"><Icon name="message" size={15} />Text</a>
        {booking.email && <a href={`mailto:${booking.email}`} className="crm-button admin-action-email"><Icon name="mail" size={15} />Email</a>}
        <div className="admin-card-links">
          {linked ? <a href={`/admin/customers/${booking.customer_id}`} className="admin-card-history-link">Customer history ({historyCount} visit{historyCount === 1 ? '' : 's'}) →</a>
            : <a href={`/admin/client/${encodeURIComponent(booking.phone)}`} className="admin-card-history-link">Unlinked phone history →</a>}
          <button className="admin-edit-service-link" onClick={() => setShowContact(!showContact)}>Edit visit contact</button>
        </div>
      </div>

      <div className="admin-card-grid">
        {showContact && <section className="admin-edit-service-panel admin-card-wide" aria-label="Visit contact">
          <h3>Visit contact</h3>
          <p>Changing this visit contact does not merge or remove customer history.</p>
          <div className="admin-complete-fields">
            <input aria-label="Visit contact name" value={contactName} onChange={e => setContactName(e.target.value)} className="admin-confirm-date-input" />
            <input aria-label="Visit contact phone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} className="admin-confirm-date-input" />
            <input aria-label="Visit contact email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="admin-confirm-date-input" />
          </div>
          <div className="admin-btn-row"><button className="crm-button" disabled={pending} onClick={() => run('contact', async () => updateContactDetails(booking.id, { name: contactName, phone: contactPhone, email: contactEmail }), 'Visit contact saved.')}>Save contact</button></div>
        </section>}

        {!linked && <section className="admin-edit-service-panel admin-card-wide" aria-label="Link customer and property">
          <h3>Link customer and property</h3>
          <p>Review matches before linking. Matching phone numbers are suggestions only.</p>
          <div className="admin-complete-fields">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label>Customer</label>
              <select value={selectedCustomerId} onChange={e => { setSelectedCustomerId(e.target.value); setSelectedPropertyId('new') }} className="admin-confirm-date-input">
                <option value="new">Create new customer</option>
                {samePhone.map(c => <option key={c.id} value={c.id}>Possible match: {c.name || formatPhone(c.phone)} · {formatPhone(c.phone)}</option>)}
                {customers.filter(c => !samePhone.some(match => match.id === c.id)).map(c => <option key={c.id} value={c.id}>{c.name || formatPhone(c.phone) || c.id}</option>)}
              </select>
              {selectedCustomerId === 'new' && <input aria-label="New customer name" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} className="admin-confirm-date-input" />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label>Property</label>
              {selectedCustomerId !== 'new' && <select value={selectedPropertyId} onChange={e => setSelectedPropertyId(e.target.value)} className="admin-confirm-date-input">
                <option value="new">Create new property</option>
                {relatedProperties.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
              </select>}
              {selectedPropertyId === 'new' && <input aria-label="New property address" value={newPropertyAddress} onChange={e => setNewPropertyAddress(e.target.value)} className="admin-confirm-date-input" />}
            </div>
          </div>
          <div className="admin-btn-row"><button className="crm-button crm-button-primary" disabled={pending} onClick={() => run('link:'+selectedCustomerId+':'+selectedPropertyId, id => linkJobIdentity({
            bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId: id,
            customerId: selectedCustomerId === 'new' ? null : selectedCustomerId,
            propertyId: selectedPropertyId === 'new' ? null : selectedPropertyId,
            customer: selectedCustomerId === 'new' ? { name: newCustomerName, phone: booking.phone, email: booking.email ?? '' } : null,
            property: selectedPropertyId === 'new' ? { address: newPropertyAddress } : null,
          }), 'Customer and property linked.')}>Link reviewed identity</button></div>
        </section>}

        {current && <section className="admin-edit-service-panel" aria-label="Visit schedule">
          <h3>{booking.status === 'pending' ? 'Schedule visit' : 'Reschedule this visit'}</h3>
          <div className="admin-complete-fields">
            <input aria-label="Visit date" type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)} className="admin-confirm-date-input" />
            <input aria-label="Arrival time or window" value={visitTime} onChange={e => setVisitTime(e.target.value)} className="admin-confirm-date-input" placeholder="Morning, Afternoon, or HH:MM" />
          </div>
          <div className="admin-btn-row"><button className="crm-button crm-button-primary" disabled={pending || !visitDate} onClick={() => run('schedule:'+visitDate+visitTime, id => scheduleJobAndEmail({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId: id, action: booking.status === 'pending' ? 'confirm' : 'reschedule', date: visitDate, time: visitTime }), booking.status === 'pending' ? 'Visit confirmed.' : 'Only this visit was rescheduled.')}>{emailConfigured && booking.email ? booking.status === 'pending' ? 'Confirm & email customer' : 'Reschedule & email customer' : 'Save visit date'}</button></div>
          {booking.status === 'confirmed' && <ReminderButtons bookingId={booking.id} name={booking.name} phone={booking.phone} email={booking.email} confirmedDate={booking.confirmed_date} confirmedTime={booking.confirmed_time} lastReminderSentAt={booking.last_reminder_sent_at} />}
        </section>}

        {booking.status === 'confirmed' && <section className="admin-complete-panel" aria-label="Complete job">
          <h3>Complete this visit</h3>
          <input aria-label="Date completed" type="date" value={completedOn} onChange={e => setCompletedOn(e.target.value)} className="admin-confirm-date-input" />
          <p>{agreement?.status === 'active' ? 'The next visit will be created from the mowing plan.' : 'This is a one-off visit; no next visit will be created.'} Payment is recorded separately.</p>
          {needsOneTimeDecision && <>
            <p role="alert">This visit is marked recurring but has no mowing plan. Link its customer, start a mowing plan, or mark this visit one-time.</p>
            <div className="admin-btn-row"><button className="crm-button" disabled={pending} onClick={() => run('mark-one-time', id => changeJob({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId: id, action: 'mark_one_time' }), 'Visit marked one-time. You may complete it now.')}>Mark this visit one-time</button></div>
          </>}
          <div className="admin-btn-row"><button className="crm-button crm-button-primary" disabled={pending || needsOneTimeDecision} onClick={() => run('complete:'+completedOn, id => markComplete(booking.id, { completed_at: completedOn, expected_updated_at: booking.updated_at, operation_id: id }), 'Visit completed.')}><Icon name="check" size={15} />Mark complete</button></div>
        </section>}

        <section className="admin-edit-service-panel" aria-label="Payments">
          <h3>Payments received <small>{money(actualPaid)}</small></h3>
          {(payments.length > 0 || booking.amount_charged != null) && <div className="admin-payment-list">
            {payments.map(p => <div key={p.id} className="admin-card-row"><span>{dateLabel(p.paid_on)} · {p.method} ({p.provenance === 'manual' ? 'staff recorded' : 'processor verified'})</span><strong>{money(p.amount)}</strong></div>)}
            {booking.amount_charged != null && <p>Legacy amount recorded: {money(booking.amount_charged)} via {booking.payment_method ?? 'unspecified method'}. Date and settlement were not independently verified.</p>}
          </div>}
          <div className="admin-complete-fields">
            <input aria-label="Paid amount" type="number" min="0.01" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="admin-confirm-date-input" />
            <input aria-label="Date paid" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} className="admin-confirm-date-input" />
            <select aria-label="Payment method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option>Cash</option><option>Stripe</option><option>Venmo</option><option>Zelle</option><option>Other</option></select>
          </div>
          <div className="admin-btn-row">
            <button className="crm-button" disabled={pending} onClick={() => run('payment:'+paymentAmount+paidOn+paymentMethod, id => recordManualPayment({ bookingId: booking.id, operationId: id, amount: paymentAmount, paidOn, method: paymentMethod }), 'Payment recorded.')}>Record payment</button>
            <button className="crm-button crm-button-ghost admin-action-stripe" disabled={linkBusy || jobPrice(booking) <= 0} onClick={async () => {
              setLinkBusy(true); setError('')
              const result = await createPaymentLink(booking.id, jobPrice(booking), booking.name, booking.address)
              setLinkBusy(false)
              if ('error' in result) setError(result.error); else setPaymentLink(result.url)
            }}>{linkBusy ? 'Generating…' : 'Create Stripe payment link for job total'}</button>
          </div>
          {paymentLink && <div className="admin-payment-link-box"><a href={paymentLink} target="_blank" rel="noopener noreferrer">{paymentLink}</a> · <a href={`sms:${booking.phone}&body=${encodeURIComponent(`Hi ${booking.name.split(' ')[0]}, here is your QuietGreen payment link: ${paymentLink}`)}`}>Text link</a></div>}
        </section>

        <section className="admin-edit-service-panel" aria-label="Job price">
          <button className="admin-panel-toggle" aria-expanded={showPricing} onClick={() => setShowPricing(!showPricing)}>Job items and price <Icon name="chevronDown" size={16} /></button>
          {!showPricing && <p>Current job total: <strong>{money(jobPrice(booking))}</strong>. Paid: <strong>{money(actualPaid)}</strong>.</p>}
          {showPricing && <>
            <div className="admin-price-lines">
              {lines.map((line, index) => <div key={index} className="admin-price-line">
                <select aria-label={`Item ${index+1} type`} value={line.kind} onChange={e => changeLine(index, { kind: e.target.value as JobLine['kind'] })}><option value="service">Service</option><option value="discount">Discount</option></select>
                <input aria-label={`Item ${index+1} description`} value={line.description} onChange={e => changeLine(index, { description: e.target.value })} className="admin-confirm-date-input" />
                <input aria-label={`Item ${index+1} amount`} type="number" min="0" step="0.01" value={line.amount.replace(/^-/, '')} onChange={e => changeLine(index, { amount: e.target.value })} className="admin-confirm-date-input" />
                <button className="admin-remove" aria-label={`Remove item ${index+1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}>×</button>
              </div>)}
            </div>
            <div className="admin-price-total"><span>Current job total</span><strong>{money(jobPrice(booking))}</strong></div>
            <div className="admin-btn-row">
              <button className="crm-button crm-button-sm crm-button-ghost" onClick={() => setLines([...lines, { kind: 'service', description: '', amount: '0.00' }])}>Add service</button>
              <button className="crm-button crm-button-sm crm-button-ghost" onClick={() => setLines([...lines, { kind: 'discount', description: 'Discount', amount: '0.00' }])}>Add discount</button>
            </div>
            {current && <div className="admin-btn-row"><button className="crm-button" disabled={pending} onClick={() => run('items:'+JSON.stringify(lines), async id => { const result = await saveJobItems({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId: id, items: lines }); if (result.success) setPaymentLink(null); return result }, 'Current job price saved. Accepted quote preserved.')}>Save current job price</button></div>}
            {!current && <p>Finished job prices stay in history.</p>}
          </>}
        </section>

        {(current || booking.status === 'completed') && !agreement && linked && <section className="admin-edit-service-panel" aria-label="Start recurring agreement">
          <button className="admin-panel-toggle" aria-expanded={showAgreement} onClick={() => setShowAgreement(!showAgreement)}>Start mowing plan <Icon name="chevronDown" size={16} /></button>
          {showAgreement && <>
            <p>Repeats lawn care on a schedule. This visit keeps its own price and payments; one-off work like cleanups stays out of the plan.</p>
            <label>Lawn care price per visit ($)</label>
            <input aria-label="Plan price per visit" inputMode="decimal" value={planPrice} onChange={e => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setPlanPrice(e.target.value)} className="admin-confirm-date-input" />
            <label>Every</label>
            <div className="admin-complete-fields">
              <input aria-label="Interval count" type="number" min="1" max="52" value={intervalCount} onChange={e => setIntervalCount(Number(e.target.value))} className="admin-confirm-date-input" />
              <select value={intervalUnit} onChange={e => setIntervalUnit(e.target.value as 'week'|'month')}><option value="week">Weeks</option><option value="month">Months</option></select>
            </div>
            <label>Next visit after this one</label><input type="date" value={nextOn} onChange={e => setNextOn(e.target.value)} className="admin-confirm-date-input" />
            <div className="admin-btn-row"><button className="crm-button crm-button-primary" disabled={pending || !nextOn || !visitDate || !Number(planPrice)} onClick={() => run('start-agreement:'+nextOn+planPrice, id => startJobAgreement({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId: id, anchorOn: booking.confirmed_date ?? booking.preferred_date ?? '', nextOn, intervalUnit, intervalCount, itemsTemplate: [{ kind: 'service', description: 'Lawn care', amount: planPrice }] }), 'Mowing plan started.')}>Start plan</button></div>
          </>}
        </section>}

        {agreement && <section className="admin-edit-service-panel" aria-label="Recurring agreement">
          <h3>Mowing plan <span className={`admin-badge admin-badge-${agreement.status === 'active' ? 'confirmed' : agreement.status === 'paused' ? 'pending' : 'canceled'}`}>{agreement.status.charAt(0).toUpperCase() + agreement.status.slice(1)}</span></h3>
          <p>Every {agreement.interval_count} {agreement.interval_unit}{agreement.interval_count === 1 ? '' : 's'} · next {dateLabel(agreement.next_on)} · future template {money(agreement.price_per_visit)}.</p>
          <p>Changing the template affects newly generated visits only. Existing visit prices stay put.</p>
          {agreement.status !== 'ended' && <div className="admin-btn-row"><button className="crm-button crm-button-sm" disabled={pending} onClick={() => run('template:'+JSON.stringify(lines), id => changeAgreement({ agreementId: agreement.id, expectedUpdatedAt: agreement.updated_at, operationId: id, action: 'price_template', itemsTemplate: lines }), 'Future agreement price saved.')}>Use these items for future visits</button></div>}
          {agreement.status === 'active' && <>
            <p>Pause or end will cancel {futureJobIds.length} upcoming unfinished visit{futureJobIds.length === 1 ? '' : 's'} after this preview. Completed and overdue work stays in history.</p>
            <div className="admin-btn-row">
              <button className="crm-button crm-button-sm" disabled={pending} onClick={() => { if (window.confirm(`Pause the plan and cancel ${futureJobIds.length} upcoming visit(s)?`)) run('pause:'+futureJobIds.join(','), id => changeAgreement({ agreementId: agreement.id, expectedUpdatedAt: agreement.updated_at, operationId: id, action: 'pause', futureJobIds }), 'Plan paused.') }}>Pause plan</button>
              <button className="crm-button crm-button-sm crm-button-danger" disabled={pending} onClick={() => { if (window.confirm(`End and cancel ${futureJobIds.length} upcoming visit(s)? This plan cannot resume.`)) run('end:'+futureJobIds.join(','), id => changeAgreement({ agreementId: agreement.id, expectedUpdatedAt: agreement.updated_at, operationId: id, action: 'end', futureJobIds }), 'Plan ended.') }}>End plan</button>
            </div>
          </>}
          {agreement.status === 'paused' && <>
            <label>Explicit next date</label><input aria-label="Resume next date" type="date" value={resumeOn} onChange={e => setResumeOn(e.target.value)} className="admin-confirm-date-input" />
            <p>If this reopens a visit canceled by the pause, that visit keeps its original price.</p>
            <div className="admin-btn-row"><button className="crm-button crm-button-primary" disabled={pending || !resumeOn} onClick={() => run('resume:'+resumeOn, id => changeAgreement({ agreementId: agreement.id, expectedUpdatedAt: agreement.updated_at, operationId: id, action: 'resume', nextOn: resumeOn }), 'Plan resumed.')}>Resume plan</button></div>
          </>}
        </section>}

        <section className="admin-notes-wrap" aria-label="Internal notes">
          <label className="admin-notes-label" htmlFor={`notes-${booking.id}`}>Internal notes</label>
          <textarea id={`notes-${booking.id}`} className="admin-notes-input" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Gate code, dog, where to park…" />
          <div className="admin-btn-row"><button className="crm-button crm-button-sm" disabled={pending} onClick={() => run('notes:'+notes, async () => { await updateNotes(booking.id, notes); return { success: true } }, 'Notes saved.')}>Save notes</button></div>
        </section>
      </div>

      {booking.status === 'completed' && booking.completed_at && <div className="admin-complete-record" style={{ marginTop: 12 }}>Completed {dateLabel(booking.completed_at)}.</div>}
      {current && <div className="admin-card-status-btns">
        {agreement && <button className="crm-button crm-button-sm" disabled={pending} onClick={() => run('skip', id => changeJob({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId: id, action: 'skip' }), 'This visit skipped; next agreement visit scheduled.')}>Skip only this visit</button>}
        <button className="crm-button crm-button-sm crm-button-danger" disabled={pending} onClick={() => { if (window.confirm(quotedVisit && !agreement ? `Cancel this visit and keep its history? This also marks ${booking.name.split(' ')[0]}'s quote as canceled.` : 'Cancel this visit and keep its history?')) run('cancel', id => changeJob({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId: id, action: 'cancel' }), 'Visit canceled and retained in history.') }}>Cancel visit</button>
      </div>}
      {error && <div className="crm-toast crm-toast-error booking-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}
      {notice && <div className="crm-toast" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    </div>}
  </div>
}
