'use client'

import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import { cleanAttribution, creativeTypeLabel, formatAttributionLabel, type Attribution } from '@/lib/attribution'
import { useRef, useState, useTransition } from 'react'
import Icon from '../icons'
import { useRouter } from 'next/navigation'
import MapQuoteBuilder from '@/components/MapQuoteBuilder'
import { quoteTotalCents, type QuoteDraft } from '@/lib/quote-draft'
import { formatMoney } from '@/lib/crm-jobs'
import { addLeadNote, bookLeadVisit, cancelLeadBooking, previewLeadBookingCancellation, processLeadAlert, recordLeadCall, setLeadFollowUp, setLeadQuoteDecision, setLeadStage, updateLeadContact } from './quote-actions'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import type { ContactOutcome, LeadStage, QuoteStatus } from '@/lib/crm-contracts'

type Lead = {
  id: string; name: string | null; phone: string; email: string | null; address: string | null
  sq_ft: number | null; services: string[] | null; frequency: string | null; timing: string | null
  created_at: string; updated_at: string; quote_saved_at: string | null; quote_confirmed_at: string | null
  quote_status: QuoteStatus; quote_draft: QuoteDraft | null; contact_outcome: ContactOutcome | null
  follow_up_at: string | null; stage: string; source: string | null; answers: unknown; attribution: unknown
  form_version: string | null; external_submission_id: string | null; consent: boolean | null
  consent_text: string | null; consent_version: string | null; consented_at: string | null
  score: unknown; estimated_value: unknown
}
type Activity = { id: string; kind: string; outcome: string | null; body: string | null; actor_email: string | null; occurred_at: string }
type Alert = { id: string; recipient: string; channel?: string; state: string; provider_status: string; error_code: string; attempts: number; provider_sid: string }
type Event = { id: string; staff_alerts: Alert[] | null }
type Booking = { id: string; status: string; created_at: string; confirmed_at: string | null; completed_at: string | null; payment_recorded_at: string | null; amount_charged: number | null; payment_method: string | null; customer_id?: string | null; preferred_date?: string | null; confirmed_date?: string | null; agreement_id?: string | null; accepted_quote_snapshot?: unknown; creation_operation_id?: string | null }
type CustomerMatch = { id: string; name: string | null; phone: string | null }
type Result = { success: true; updatedAt: string } | { error: string; conflict?: boolean }

function dateText(value: string) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })
}

function initialMessage(lead: Lead) {
  const firstName = lead.name?.trim().split(/\s+/)[0]
  return `Hi${firstName ? ` ${firstName}` : ''}, this is QuietGreen. Thanks for asking about ${lead.services?.join(', ') || 'lawn care'} at ${lead.address || 'your property'}. When is a good time to talk?`
}

function answerLabel(key: string) {
  const labels: Record<string, string> = { utm_source: 'Source', utm_medium: 'Channel', utm_campaign: 'Campaign', utm_term: 'Search term / ad set tag', utm_content: 'Ad tag', meta_campaign_id: 'Meta campaign', meta_adset_id: 'Meta ad set', meta_ad_id: 'Meta ad', creative_id: 'Creative', creative_type: 'Creative type', google_campaign_id: 'Google campaign', google_adgroup_id: 'Google ad group', google_ad_id: 'Google ad', captured_at: 'Tracked at', source_url: 'Website' }
  if (labels[key]) return labels[key]
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase())
}
function answerText(value: unknown): string {
  if (value == null || value === '') return 'Not supplied'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(answerText).join(', ')
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${answerLabel(key)}: ${answerText(item)}`).join('; ')
  return String(value)
}

export default function LeadWorkspace({ lead, activities, events, bookings, customerMatches = [] }: { lead: Lead; activities: Activity[]; events: Event[]; bookings: Booking[]; customerMatches?: CustomerMatch[] }) {
  const router = useRouter()
  const attribution = lead.attribution && typeof lead.attribution === 'object' && !Array.isArray(lead.attribution) ? lead.attribution as Attribution : {}
  const cleanSource = cleanAttribution(attribution)
  const sourceLabel = formatAttributionLabel(cleanSource.first_touch)
  const answers = lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers) ? Object.entries(lead.answers) : []
  const usefulAnswers = answers.filter(([key]) => !key.startsWith('conviflo_') && !['address_needs_review', 'name', 'phone', 'email', 'address', 'contact'].includes(key))
  const addressNeedsReview = !!lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers)
    && (lead.answers as { address_needs_review?: unknown }).address_needs_review === true
  const [version, setVersion] = useState(lead.updated_at)
  const [draft, setDraft] = useState<QuoteDraft | null>(lead.quote_draft)
  const propertyChanged = !!draft && (draft.contactAddressAtReview !== undefined
    ? draft.contactAddressAtReview !== lead.address
    : activities.some(activity => activity.outcome === 'contact_address_changed' && activity.occurred_at > (lead.quote_saved_at ?? '')))
  const [resetPropertyAddress, setResetPropertyAddress] = useState<string | null>(null)
  const propertyReset = resetPropertyAddress !== null && resetPropertyAddress === lead.address
  const [reviewed, setReviewed] = useState(!!lead.quote_confirmed_at)
  const [quoteStatus, setQuoteStatus] = useState(lead.quote_status)
  const [feedback, setFeedback] = useState('')
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<ContactOutcome>(lead.contact_outcome ?? 'no_answer')
  const [stage, setStage] = useState<LeadStage>(lead.stage as LeadStage)
  const [callNote, setCallNote] = useState('')
  const [note, setNote] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [messageDraft, setMessageDraft] = useState(() => initialMessage(lead))
  const bookingOps = useRef<{ bookingOperationId: string; linkOperationId: string; planOperationId: string } | null>(null)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingDate, setBookingDate] = useState('')
  const [bookingCustomer, setBookingCustomer] = useState('new')
  const [startPlan, setStartPlan] = useState(true)
  const [cancellationPreview, setCancellationPreview] = useState<{
    bookingId: string; bookingStatus: string; agreementId: string | null; agreementUpdatedAt: string | null
    futureJobs: { id: string; date: string | null }[]
  } | null>(null)

  function run(action: () => Promise<Result>, done?: (result: { success: true; updatedAt: string }) => void) {
    setFeedback('')
    startTransition(async () => {
      try {
        const result = await action()
        if ('error' in result) setFeedback(result.error)
        else { setVersion(result.updatedAt); done?.(result); setFeedback('Saved.'); router.refresh() }
      } catch { setFeedback('Could not save. Please try again.') }
    })
  }

  function quoteSummary(quote: QuoteDraft) {
    const firstName = lead.name?.trim().split(/\s+/)[0]
    const total = formatMoney(quoteTotalCents(quote) / 100)
    const repeats = quote.includeMowing !== false && quote.freq !== 'onetime'
    return `Hi${firstName ? ` ${firstName}` : ''}, this is QuietGreen. We reviewed ${lead.address || 'your property'} and the ${lead.services?.join(', ') || 'requested'} service quote is ${total}${repeats ? ' per visit' : ''}. Please reply if you would like to discuss it.`
  }
  function useQuoteSummary() {
    if (!draft || !reviewed) return
    setMessageDraft(quoteSummary(draft))
  }
  function smsHref(body: string) {
    const iOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
    return `sms:${lead.phone}${iOS ? '&' : '?'}body=${encodeURIComponent(body)}`
  }
  const planFreq = draft && draft.includeMowing !== false && draft.freq !== 'onetime' && (draft.overridePrice ?? draft.calculatedPrice) > 0
    ? { weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly' }[draft.freq] : undefined
  const planPrice = draft ? (draft.overridePrice ?? draft.calculatedPrice) : 0
  const booking = latestQuoteBooking(bookings)
  const bookedCustomerId = bookings.find(b => b.customer_id)?.customer_id ?? null

  const firstVisitOpen = !!booking && ['pending', 'confirmed'].includes(booking.status)
  const cancelOps = useRef<{ jobOperationId: string; planOperationId: string } | null>(null)
  function customerCanceled() {
    if (!booking) return
    setFeedback('')
    startTransition(async () => {
      const result = await previewLeadBookingCancellation(lead.id)
      if ('error' in result) { setFeedback(result.error); return }
      setCancellationPreview(result.preview)
    })
  }
  function confirmCancellation() {
    if (!cancellationPreview) return
    cancelOps.current ??= { jobOperationId: crypto.randomUUID(), planOperationId: crypto.randomUUID() }
    const ops = cancelOps.current
    run(() => cancelLeadBooking(lead.id, { ...ops, bookingId: cancellationPreview.bookingId,
      agreementUpdatedAt: cancellationPreview.agreementUpdatedAt,
      futureJobIds: cancellationPreview.futureJobs.map(job => job.id) }), () => {
      cancelOps.current = null; setCancellationPreview(null); setQuoteStatus('canceled'); setStage('lost')
    })
  }

  function submitBooking() {
    if (!bookingOps.current) {
      const key = `qg_book_visit_${lead.id}`
      try { const saved = sessionStorage.getItem(key); if (saved) bookingOps.current = JSON.parse(saved) } catch { /* private browsing */ }
      if (!bookingOps.current) {
        bookingOps.current = { bookingOperationId: crypto.randomUUID(), linkOperationId: crypto.randomUUID(), planOperationId: crypto.randomUUID() }
        try { sessionStorage.setItem(key, JSON.stringify(bookingOps.current)) } catch { /* keep in memory */ }
      }
    }
    const ops = bookingOps.current
    setFeedback('')
    startTransition(async () => {
      try {
        const result = await bookLeadVisit(lead.id, version, { ...ops, date: bookingDate,
          customerId: bookingCustomer === 'new' ? null : bookingCustomer, startPlan: !!planFreq && startPlan && !!bookingDate })
        if ('error' in result) { setFeedback(result.error); return }
        try { sessionStorage.removeItem(`qg_book_visit_${lead.id}`) } catch {}
        bookingOps.current = null
        setVersion(result.updatedAt); setQuoteStatus('accepted'); setStage('booked'); setBookingOpen(false)
        setFeedback(result.planStarted ? 'Visit booked and mowing plan started.' : 'Visit booked.')
        router.refresh()
      } catch { setFeedback('Could not book the visit. Please retry.') }
    })
  }

  const feedbackIsError = feedback.startsWith('Could') || feedback.includes('changed') || feedback.includes('failed')
  const stageTone = quoteStatus === 'accepted' ? 'booked' : stage
  const quoteState = booking && quoteStatus === 'canceled' ? 'canceled'
    : booking && booking.status !== 'canceled' && quoteStatus === 'accepted' ? 'booked'
    : quoteStatus === 'accepted' ? 'accepted' : quoteStatus === 'declined' ? 'declined'
      : reviewed && draft ? 'quoted' : draft ? 'draft' : 'none'
  const quoteLabel = { booked: 'Booked', canceled: 'Canceled after booking', accepted: 'Customer said yes', declined: 'Customer said no', quoted: 'Quoted', draft: 'Draft — not given yet', none: 'No price yet' }[quoteState]
  const alerts = events.flatMap(event => (event.staff_alerts ?? []).map(alert => ({ alert, event })))

  return <>
    <div className="crm-workspace">
      <Link className="crm-back" href="/admin/leads"><Icon name="arrowLeft" size={15} />Leads</Link>
      <div className="crm-workspace-head">
        <div>
          <div className="crm-workspace-title">
            <h1>{lead.name || 'Name not supplied'}</h1>
            <span className={`crm-chip crm-chip-${stageTone}`}>{quoteState === 'canceled' ? 'Canceled' : stage}</span>
          </div>
          <p className="crm-property"><Icon name="map" size={16} />{lead.address || 'Address not yet provided'}</p>
          <div className="crm-head-meta">
            <span>Received {dateText(lead.created_at)}</span>
            <span>{lead.source || 'Source unknown'}</span>
            {sourceLabel && <span style={{ overflowWrap: 'anywhere' }}>{sourceLabel}</span>}
          </div>
        </div>
        <div className="crm-head-actions">
          <a className="crm-button crm-button-primary" href={`tel:${lead.phone}`} aria-label={`Call ${formatPhone(lead.phone)}`}><Icon name="phone" size={16} />Call</a>
          <a className="crm-button" href={`sms:${lead.phone}?body=${encodeURIComponent(messageDraft)}`} aria-label="Open Messages"
            onClick={event => { if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) event.currentTarget.href = `sms:${lead.phone}&body=${encodeURIComponent(messageDraft)}` }}><Icon name="message" size={16} />Text</a>
          <a className="crm-button" href="#map-quote"><Icon name="ruler" size={16} />Build quote</a>
        </div>
      </div>
      {(addressNeedsReview || propertyChanged) && <p className="crm-review-flag" role="alert">{propertyChanged ? 'Contact address changed. The saved quote still belongs to the previous address; review the property before quoting or booking.' : 'Submitted address needs review. Select the matching property in the map before using its measurement.'}</p>}
      <div className="crm-workspace-grid">
        <div className="crm-workspace-main">
          <section className="crm-panel crm-sec-request">
            <h2>Request</h2>
            <div className="crm-request">
              <div><span>Services</span><strong>{(lead.services ?? []).join(', ') || 'Services unknown'}</strong></div>
              <div><span>Frequency</span><strong>{lead.frequency || 'Unknown'}</strong></div>
              <div><span>Timing</span><strong>{lead.timing || 'Unknown'}</strong></div>
            </div>
            <p className="crm-hint">Opening Phone or Messages does not record a connected call or sent text.</p>
          </section>
          <section className="crm-panel crm-sec-respond">
            <h2>Respond</h2>
            <details className="crm-details"><summary>Update lead and follow-up</summary>
              <h3>Record call outcome</h3>
              <div className="crm-inline-fields">
                <label className="crm-field">Outcome
                  <select value={outcome} onChange={event => setOutcome(event.target.value as ContactOutcome)}>
                    <option value="no_answer">No answer</option><option value="reached">Reached</option><option value="wrong_number">Wrong number</option>
                  </select>
                </label>
                <label className="crm-field">Note (optional)
                  <input value={callNote} maxLength={2000} onChange={event => setCallNote(event.target.value)} placeholder="What happened?" />
                </label>
              </div>
              <button type="button" className="crm-button" disabled={pending} onClick={() => run(() => recordLeadCall(lead.id, version, outcome, callNote), () => setCallNote(''))}>Save call outcome</button>
              <h3>Pipeline stage</h3>
              <div className="crm-inline-fields">
                <label className="crm-field">Pipeline stage
                  <select value={stage} onChange={event => setStage(event.target.value as LeadStage)}>
                    <option value="new">New</option><option value="contacted">Contacted</option><option value="quoted">Quoted</option>
                    <option value="lost">Lost</option>{stage === 'booked' && <option value="booked">Booked</option>}
                  </select>
                </label>
                <div className="crm-action-row"><button type="button" className="crm-button" disabled={pending || stage === 'booked'} onClick={() => run(() => setLeadStage(lead.id, version, stage))}>Save stage</button></div>
              </div>
              <h3>Follow up</h3>
              {lead.follow_up_at && <p className="crm-muted">Currently set for {dateText(lead.follow_up_at)}</p>}
              <div className="crm-inline-fields">
                <label className="crm-field">Date and time
                  <input type="datetime-local" value={followUp} onChange={event => setFollowUp(event.target.value)} />
                </label>
                <div className="crm-action-row">
                  <button type="button" className="crm-button" disabled={pending || !followUp} onClick={() => run(() => setLeadFollowUp(lead.id, version, new Date(followUp).toISOString()))}>Set follow-up</button>
                  {lead.follow_up_at && <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadFollowUp(lead.id, version, null))}>Clear</button>}
                </div>
              </div>
              <h3>Staff note</h3>
              <label className="crm-field">Note<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
              <button type="button" className="crm-button" disabled={pending || !note.trim()} onClick={() => run(() => addLeadNote(lead.id, version, note), () => setNote(''))}>Add note</button>
            </details>
            <details className="crm-details"><summary>Edit and copy message draft</summary>
              <label className="crm-field">Editable message draft
                <textarea value={messageDraft} maxLength={1200} onChange={event => setMessageDraft(event.target.value)} />
              </label>
              <div className="crm-action-row">
                <button type="button" className="crm-button" onClick={async () => {
                  try { await navigator.clipboard.writeText(messageDraft); setFeedback('Message copied. Paste it in Messages if it did not appear there.') }
                  catch { setFeedback('Copy failed. Select the draft text and copy it manually.') }
                }}>Copy message</button>
                {reviewed && draft && <button type="button" className="crm-button" onClick={useQuoteSummary}>Use quote summary</button>}
              </div>
            </details>
            <details className="crm-details"><summary>Activity ({activities.length})</summary>
              {activities.length ? activities.map(activity => <div className="crm-activity" key={activity.id}>
                <span>{activity.kind}{activity.outcome ? ` · ${activity.outcome.replaceAll('_', ' ')}` : ''}{activity.body ? ` — ${activity.body}` : ''}</span>
                <small>{dateText(activity.occurred_at)} · {activity.actor_email || 'Staff'}</small>
              </div>) : <p className="crm-muted">No staff activity recorded yet.</p>}
            </details>
          </section>
        </div>
        <div className="crm-workspace-side">
          <section className="crm-panel crm-sec-quote">
            <h2>Quote <span className={`crm-chip crm-chip-${{ booked: 'booked', canceled: 'lost', accepted: 'booked', declined: 'lost', quoted: 'quoted', draft: 'new', none: 'contacted' }[quoteState]}`}>{quoteLabel}</span></h2>
            {draft ? <p className="crm-quote-total">{formatMoney(quoteTotalCents(draft) / 100)}<small>{draft.includeMowing !== false && draft.freq !== 'onetime' ? 'per visit' : 'total'}</small></p>
              : <p className="crm-muted">Build the price in the Price box below.</p>}
            {quoteState === 'draft' && <p className="crm-hint">Click “Save as quoted” in the Price box once you’ve given them this price.</p>}

            {(quoteState === 'quoted' || quoteState === 'accepted' || quoteState === 'canceled') && !bookingOpen && !propertyChanged && <div className="crm-action-row">
              <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={() => setBookingOpen(true)}>{quoteState === 'canceled' ? 'Book again' : 'Book visit'}</button>
              {draft && quoteState !== 'canceled' && <a className="crm-button" href={smsHref(quoteSummary(draft))}><Icon name="message" size={15} />Text price</a>}
              {quoteState === 'quoted' && <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'declined'), () => setQuoteStatus('declined'))}>Customer said no</button>}
              {quoteState === 'accepted' && <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'canceled'), () => setQuoteStatus('canceled'))}>Cancel acceptance</button>}
            </div>}
            {quoteState === 'accepted' && propertyChanged && <div className="crm-action-row">
              <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'canceled'), () => setQuoteStatus('canceled'))}>Cancel acceptance</button>
            </div>}

            {bookingOpen && !propertyChanged && <div className="crm-booking-request">
              <h3>Book the first visit</h3>
              <label className="crm-field">Visit date (optional — you can schedule it later)<input type="date" value={bookingDate} onChange={event => setBookingDate(event.target.value)} /></label>
              <div className="crm-field" role="radiogroup" aria-label="Customer">Customer
                <label className="crm-radio"><input type="radio" name="booking-customer" checked={bookingCustomer === 'new'} onChange={() => setBookingCustomer('new')} />New customer: {lead.name || formatPhone(lead.phone)}</label>
                {customerMatches.map(match => <label className="crm-radio" key={match.id}><input type="radio" name="booking-customer" checked={bookingCustomer === match.id} onChange={() => setBookingCustomer(match.id)} />Existing customer (same phone): {match.name || formatPhone(match.phone)}</label>)}
              </div>
              {planFreq && <label className="crm-check"><input type="checkbox" checked={startPlan && !!bookingDate} disabled={!bookingDate} onChange={event => setStartPlan(event.target.checked)} />
                <span>Start {planFreq.toLowerCase()} mowing plan at {formatMoney(planPrice)}/visit{bookingDate ? '' : ' (pick a visit date first)'}</span></label>}
              <div className="crm-action-row">
                <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={submitBooking}>Confirm booking</button>
                <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setBookingOpen(false)}>Cancel</button>
              </div>
            </div>}

            {quoteState === 'declined' && <div className="crm-action-row">
              <button type="button" className="crm-button" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'draft'), () => setQuoteStatus('draft'))}>Reopen quote</button>
            </div>}

            {quoteState === 'booked' && <div className="crm-booked">
              <p>{booking?.confirmed_date ? `Scheduled ${booking.confirmed_date}` : booking?.preferred_date ? `Requested ${booking.preferred_date}` : 'Visit needs a date'} · this lead is done. Later work starts from the customer.</p>
              <div className="crm-action-row">
                {bookedCustomerId && <Link className="crm-button crm-button-primary" href={`/admin/customers/${bookedCustomerId}`}>Open customer</Link>}
                <Link className="crm-button" href={`/admin?search=${encodeURIComponent(lead.name ?? lead.phone)}`}>Open job</Link>
                {firstVisitOpen && <button type="button" className="crm-button crm-button-ghost crm-button-danger" disabled={pending} onClick={customerCanceled}>Customer canceled</button>}
              </div>
              {cancellationPreview && <div className="crm-booking-request" role="group" aria-label="Review cancellation">
                <p>Cancel this quoted visit and mark its quote canceled? History is kept.</p>
                {cancellationPreview.agreementId && <p>End the mowing plan and cancel these {cancellationPreview.futureJobs.length} upcoming unfinished visit{cancellationPreview.futureJobs.length === 1 ? '' : 's'}:</p>}
                {cancellationPreview.futureJobs.length > 0 && <ul>{cancellationPreview.futureJobs.map((job, index) => <li key={job.id}>Visit {index + 1} · {job.date ? new Date(`${job.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date not set'}</li>)}</ul>}
                <div className="crm-action-row">
                  <button type="button" className="crm-button crm-button-danger" disabled={pending} onClick={confirmCancellation}>Confirm cancellation</button>
                  <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => { setCancellationPreview(null); cancelOps.current = null }}>Keep visit</button>
                </div>
              </div>}
            </div>}

            {quoteState === 'canceled' && <p className="crm-hint">They said yes at this price, then canceled before the first visit. The canceled visit and price stay in history.</p>}

            {bookings.length > 0 && <details className="crm-details"><summary>Booking stages ({bookings.length})</summary>
              {bookings.map(booking => <p key={booking.id}>{booking.status} · Requested {dateText(booking.created_at)}
                {booking.confirmed_at && ` · Confirmed ${dateText(booking.confirmed_at)}`}
                {booking.completed_at && ` · Completed ${dateText(booking.completed_at)}`}
                {booking.payment_recorded_at && ` · Payment recorded ${dateText(booking.payment_recorded_at)}: $${booking.amount_charged ?? 0} (${booking.payment_method})`}</p>)}
            </details>}
          </section>
          <section className="crm-panel crm-sec-contact">
            <h2>Contact</h2>
            <div className="crm-contact-list">
              <a href={`tel:${lead.phone}`}><Icon name="phone" size={15} />{formatPhone(lead.phone)}</a>
              {lead.email && <a href={`mailto:${lead.email}`}><Icon name="mail" size={15} />{lead.email}</a>}
            </div>
            <details className="crm-details" style={{ marginTop: 12 }}><summary>Edit contact</summary>
              <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('updated_at', version); run(() => updateLeadContact(lead.id, form)) }}>
                <label className="crm-field">Name<input name="name" defaultValue={lead.name ?? ''} required maxLength={150} /></label>
                <label className="crm-field">Phone<input name="phone" type="tel" defaultValue={lead.phone} required maxLength={30} /></label>
                <label className="crm-field">Property address<input name="address" defaultValue={lead.address ?? ''} required maxLength={500} /></label>
                <label className="crm-field">Email<input name="email" type="email" defaultValue={lead.email ?? ''} maxLength={254} /></label>
                <button type="submit" className="crm-button" disabled={pending}>Save contact</button>
              </form>
            </details>
            <details className="crm-details"><summary>Answers and acquisition details</summary>
              <h3>What they requested</h3>
              <p>{lead.services?.join(', ') || 'Services not supplied'}</p>
              <dl className="crm-readable-details">{usefulAnswers.map(([key, value]) => <div key={key}><dt>{answerLabel(key)}</dt><dd>{answerText(value)}</dd></div>)}</dl>
              {usefulAnswers.length === 0 && <p className="crm-muted">No additional answers submitted.</p>}
              {[['First tracked visit', cleanSource.first_touch], ['Latest tracked visit', cleanSource.latest_touch]].map(([title, touch]) => <div key={String(title)}>
                <h3>{String(title)}</h3>
                {touch && typeof touch === 'object' && <p>{formatAttributionLabel(touch)}</p>}
                {touch && typeof touch === 'object' ? <dl className="crm-readable-details">{Object.entries(touch).map(([key, value]) => <div key={key}><dt>{answerLabel(key)}</dt><dd>{answerText(key === 'creative_type' ? creativeTypeLabel(value) : value)}</dd></div>)}</dl> : <p className="crm-muted">Unknown</p>}
              </div>)}
              {lead.estimated_value != null && <p>Estimated potential value: ${String(lead.estimated_value)} · time horizon unknown</p>}
              <p>Contact consent: {lead.consent == null ? 'Not recorded' : lead.consent ? 'Granted' : 'Not granted'}{lead.consented_at && ` · ${dateText(lead.consented_at)}`}</p>
              {lead.consent_text && <p className="crm-muted">{lead.consent_text}</p>}
              <p className="crm-muted">Potential value is separate from quotes and payments. Missing source details remain unknown.</p>
            </details>
            <details className="crm-details"><summary>Staff alerts</summary>
              {alerts.length === 0 && <p className="crm-muted">No staff alerts recorded.</p>}
              {alerts.map(({ alert, event }) => <div key={alert.id} className="crm-alert-row">
                <p>{alert.recipient || 'Recipient not configured'} · {alert.channel || 'sms'} · {alert.state} {alert.provider_status && `(${alert.provider_status})`} · {alert.attempts} attempts {alert.error_code && `· ${alert.error_code}`}</p>
                {alert.provider_sid ? <form action={processLeadAlert.bind(null, lead.id, alert.id, event.id, 'refresh')}><button className="crm-button crm-button-sm">Check delivery</button></form>
                  : ['pending','disabled','failed'].includes(alert.state) ? <form action={processLeadAlert.bind(null, lead.id, alert.id, event.id, 'retry')}><button className="crm-button crm-button-sm">Retry staff alert</button></form>
                  : <p>Check provider logs before resending; acceptance is uncertain.</p>}
              </div>)}
            </details>
          </section>
        </div>
      </div>
      {feedback && <div className={`crm-toast${feedbackIsError ? ' crm-toast-error' : ''}`} role={feedbackIsError ? 'alert' : 'status'}>
        <span>{feedback}</span>
        <button type="button" aria-label="Dismiss" onClick={() => setFeedback('')}>×</button>
      </div>}
    </div>
    <div className="crm-quote-wrap">
      {propertyChanged && !propertyReset ? <div className="crm-panel" id="map-quote">
        <h2>Start a quote for the updated address</h2>
        <p>The previous measurement and price belong to the old property. Start fresh for {lead.address}. Previous accepted quotes and jobs stay in history.</p>
        <div className="crm-action-row">
          <button className="crm-button crm-button-primary" disabled={pending || quoteStatus === 'accepted'} onClick={() => { setResetPropertyAddress(lead.address); setReviewed(false) }}>Start quote for updated address</button>
        </div>
        {quoteStatus === 'accepted' && <p className="crm-hint">Cancel acceptance above before starting the new quote.</p>}
      </div> : <MapQuoteBuilder key={propertyReset ? `reset-${resetPropertyAddress}` : 'saved-property'} staffQuote={{ id: lead.id, address: lead.address, sq_ft: propertyReset ? null : lead.sq_ft, services: lead.services ?? [], frequency: lead.frequency,
        draft: propertyReset ? null : draft, updated_at: version, quote_status: quoteStatus, addressNeedsReview: addressNeedsReview || propertyChanged,
        onSaved: (updatedAt, wasReviewed, savedDraft) => { setVersion(updatedAt); setDraft(savedDraft); setReviewed(wasReviewed); setQuoteStatus('draft'); if (wasReviewed) setStage('quoted'); router.refresh() } }} />}
    </div>
  </>
}
