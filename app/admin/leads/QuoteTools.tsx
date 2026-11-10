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
import { frequencyLabel, quoteOffer, type OfferFrequency } from '@/lib/quote-offer'
import { emailMoney, MAP_CID, validateQuoteEmailOptions, type QuoteEmailOptions } from '@/lib/quote-email'
import { renderLawnMapImage } from './lawn-map-image'
import { formatMoney } from '@/lib/crm-jobs'
import { addLeadNote, requestStaffQuoteVisit, cancelLeadBooking, emailLeadQuote, previewLeadBookingCancellation, previewLeadQuote, retryLeadQuote, setLeadQuoteDecision, updateLeadContact } from './quote-actions'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import type { SentOfferSummary } from '@/lib/sent-offer'
import type { QuoteStatus } from '@/lib/crm-contracts'
import { uuid } from '@/lib/uuid'
import Sheet from './Sheet'

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
type Result = { success: true; updatedAt: string } | { error: string; conflict?: boolean }

type QuoteState = {
  lead: QuoteLead; activities: QuoteActivity[]; bookings: QuoteBooking[]; sentOffers: SentOfferSummary[]
  version: string; setVersion: (v: string) => void; draft: QuoteDraft | null; setDraft: (d: QuoteDraft | null) => void
  reviewed: boolean; setReviewed: (v: boolean) => void; quoteStatus: QuoteStatus; setQuoteStatus: (s: QuoteStatus) => void
  propertyChanged: boolean; addressNeedsReview: boolean
  feedback: string; setFeedback: (text: string) => void
  /** The price calculator and staff map stay closed until "Edit price" (UX audit Q3, Q4). */
  calcOpen: boolean; setCalcOpen: (open: boolean) => void
}
const Quote = createContext<QuoteState | null>(null)
const useQuote = () => useContext(Quote)!

function dateText(value: string) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })
}

export function QuoteProvider({ lead, activities, bookings, sentOffers = [], children }: {
  lead: QuoteLead; activities: QuoteActivity[]; bookings: QuoteBooking[]; sentOffers?: SentOfferSummary[]; children: React.ReactNode
}) {
  const [version, setVersion] = useState(lead.updated_at)
  const [draft, setDraft] = useState<QuoteDraft | null>(lead.quote_draft)
  const [reviewed, setReviewed] = useState(!!lead.quote_confirmed_at)
  const [quoteStatus, setQuoteStatus] = useState(lead.quote_status)
  const [feedback, setFeedback] = useState('')
  const [calcOpen, setCalcOpen] = useState(false)
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
  return <Quote.Provider value={{ lead, activities, bookings, sentOffers, version, setVersion, draft, setDraft, reviewed, setReviewed,
    quoteStatus, setQuoteStatus, propertyChanged, addressNeedsReview, feedback, setFeedback, calcOpen, setCalcOpen }}>
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

/** Where the saved quote stands: drives the Price card's status chip and which quote actions show. */
function useQuoteState() {
  const { bookings, draft, reviewed, quoteStatus } = useQuote()
  const booking = latestQuoteBooking(bookings)
  const quoteState = booking && quoteStatus === 'canceled' ? 'canceled'
    : booking && booking.status !== 'canceled' && quoteStatus === 'accepted' ? 'booked'
    : quoteStatus === 'accepted' ? 'accepted' : quoteStatus === 'declined' ? 'declined'
      : reviewed && draft ? 'quoted' : draft ? 'draft' : 'none'
  return { booking, quoteState }
}

/** Saved-quote status for the Price card header ("Quote · Draft"). */
export function QuoteStatusChip() {
  const { booking, quoteState } = useQuoteState()
  if (quoteState === 'none') return null
  const label = { booked: booking?.status === 'pending' ? 'Requested' : 'Booked', canceled: 'Canceled', accepted: 'Accepted', declined: 'Said no', quoted: 'Quoted', draft: 'Draft' }[quoteState]
  const tone = { booked: 'booked', canceled: 'lost', accepted: 'booked', declined: 'lost', quoted: 'quoted', draft: 'new' }[quoteState]
  return <span className={`crm-chip crm-chip-${tone}`}>Quote · {label}</span>
}

/** Opens the price calculator and its map, and brings it into view. */
export function EditPriceButton({ hasPrice }: { hasPrice: boolean }) {
  const { calcOpen, setCalcOpen } = useQuote()
  return <button type="button" className="crm-button crm-button-sm" aria-expanded={calcOpen} aria-controls="price-calculator" onClick={() => {
    setCalcOpen(!calcOpen)
    if (!calcOpen) requestAnimationFrame(() => document.getElementById('price-calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }}><Icon name="ruler" size={15} />{calcOpen ? 'Hide calculator' : hasPrice ? 'Edit price' : 'Add price'}</button>
}

/** Quote actions inside the Price card: book, text or email the price, said no, visits. */
export function QuotePanel() {
  const { lead, bookings, sentOffers, version, draft, setQuoteStatus, propertyChanged, setFeedback } = useQuote()
  const { run, pending, startTransition, router } = useRun()
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailBody, setEmailBody] = useState('')
  const bookingOperation = useRef<string | null>(null)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [cancellationPreview, setCancellationPreview] = useState<{
    bookingId: string; bookingStatus: string; agreementId: string | null; agreementUpdatedAt: string | null
    futureJobs: { id: string; date: string | null }[]
  } | null>(null)

  // Follow-up after the phone call: recap the agreed price and ask for the booking.
  function quoteSummary(quote: QuoteDraft) {
    if (currentSent?.publicUrl) return `QuietGreen quote ${currentSent.version}: ${currentSent.publicUrl}
Reply with a preferred date and we’ll confirm the visit.`

    const firstName = lead.name?.trim().split(/\s+/)[0]
    const offer = quoteOffer(quote)
    const quoted = offer.options.find(o => o.freq === offer.quoted) ?? offer.options[0]
    const dollars = (value: number) => Number.isInteger(value) ? `$${value}` : formatMoney(value)
    const price = dollars(quoted.price)
    const deal = offer.recurring && quoted.freq !== 'onetime'
      ? `${frequencyLabel(quoted.freq).toLowerCase()} mowing is ${price} a visit${quoted.firstVisit !== quoted.price ? `, and your first visit is just ${dollars(quoted.firstVisit)}` : ''}`
      : `your ${lead.services?.join(' + ').toLowerCase() || 'job'} comes to ${price}`
    const measured = offer.sqFt ? `Your lawn measured ${offer.sqFt.toLocaleString('en-US')} sq ft, so ` : 'So '
    const close = 'Reply with a preferred date and we’ll confirm your visit.'
    return `Hi${firstName ? ` ${firstName}` : ''}, QuietGreen here, great talking with you! ${measured}${deal}. ${close}`
  }
  function openEmail() {
    if (!draft) return
    const sqFt = draft.sections.reduce((sum, section) => sum + (Number(section.sqFt) || 0), 0)
    const firstName = lead.name?.trim().split(/\s+/)[0]
    setEmailBody(`Hi${firstName ? ` ${firstName}` : ''},\n\nGreat talking with you today! We measured your lawn${sqFt ? ` at ${sqFt.toLocaleString('en-US')} sq ft` : ''}, and your price is below.\n\nChoose a preferred date from the quote link. We’ll confirm the visit with you.\n\nTalk soon,\nQuietGreen`)
    setEmailOpen(true)
  }
  function smsHref(body: string) {
    const iOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
    return `sms:${lead.phone}${iOS ? '&' : '?'}body=${encodeURIComponent(body)}`
  }
  const { booking, quoteState } = useQuoteState()
  const currentSent = sentOffers.find(offer => offer.state === 'sent' && offer.sent_at && !offer.replaced)
  const pendingSend = sentOffers.find(offer => ['sending', 'unknown'].includes(offer.state))
  const emailButton = currentSent ? currentSent.accepted_booking_id ? 'Email new proposal' : 'Email revised quote' : 'Email quote'
  const bookedCustomerId = bookings.find(b => b.customer_id)?.customer_id ?? null
  const needsSeparateProposal = quoteState === 'canceled' && Boolean(currentSent?.accepted_booking_id)
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
    bookingOperation.current ??= uuid()
    const operationId = bookingOperation.current
    setFeedback('')
    startTransition(async () => {
      const result = await requestStaffQuoteVisit(lead.id, version, operationId, currentSent?.state === 'sent' ? currentSent.id : null)
        .catch(() => ({ error: 'Could not save the request. Retry to check whether it was saved.' }))
      if ('error' in result) { setFeedback(result.error ?? 'Could not save the request.'); return }
      bookingOperation.current = null
      router.push(`/admin/jobs/${result.bookingId}`)
    })
  }

  return <div className="crm-quote-panel" aria-label="Quote">
    {sentOffers.length > 0 && <section className="crm-booking-request" aria-label="Sent quotes">
      <h3>Sent quotes</h3>
      {sentOffers.map(offer => <div key={offer.id} className="crm-kv">
        <div><dt>Quote {offer.version}</dt><dd>{offer.state === 'failed' ? 'Email rejected' : offer.sent_at
          ? `${offer.accepted_booking_id ? 'Accepted · ' : offer.replaced ? 'Replaced · ' : offer.state === 'review' ? 'Needs review · ' : ''}Email sent ${dateText(offer.sent_at)}`
          : 'Email delivery unconfirmed'} · {offer.recipient}</dd></div>
        {offer.rows.map((row, index) => <p key={index} className="crm-hint">
          {row.label}{row.when ? ` · ${row.when}` : ''} · {row.firstVisitCents !== null ? `First visit ${emailMoney(row.firstVisitCents)} · ` : ''}
          {emailMoney(row.perVisitCents)}{row.freq === 'onetime' ? ' standard' : ' per visit'}
        </p>)}
        {offer.href && <Link className="crm-button crm-button-sm" href={offer.href}>View sent terms</Link>}
      </div>)}
      {pendingSend && <button type="button" className="crm-button crm-button-sm" disabled={pending} onClick={() => {
        startTransition(async () => {
          const result = await retryLeadQuote(lead.id, pendingSend.id).catch(() => ({ error: 'Could not check the email attempt.' }))
          setFeedback('error' in result ? result.error : result.warning ?? 'Quote emailed.')
          router.refresh()
        })
      }}>Check or retry email</button>}
    </section>}
    {draft && quoteState === 'draft' && !emailOpen && <div className="crm-action-row">
      <a className="crm-button" href={smsHref(quoteSummary(draft))}><Icon name="message" size={15} />{currentSent ? 'Text price' : 'Text draft price'}</a>
      <button type="button" className="crm-button" disabled={!!pendingSend} onClick={openEmail}><Icon name="mail" size={15} />{emailButton}</button>
    </div>}
    {draft && emailOpen && <QuoteEmail draft={draft} message={emailBody} onClose={() => setEmailOpen(false)} />}

    {needsSeparateProposal && !emailOpen && <div className="crm-booking-request">
      <p>The canceled visit stays linked to the accepted quote. Agree the new visit as a separate proposal or service.</p>
      <div className="crm-action-row">
        {draft && <button type="button" className="crm-button" disabled={!!pendingSend} onClick={openEmail}>Email new proposal</button>}
        {bookedCustomerId && <Link className="crm-button" href={`/admin/customers/${bookedCustomerId}/service`}>Add service</Link>}
      </div>
    </div>}

    {!needsSeparateProposal && (quoteState === 'quoted' || quoteState === 'accepted' || quoteState === 'canceled') && !bookingOpen && !emailOpen && !propertyChanged && booking?.status !== 'pending' && <div className="crm-action-row">
      <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={() => setBookingOpen(true)}>{quoteState === 'canceled' ? 'Book again' : 'Book visit'}</button>
      {draft && quoteState !== 'canceled' && <a className="crm-button" href={smsHref(quoteSummary(draft))}><Icon name="message" size={15} />{currentSent ? 'Text price' : 'Text draft price'}</a>}
      {draft && quoteState !== 'canceled' && !emailOpen && <button type="button" className="crm-button" disabled={!!pendingSend} onClick={openEmail}><Icon name="mail" size={15} />{emailButton}</button>}
      {quoteState === 'quoted' && <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'declined'), () => setQuoteStatus('declined'))}>Customer said no</button>}
      {quoteState === 'accepted' && <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'canceled'), () => setQuoteStatus('canceled'))}>Cancel acceptance</button>}
    </div>}
    {quoteState === 'accepted' && propertyChanged && <div className="crm-action-row">
      <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'canceled'), () => setQuoteStatus('canceled'))}>Cancel acceptance</button>
    </div>}

    {bookingOpen && !propertyChanged && <div className="crm-booking-request">
      <h3>Record the agreed service</h3>
      <p>{currentSent ? `Use the exact terms from sent quote ${currentSent.version}.` : 'Use the reviewed price and service from this quote.'}
        {' '}Then review the customer, property, and first visit date.</p>
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={submitBooking}>Record acceptance & review visit</button>
        <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setBookingOpen(false)}>Cancel</button>
      </div>
    </div>}

    {quoteState === 'declined' && <div className="crm-action-row">
      <button type="button" className="crm-button" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'draft'), () => setQuoteStatus('draft'))}>Reopen quote</button>
    </div>}

    {quoteState === 'booked' && <div className="crm-booked">
      {draft && !emailOpen && <button type="button" className="crm-button" disabled={!!pendingSend} onClick={openEmail}><Icon name="mail" size={15} />Email new proposal</button>}
      <dl className="crm-kv"><dt>Visit</dt><dd>{booking?.confirmed_date ? `Scheduled ${booking.confirmed_date}` : booking?.preferred_date ? `Requested ${booking.preferred_date}` : '—'}</dd></dl>
      <div className="crm-action-row">
        {bookedCustomerId && <Link className="crm-button crm-button-primary" href={`/admin/customers/${bookedCustomerId}`}>Open customer</Link>}
        {booking && <Link className="crm-button" href={`/admin/jobs/${booking.id}`}>Open visit</Link>}
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
  </div>
}

/**
 * Email quote: write it, preview the exact email (map picture, prices by plan, add-ons, first visit),
 * then send. Nothing reaches the customer until "Send" on the preview.
 */
function QuoteEmail({ draft, message: initialMessage, onClose }: { draft: QuoteDraft; message: string; onClose: () => void }) {
  const { lead, version, setVersion, setFeedback } = useQuote()
  const { pending, startTransition, router } = useRun()
  const mowing = quoteOffer(draft).recurring
  const [frequency, setFrequency] = useState<OfferFrequency>('onetime')
  const [to, setTo] = useState(lead.email ?? '')
  const [message, setMessage] = useState(initialMessage)
  const [when, setWhen] = useState('')
  const [addOns, setAddOns] = useState<{ id: string; label: string; price: string }[]>([])
  const [preview, setPreview] = useState<{
    input: { to: string; options: QuoteEmailOptions; image: string | null }; mapNote: string
    offerId: string; proof: string; subject: string; html: string; revision?: 'replaces' | 'proposal'
  } | null>(null)
  const [error, setError] = useState('')
  const shapes = tracedShapes(draft.sections, lead.lawn_tracing)
  const sqFt = draft.sections.reduce((sum, section) => sum + (Number(section.sqFt) || 0), 0)

  function options(): QuoteEmailOptions {
    return { message, when, ...(mowing ? {} : { frequency }),
      addOns: addOns.map(a => ({ label: a.label, cents: Math.round(Number(a.price) * 100) })) }
  }
  function showPreview() {
    const next = options()
    const invalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) ? 'Enter a valid email address.'
      : validateQuoteEmailOptions(next)
    setError(invalid ?? '')
    if (invalid) return
    startTransition(async () => {
      let image: string | null = null
      let mapNote = ''
      if (shapes.length) {
        try { image = await renderLawnMapImage(shapes, sqFt || null) }
        catch { mapNote = 'The satellite picture could not load. Preview again or send without it.' }
      } else mapNote = 'No traced lawn is attached.'
      const input = { to, options: next, image }
      const reviewed = await previewLeadQuote(lead.id, version, input).catch(() => ({ error: 'Could not preview the quote.' } as const))
      if ('error' in reviewed) { setError(reviewed.error ?? 'Could not preview the quote.'); return }
      setPreview({ ...reviewed, input, mapNote })
    })
  }
  function send() {
    if (!preview) return
    setFeedback('')
    startTransition(async () => {
      try {
        const result = await emailLeadQuote(lead.id, version, preview.offerId, preview.proof, preview.input)
        if ('error' in result) setError(result.error)
        else { setVersion(result.updatedAt); onClose(); setFeedback(result.warning ?? `Quote emailed to ${preview.input.to.trim()}.`) }
        router.refresh()
      } catch { setError('Email delivery is unconfirmed. Refresh and check the saved attempt.'); router.refresh() }
    })
  }

  if (preview) {
    return <div className="crm-booking-request crm-email-preview">
      <h3>Review email before sending</h3>
      {preview.revision === 'replaces' && <p className="crm-hint">Sending this revision replaces the previous open quote.</p>}
      <dl className="crm-kv"><div><dt>To</dt><dd>{preview.input.to.trim()}</dd></div><div><dt>Subject</dt><dd>{preview.subject}</dd></div></dl>
      {preview.mapNote && <p className="crm-hint">{preview.mapNote}</p>}
      <iframe title="Email preview" sandbox="" srcDoc={preview.input.image ? preview.html.replace(`cid:${MAP_CID}`, preview.input.image) : preview.html} />
      {error && <p role="alert" className="crm-error">{error}</p>}
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={send}><Icon name="mail" size={15} />{preview.revision === 'replaces' ? 'Send revised quote' : 'Send quote'}</button>
        <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setPreview(null)}>Back to edit</button>
      </div>
    </div>
  }
  return <div className="crm-booking-request">
    <h3>Email quote</h3>
    <label className="crm-field">To<input type="email" value={to} maxLength={254} onChange={event => setTo(event.target.value)} placeholder="customer@example.com" /></label>
    <label className="crm-field">Message<textarea value={message} maxLength={4000} rows={6} onChange={event => setMessage(event.target.value)} /></label>
    <p className="crm-hint">{mowing ? `${frequencyLabel(draft.freq)} mowing · ` : ''}{formatMoney(quoteTotalCents(draft) / 100)}
      {(mowing ? draft.freq : frequency) !== 'onetime' ? ' per visit' : ''} before add-ons. Use Edit price to change the agreed service or amount.</p>
    {!mowing && <label className="crm-field">Repeat<select aria-label="Repeat" value={frequency}
      onChange={event => setFrequency(event.target.value as OfferFrequency)}>
      <option value="onetime">Single visit</option><option value="weekly">Weekly</option>
      <option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option>
    </select></label>}
    <label className="crm-field">Timing note (optional)<input maxLength={80} value={when}
      onChange={event => setWhen(event.target.value)} placeholder="For example, start after the leaves clear" /></label>
    <div className="crm-field" role="group" aria-label="Add-ons">{(mowing ? draft.freq : frequency) !== 'onetime' ? 'Add-ons (per visit)' : 'Add-ons'}
      {addOns.map(addOn => <div className="crm-email-addon" key={addOn.id}>
        <input aria-label="Add-on" value={addOn.label} maxLength={60} placeholder="Bagging clippings" onChange={event => setAddOns(list => list.map(a => a.id === addOn.id ? { ...a, label: event.target.value } : a))} />
        <input aria-label="Add-on price" inputMode="decimal" value={addOn.price} placeholder="$" onChange={event => setAddOns(list => list.map(a => a.id === addOn.id ? { ...a, price: event.target.value.replace(/[^\d.]/g, '') } : a))} />
        <button type="button" className="crm-icon-button" aria-label="Remove add-on" onClick={() => setAddOns(list => list.filter(a => a.id !== addOn.id))}>×</button>
      </div>)}
      {addOns.length < 6 && <button type="button" className="crm-button crm-button-sm" onClick={() => setAddOns(list => [...list, { id: uuid(), label: '', price: '' }])}>+ Add-on</button>}
    </div>
    {error && <p className="crm-hint" role="alert">{error}</p>}
    <div className="crm-action-row">
      <button type="button" className="crm-button crm-button-primary" disabled={pending || !to.trim()} onClick={showPreview}>{pending ? 'Drawing map…' : 'Preview email'}</button>
      <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={onClose}>Cancel</button>
    </div>
  </div>
}

/** Pencil by the lead's name: edit name, phone, address, email in a sheet. */
export function EditContactButton() {
  const { lead, version } = useQuote()
  const { run, pending } = useRun()
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="crm-icon-button" aria-label="Edit contact" onClick={() => setOpen(true)}><Icon name="pencil" size={16} /></button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Edit contact">
      <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('updated_at', version); run(() => updateLeadContact(lead.id, form), () => setOpen(false)) }}>
        <label className="crm-field">Name<input name="name" defaultValue={lead.name ?? ''} required maxLength={150} /></label>
        <label className="crm-field">Phone<input name="phone" type="tel" defaultValue={lead.phone} required maxLength={30} /></label>
        <label className="crm-field">Property address<input name="address" defaultValue={lead.address ?? ''} required maxLength={500} /></label>
        <label className="crm-field">Email<input name="email" type="email" defaultValue={lead.email ?? ''} maxLength={254} /></label>
        <div className="crm-dialog-actions"><button type="submit" className="crm-button crm-button-primary crm-button-lg" disabled={pending}>Save contact</button></div>
      </form>
    </Sheet>
  </>
}

/** "Add note" in the History header. */
export function AddNoteButton() {
  const { lead, version } = useQuote()
  const { run, pending } = useRun()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  return <>
    <button type="button" className="crm-button crm-button-sm" onClick={() => setOpen(true)}><Icon name="pencil" size={15} />Add note</button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Add note">
      <label className="crm-field">Note<textarea value={note} maxLength={2000} rows={4} onChange={event => setNote(event.target.value)} /></label>
      <div className="crm-dialog-actions"><button type="button" className="crm-button crm-button-primary crm-button-lg" disabled={pending || !note.trim()}
        onClick={() => run(() => addLeadNote(lead.id, version, note), () => { setNote(''); setOpen(false) })}>Add note</button></div>
    </Sheet>
  </>
}

/** The staff map quote builder (desktop: right column under the map; phone: after Details). */
export function QuoteMap() {
  const { lead, version, setVersion, draft, setDraft, setReviewed, quoteStatus, setQuoteStatus, propertyChanged, addressNeedsReview, calcOpen } = useQuote()
  const router = useRouter()
  const [resetPropertyAddress, setResetPropertyAddress] = useState<string | null>(null)
  const propertyReset = resetPropertyAddress !== null && resetPropertyAddress === lead.address
  const answers = lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers) ? lead.answers as { postcode?: unknown; property_address?: unknown } : {}
  const lookupAddress = addressForLookup(lead.address ?? '', answers.property_address, answers.postcode)
  // A changed contact address is a review flag: it shows even with the calculator closed.
  if (!calcOpen && !(propertyChanged && !propertyReset)) return null
  return <div className="crm-quote-wrap" id="price-calculator">
    {propertyChanged && !propertyReset ? <div className="crm-panel" id="map-quote">
      <h2>Contact address changed</h2>
      <p>The saved measurement and price belong to the old property. Accepted quotes and jobs stay in history.</p>
      <div className="crm-action-row">
        <button className="crm-button crm-button-primary" onClick={() => { setResetPropertyAddress(lead.address); setReviewed(false) }}>Start quote for updated address</button>
      </div>
      {quoteStatus === 'accepted' && <p className="crm-hint">The accepted property and price stay in history.</p>}
    </div> : <MapQuoteBuilder key={propertyReset ? `reset-${resetPropertyAddress}` : 'saved-property'} staffQuote={{ id: lead.id, address: lead.address, lookupAddress, sq_ft: propertyReset ? null : lead.sq_ft, services: lead.services ?? [], frequency: lead.frequency,
      draft: propertyReset ? null : draft, updated_at: version, quote_status: quoteStatus, addressNeedsReview: addressNeedsReview || propertyChanged,
      onSaved: (updatedAt, wasReviewed, savedDraft) => { setVersion(updatedAt); setDraft(savedDraft); setReviewed(wasReviewed); if (quoteStatus !== 'accepted') setQuoteStatus('draft'); router.refresh() } }}
      staffTracing={propertyReset || propertyChanged ? undefined : tracedShapes(lead.lawn_tracing)} />}
  </div>
}
