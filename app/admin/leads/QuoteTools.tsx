'use client'

import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import { createContext, useContext, useRef, useState, useTransition } from 'react'
import Icon from '../icons'
import { useRouter } from 'next/navigation'
import { addressForLookup } from '@/lib/address-text'
import MapQuoteBuilder from '@/components/MapQuoteBuilder'
import { tracedShapes } from './TracingMap'
import { quoteTotalCents, type QuoteDraft } from '@/lib/quote-draft'
import { frequencyLabel, quoteOffer } from '@/lib/quote-offer'
import { formatMoney } from '@/lib/crm-jobs'
import { addLeadNote, bookLeadVisit, cancelLeadBooking, emailLeadQuote, previewLeadBookingCancellation, setLeadQuoteDecision, updateLeadContact } from './quote-actions'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import type { QuoteStatus } from '@/lib/crm-contracts'
import { uuid } from '@/lib/uuid'

/**
 * The existing quote tools (price, Book visit, Email quote, Text price, Customer said no, Reopen,
 * customer linking), relocated onto lead page v2. The panel and the staff map share one quote state.
 */
export type QuoteLead = {
  id: string; name: string | null; phone: string; email: string | null; address: string | null
  sq_ft: number | null; services: string[] | null; frequency: string | null
  updated_at: string; quote_saved_at: string | null; quote_confirmed_at: string | null
  quote_status: QuoteStatus; quote_draft: QuoteDraft | null; answers: unknown
  /** The customer's website tracing; seeds the staff map when there is no saved quote yet. */
  lawn_tracing?: unknown
}
export type QuoteActivity = { outcome: string | null; occurred_at: string }
export type QuoteBooking = { id: string; status: string; created_at: string; confirmed_at: string | null; completed_at: string | null; payment_recorded_at: string | null; amount_charged: number | null; payment_method: string | null; customer_id?: string | null; preferred_date?: string | null; confirmed_date?: string | null; agreement_id?: string | null; accepted_quote_snapshot?: unknown; creation_operation_id?: string | null }
type CustomerMatch = { id: string; name: string | null; phone: string | null }
type Result = { success: true; updatedAt: string } | { error: string; conflict?: boolean }

type QuoteState = {
  lead: QuoteLead; activities: QuoteActivity[]; bookings: QuoteBooking[]; customerMatches: CustomerMatch[]; quoteUrl: string | null
  version: string; setVersion: (v: string) => void; draft: QuoteDraft | null; setDraft: (d: QuoteDraft | null) => void
  reviewed: boolean; setReviewed: (v: boolean) => void; quoteStatus: QuoteStatus; setQuoteStatus: (s: QuoteStatus) => void
  propertyChanged: boolean; addressNeedsReview: boolean
  feedback: string; setFeedback: (text: string) => void
}
const Quote = createContext<QuoteState | null>(null)
const useQuote = () => useContext(Quote)!

function dateText(value: string) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })
}

export function QuoteProvider({ lead, activities, bookings, customerMatches = [], quoteUrl = null, children }: {
  lead: QuoteLead; activities: QuoteActivity[]; bookings: QuoteBooking[]; customerMatches?: CustomerMatch[]; quoteUrl?: string | null; children: React.ReactNode
}) {
  const [version, setVersion] = useState(lead.updated_at)
  const [draft, setDraft] = useState<QuoteDraft | null>(lead.quote_draft)
  const [reviewed, setReviewed] = useState(!!lead.quote_confirmed_at)
  const [quoteStatus, setQuoteStatus] = useState(lead.quote_status)
  const [feedback, setFeedback] = useState('')
  // A Log call or board move refreshes this page with a newer updated_at. Adopt it when the quote
  // on screen is still the server's, so the next quote save isn't refused as a conflict.
  const [seenVersion, setSeenVersion] = useState(lead.updated_at)
  if (lead.updated_at !== seenVersion) {
    setSeenVersion(lead.updated_at)
    if (lead.updated_at > version && JSON.stringify(lead.quote_draft) === JSON.stringify(draft)) setVersion(lead.updated_at)
  }
  const propertyChanged = !!draft && (draft.contactAddressAtReview !== undefined
    ? draft.contactAddressAtReview !== lead.address
    : activities.some(activity => activity.outcome === 'contact_address_changed' && activity.occurred_at > (lead.quote_saved_at ?? '')))
  const addressNeedsReview = !!lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers)
    && (lead.answers as { address_needs_review?: unknown }).address_needs_review === true
  const feedbackIsError = feedback.startsWith('Could') || feedback.includes('changed') || feedback.includes('failed') || feedback.startsWith('Enter') || feedback.startsWith('The ')
  return <Quote.Provider value={{ lead, activities, bookings, customerMatches, quoteUrl, version, setVersion, draft, setDraft, reviewed, setReviewed,
    quoteStatus, setQuoteStatus, propertyChanged, addressNeedsReview, feedback, setFeedback }}>
    {children}
    {feedback && <div className={`crm-toast${feedbackIsError ? ' crm-toast-error' : ''}`} role={feedbackIsError ? 'alert' : 'status'}>
      <span>{feedback}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setFeedback('')}>×</button>
    </div>}
  </Quote.Provider>
}

function useRun() {
  const router = useRouter()
  const { setFeedback, setVersion } = useQuote()
  const [pending, startTransition] = useTransition()
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
  return { run, pending, startTransition, router }
}

/** Quote status + the actions that depend on it (desktop right column, phone after Log call). */
export function QuotePanel() {
  const { lead, bookings, customerMatches, quoteUrl, version, setVersion, draft, reviewed, quoteStatus, setQuoteStatus, propertyChanged, setFeedback } = useQuote()
  const { run, pending, startTransition, router } = useRun()
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState(lead.email ?? '')
  const [emailBody, setEmailBody] = useState('')
  const bookingOps = useRef<{ bookingOperationId: string; linkOperationId: string; planOperationId: string } | null>(null)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingDate, setBookingDate] = useState('')
  const [bookingCustomer, setBookingCustomer] = useState('new')
  const [startPlan, setStartPlan] = useState(true)
  const [cancellationPreview, setCancellationPreview] = useState<{
    bookingId: string; bookingStatus: string; agreementId: string | null; agreementUpdatedAt: string | null
    futureJobs: { id: string; date: string | null }[]
  } | null>(null)

  // Follow-up after the phone call: recap the agreed price and ask for the booking.
  function quoteSummary(quote: QuoteDraft) {
    const firstName = lead.name?.trim().split(/\s+/)[0]
    const offer = quoteOffer(quote)
    const quoted = offer.options.find(o => o.freq === offer.quoted) ?? offer.options[0]
    const dollars = (value: number) => Number.isInteger(value) ? `$${value}` : formatMoney(value)
    const price = dollars(quoted.price)
    const deal = offer.recurring && quoted.freq !== 'onetime'
      ? `${frequencyLabel(quoted.freq).toLowerCase()} mowing is ${price} a visit${quoted.firstVisit !== quoted.price ? `, and your first visit is just ${dollars(quoted.firstVisit)}` : ''}`
      : `your ${lead.services?.join(' + ').toLowerCase() || 'job'} comes to ${price}`
    const measured = offer.sqFt ? `Your lawn measured ${offer.sqFt.toLocaleString('en-US')} sq ft, so ` : 'So '
    const close = quoteUrl ? `Lock in your spot and pick your start date here (takes 30 seconds): ${quoteUrl}` : 'Just reply YES and we’ll get you on the schedule.'
    return `Hi${firstName ? ` ${firstName}` : ''}, QuietGreen here, great talking with you! ${measured}${deal}. ${close}`
  }
  function openEmail() {
    if (!draft) return
    const sqFt = draft.sections.reduce((sum, section) => sum + (Number(section.sqFt) || 0), 0)
    const firstName = lead.name?.trim().split(/\s+/)[0]
    const offer = quoteOffer(draft)
    setEmailBody(`Hi${firstName ? ` ${firstName}` : ''},\n\nGreat talking with you today! We measured your lawn${sqFt ? ` at ${sqFt.toLocaleString('en-US')} sq ft` : ''}, and your price is below${offer.recurring ? ', with your first visit 30% off' : ''}.\n\n${quoteUrl ? 'Tap “Review & book” to lock in your spot and pick your start date. It takes about 30 seconds, and you’ll get a confirmation right away.' : 'Reply to this email and we’ll get you on the schedule.'}\n\nTalk soon,\nQuietGreen`)
    setEmailOpen(true)
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
    cancelOps.current ??= { jobOperationId: uuid(), planOperationId: uuid() }
    const ops = cancelOps.current
    run(() => cancelLeadBooking(lead.id, { ...ops, bookingId: cancellationPreview.bookingId,
      agreementUpdatedAt: cancellationPreview.agreementUpdatedAt,
      futureJobIds: cancellationPreview.futureJobs.map(job => job.id) }), () => {
      cancelOps.current = null; setCancellationPreview(null); setQuoteStatus('canceled')
    })
  }
  function submitBooking() {
    if (!bookingOps.current) {
      const key = `qg_book_visit_${lead.id}`
      try { const saved = sessionStorage.getItem(key); if (saved) bookingOps.current = JSON.parse(saved) } catch { /* private browsing */ }
      if (!bookingOps.current) {
        bookingOps.current = { bookingOperationId: uuid(), linkOperationId: uuid(), planOperationId: uuid() }
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
        setVersion(result.updatedAt); setQuoteStatus('accepted'); setBookingOpen(false)
        setFeedback(result.planStarted ? 'Visit booked and mowing plan started.' : 'Visit booked.')
        router.refresh()
      } catch { setFeedback('Could not book the visit. Please retry.') }
    })
  }

  const quoteState = booking && quoteStatus === 'canceled' ? 'canceled'
    : booking && booking.status !== 'canceled' && quoteStatus === 'accepted' ? 'booked'
    : quoteStatus === 'accepted' ? 'accepted' : quoteStatus === 'declined' ? 'declined'
      : reviewed && draft ? 'quoted' : draft ? 'draft' : 'none'
  const quoteLabel = { booked: 'Booked', canceled: 'Canceled', accepted: 'Accepted', declined: 'Said no', quoted: 'Quoted', draft: 'Draft', none: 'None yet' }[quoteState]
  const tone = { booked: 'booked', canceled: 'lost', accepted: 'booked', declined: 'lost', quoted: 'quoted', draft: 'new', none: 'lost' }[quoteState]

  return <section className="crm-block crm-quote-panel" aria-label="Quote">
    <p className="crm-block-head"><span>Saved quote</span><span className={`crm-chip crm-chip-${tone}`}>{quoteLabel}</span></p>
    {draft ? <p className="crm-quote-total">{formatMoney(quoteTotalCents(draft) / 100)}<small>{draft.includeMowing !== false && draft.freq !== 'onetime' ? '/ visit' : 'total'}</small></p>
      : <p className="crm-quote-total">—</p>}
    {draft && quoteState === 'draft' && !emailOpen && <div className="crm-action-row">
      <a className="crm-button" href={smsHref(quoteSummary(draft))}><Icon name="message" size={15} />Text price</a>
      <button type="button" className="crm-button" onClick={openEmail}><Icon name="mail" size={15} />Email quote</button>
    </div>}
    {draft && emailOpen && <div className="crm-booking-request">
      <h3>Email quote</h3>
      <label className="crm-field">To<input type="email" value={emailTo} maxLength={254} onChange={event => setEmailTo(event.target.value)} placeholder="customer@example.com" /></label>
      <label className="crm-field">Message<textarea value={emailBody} maxLength={4000} rows={6} onChange={event => setEmailBody(event.target.value)} /></label>
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || !emailTo.trim()} onClick={() => { setFeedback(''); startTransition(async () => {
          try {
            const result = await emailLeadQuote(lead.id, version, emailTo, emailBody)
            if ('error' in result) setFeedback(result.error)
            else { setVersion(result.updatedAt); setEmailOpen(false); setFeedback(`Quote emailed to ${emailTo.trim()}.`); router.refresh() }
          } catch { setFeedback('The email could not be sent. Please try again.') }
        }) }}><Icon name="mail" size={15} />Send quote</button>
        <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setEmailOpen(false)}>Cancel</button>
      </div>
    </div>}

    {(quoteState === 'quoted' || quoteState === 'accepted' || quoteState === 'canceled') && !bookingOpen && !propertyChanged && <div className="crm-action-row">
      <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={() => setBookingOpen(true)}>{quoteState === 'canceled' ? 'Book again' : 'Book visit'}</button>
      {draft && quoteState !== 'canceled' && <a className="crm-button" href={smsHref(quoteSummary(draft))}><Icon name="message" size={15} />Text price</a>}
      {draft && quoteState !== 'canceled' && !emailOpen && <button type="button" className="crm-button" onClick={openEmail}><Icon name="mail" size={15} />Email quote</button>}
      {quoteState === 'quoted' && <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'declined'), () => setQuoteStatus('declined'))}>Customer said no</button>}
      {quoteState === 'accepted' && <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'canceled'), () => setQuoteStatus('canceled'))}>Cancel acceptance</button>}
    </div>}
    {quoteState === 'accepted' && propertyChanged && <div className="crm-action-row">
      <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'canceled'), () => setQuoteStatus('canceled'))}>Cancel acceptance</button>
    </div>}

    {bookingOpen && !propertyChanged && <div className="crm-booking-request">
      <h3>First visit</h3>
      <label className="crm-field">Visit date (optional)<input type="date" value={bookingDate} onChange={event => setBookingDate(event.target.value)} /></label>
      <div className="crm-field" role="radiogroup" aria-label="Customer">Customer
        <label className="crm-radio"><input type="radio" name="booking-customer" checked={bookingCustomer === 'new'} onChange={() => setBookingCustomer('new')} />New · {lead.name || formatPhone(lead.phone)}</label>
        {customerMatches.map(match => <label className="crm-radio" key={match.id}><input type="radio" name="booking-customer" checked={bookingCustomer === match.id} onChange={() => setBookingCustomer(match.id)} />Existing (same phone) · {match.name || formatPhone(match.phone)}</label>)}
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
      <dl className="crm-kv"><dt>Visit</dt><dd>{booking?.confirmed_date ? `Scheduled ${booking.confirmed_date}` : booking?.preferred_date ? `Requested ${booking.preferred_date}` : '—'}</dd></dl>
      <div className="crm-action-row">
        {bookedCustomerId && <Link className="crm-button crm-button-primary" href={`/admin/customers/${bookedCustomerId}`}>Open customer</Link>}
        <Link className="crm-button" href={`/admin/jobs?search=${encodeURIComponent(lead.name ?? lead.phone)}`}>Open job</Link>
        {firstVisitOpen && <button type="button" className="crm-button crm-button-ghost crm-button-danger" disabled={pending} onClick={customerCanceled}>Customer canceled</button>}
      </div>
      {cancellationPreview && <div className="crm-booking-request" role="group" aria-label="Review cancellation">
        <p>Cancel this visit and mark the quote canceled? History is kept.</p>
        {cancellationPreview.agreementId && <p>Ends the mowing plan and cancels {cancellationPreview.futureJobs.length} upcoming visit{cancellationPreview.futureJobs.length === 1 ? '' : 's'}:</p>}
        {cancellationPreview.futureJobs.length > 0 && <ul>{cancellationPreview.futureJobs.map((job, index) => <li key={job.id}>Visit {index + 1} · {job.date ? new Date(`${job.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</li>)}</ul>}
        <div className="crm-action-row">
          <button type="button" className="crm-button crm-button-danger" disabled={pending} onClick={confirmCancellation}>Confirm cancellation</button>
          <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => { setCancellationPreview(null); cancelOps.current = null }}>Keep visit</button>
        </div>
      </div>}
    </div>}

    {bookings.length > 0 && <details className="crm-details"><summary>Visits ({bookings.length})</summary>
      {bookings.map(b => <p key={b.id}>{b.status} · requested {dateText(b.created_at)}
        {b.confirmed_at && ` · confirmed ${dateText(b.confirmed_at)}`}
        {b.completed_at && ` · completed ${dateText(b.completed_at)}`}
        {b.payment_recorded_at && ` · paid ${dateText(b.payment_recorded_at)}: $${b.amount_charged ?? 0} (${b.payment_method})`}</p>)}
    </details>}
    <ContactAndNote />
  </section>
}

function ContactAndNote() {
  const { lead, version } = useQuote()
  const { run, pending } = useRun()
  const [note, setNote] = useState('')
  return <>
    <details className="crm-details"><summary>Edit contact</summary>
      <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('updated_at', version); run(() => updateLeadContact(lead.id, form)) }}>
        <label className="crm-field">Name<input name="name" defaultValue={lead.name ?? ''} required maxLength={150} /></label>
        <label className="crm-field">Phone<input name="phone" type="tel" defaultValue={lead.phone} required maxLength={30} /></label>
        <label className="crm-field">Property address<input name="address" defaultValue={lead.address ?? ''} required maxLength={500} /></label>
        <label className="crm-field">Email<input name="email" type="email" defaultValue={lead.email ?? ''} maxLength={254} /></label>
        <button type="submit" className="crm-button" disabled={pending}>Save contact</button>
      </form>
    </details>
    <details className="crm-details"><summary>Add note</summary>
      <label className="crm-field">Note<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
      <button type="button" className="crm-button" disabled={pending || !note.trim()} onClick={() => run(() => addLeadNote(lead.id, version, note), () => setNote(''))}>Add note</button>
    </details>
  </>
}

/** The staff map quote builder (desktop: right column under the map; phone: after Details). */
export function QuoteMap() {
  const { lead, version, setVersion, draft, setDraft, setReviewed, quoteStatus, setQuoteStatus, propertyChanged, addressNeedsReview } = useQuote()
  const router = useRouter()
  const [resetPropertyAddress, setResetPropertyAddress] = useState<string | null>(null)
  const propertyReset = resetPropertyAddress !== null && resetPropertyAddress === lead.address
  const answers = lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers) ? lead.answers as { postcode?: unknown; property_address?: unknown } : {}
  const lookupAddress = addressForLookup(lead.address ?? '', answers.property_address, answers.postcode)
  return <div className="crm-quote-wrap">
    {propertyChanged && !propertyReset ? <div className="crm-panel" id="map-quote">
      <h2>Contact address changed</h2>
      <p>The saved measurement and price belong to the old property. Accepted quotes and jobs stay in history.</p>
      <div className="crm-action-row">
        <button className="crm-button crm-button-primary" disabled={quoteStatus === 'accepted'} onClick={() => { setResetPropertyAddress(lead.address); setReviewed(false) }}>Start quote for updated address</button>
      </div>
      {quoteStatus === 'accepted' && <p className="crm-hint">Cancel acceptance first.</p>}
    </div> : <MapQuoteBuilder key={propertyReset ? `reset-${resetPropertyAddress}` : 'saved-property'} staffQuote={{ id: lead.id, address: lead.address, lookupAddress, sq_ft: propertyReset ? null : lead.sq_ft, services: lead.services ?? [], frequency: lead.frequency,
      draft: propertyReset ? null : draft, updated_at: version, quote_status: quoteStatus, addressNeedsReview: addressNeedsReview || propertyChanged,
      onSaved: (updatedAt, wasReviewed, savedDraft) => { setVersion(updatedAt); setDraft(savedDraft); setReviewed(wasReviewed); setQuoteStatus('draft'); router.refresh() } }}
      staffTracing={propertyReset || propertyChanged ? undefined : tracedShapes(lead.lawn_tracing)} />}
  </div>
}
