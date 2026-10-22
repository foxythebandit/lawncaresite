'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import MapQuoteBuilder from '@/components/MapQuoteBuilder'
import { quoteTotalCents, type QuoteDraft } from '@/lib/quote-draft'
import { addLeadNote, processLeadAlert, recordLeadCall, requestLeadBooking, setLeadFollowUp, setLeadQuoteDecision, setLeadStage, updateLeadContact } from './quote-actions'
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
type Booking = { id: string; status: string; created_at: string; confirmed_at: string | null; completed_at: string | null; payment_recorded_at: string | null; amount_charged: number | null; payment_method: string | null }
type Result = { success: true; updatedAt: string } | { error: string; conflict?: boolean }

function dateText(value: string) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })
}

function initialMessage(lead: Lead) {
  const firstName = lead.name?.trim().split(/\s+/)[0]
  return `Hi${firstName ? ` ${firstName}` : ''}, this is QuietGreen. Thanks for asking about ${lead.services?.join(', ') || 'lawn care'} at ${lead.address || 'your property'}. When is a good time to talk?`
}

export default function LeadWorkspace({ lead, activities, events, bookings }: { lead: Lead; activities: Activity[]; events: Event[]; bookings: Booking[] }) {
  const router = useRouter()
  const addressNeedsReview = !!lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers)
    && (lead.answers as { address_needs_review?: unknown }).address_needs_review === true
  const [version, setVersion] = useState(lead.updated_at)
  const [draft, setDraft] = useState<QuoteDraft | null>(lead.quote_draft)
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
  const bookingOperationId = useRef<string | null>(null)
  const [bookingDate, setBookingDate] = useState('')

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

  function useQuoteSummary() {
    if (!draft || !reviewed) return
    const firstName = lead.name?.trim().split(/\s+/)[0]
    const total = (quoteTotalCents(draft) / 100).toFixed(2)
    setMessageDraft(`Hi${firstName ? ` ${firstName}` : ''}, this is QuietGreen. We reviewed ${lead.address || 'your property'} and the ${lead.services?.join(', ') || 'requested'} service quote is $${total} per visit. Please reply if you would like to discuss it.`)
  }

  return <>
    <div className="crm-workspace">
      <Link className="crm-back" href="/admin/leads">← Leads</Link>
      <div className="crm-workspace-head">
        <span className="crm-eyebrow">Lead workspace · {lead.stage}</span>
        <h1>{lead.name || 'Name not supplied'}</h1>
        <p className="crm-property">{lead.address || 'Address not yet provided'}</p>
        {addressNeedsReview && <p className="crm-review-flag" role="alert">Submitted address needs review. Select the matching property in the map before using its measurement.</p>}
        <span className="crm-muted">Received {dateText(lead.created_at)} · {lead.source || 'Source unknown'}</span>
      </div>
      <div className="crm-workspace-grid">
        <div className="crm-panel">
          <h2>Respond</h2>
          <p className="crm-muted">{(lead.services ?? []).join(', ') || 'Services unknown'} · {lead.frequency || 'Frequency unknown'} · {lead.timing || 'Timing unknown'}</p>
          <div className="crm-action-row">
            <a className="crm-button crm-button-primary" href={`tel:${lead.phone}`}>Call {lead.phone}</a>
            <a className="crm-button" href={`sms:${lead.phone}?body=${encodeURIComponent(messageDraft)}`}
              onClick={event => { if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) event.currentTarget.href = `sms:${lead.phone}&body=${encodeURIComponent(messageDraft)}` }}>Open Messages</a>
          </div>
          <p className="crm-muted">Opening Phone or Messages does not record a connected call or sent text.</p>
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
              {lead.follow_up_at && <button type="button" className="crm-button" disabled={pending} onClick={() => run(() => setLeadFollowUp(lead.id, version, null))}>Clear</button>}
            </div>
          </div>
          <h3>Staff note</h3>
          <label className="crm-field">Note<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
          <button type="button" className="crm-button" disabled={pending || !note.trim()} onClick={() => run(() => addLeadNote(lead.id, version, note), () => setNote(''))}>Add note</button>
          </details>
          {feedback && <p className="crm-feedback" role={feedback.startsWith('Could') || feedback.includes('changed') || feedback.includes('failed') ? 'alert' : 'status'}>{feedback}</p>}
        </div>
        <div className="crm-panel">
          <h2>Quote and details</h2>
          <p><strong>{quoteStatus === 'accepted' ? 'Accepted' : reviewed ? 'Reviewed quote' : draft ? 'Draft estimate' : 'New inquiry'}</strong></p>
          {draft && <p className="crm-muted">{reviewed ? 'Reviewed' : 'Draft'} total: ${(quoteTotalCents(draft) / 100).toFixed(2)} per visit</p>}
          {reviewed && quoteStatus !== 'accepted' && <div className="crm-action-row">
            <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'accepted'), () => setQuoteStatus('accepted'))}>Mark accepted</button>
            <button type="button" className="crm-button" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'declined'), () => setQuoteStatus('declined'))}>Mark declined</button>
          </div>}
          {quoteStatus === 'accepted' && <button type="button" className="crm-button" disabled={pending} onClick={() => run(() => setLeadQuoteDecision(lead.id, version, 'canceled'), () => setQuoteStatus('canceled'))}>Cancel acceptance</button>}
          {quoteStatus === 'accepted' && bookings.length === 0 && <div className="crm-booking-request">
            <h3>Create booking request</h3>
            <p className="crm-muted">Create a pending visit from this accepted quote. Schedule confirmation stays separate.</p>
            <label className="crm-field">Requested visit date (optional)<input type="date" value={bookingDate} onChange={event => setBookingDate(event.target.value)} /></label>
            <button type="button" className="crm-button" disabled={pending} onClick={() => {
              const key = `qg_quote_booking_${lead.id}`
              if (!bookingOperationId.current) {
                try { bookingOperationId.current = sessionStorage.getItem(key) } catch { /* private browsing */ }
                if (!bookingOperationId.current) {
                  bookingOperationId.current = crypto.randomUUID()
                  try { sessionStorage.setItem(key, bookingOperationId.current) } catch { /* keep in memory */ }
                }
              }
              const operationId = bookingOperationId.current
              setFeedback('')
              startTransition(async () => {
                try {
                  const result = await requestLeadBooking(lead.id, version, operationId, bookingDate)
                  if ('error' in result) setFeedback(result.error ?? 'Could not create booking request.')
                  else {
                    try { sessionStorage.removeItem(`qg_quote_booking_${lead.id}`) } catch {}
                    bookingOperationId.current = null
                    setVersion(result.updatedAt)
                    setStage('booked')
                    setFeedback(result.duplicate ? 'Booking request already exists.' : 'Booking request created.')
                    router.refresh()
                  }
                } catch { setFeedback('Could not create booking request. Please retry.') }
              })
            }}>Create booking request</button>
          </div>}
          {feedback && <p className="crm-feedback" role={feedback.startsWith('Could') || feedback.includes('changed') || feedback.includes('failed') ? 'alert' : 'status'}>{feedback}</p>}
          {lead.email && <p className="crm-muted">{lead.email}</p>}
          <details className="crm-details"><summary>Edit contact</summary>
            <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('updated_at', version); run(() => updateLeadContact(lead.id, form)) }}>
              <label className="crm-field">Name<input name="name" defaultValue={lead.name ?? ''} required maxLength={150} /></label>
              <label className="crm-field">Email<input name="email" type="email" defaultValue={lead.email ?? ''} maxLength={254} /></label>
              <button type="submit" className="crm-button" disabled={pending}>Save contact</button>
            </form>
          </details>
          <details className="crm-details"><summary>Answers and acquisition details</summary>
            <pre>{JSON.stringify({ answers: lead.answers, attribution: lead.attribution, source: lead.source, form_version: lead.form_version,
              external_submission_id: lead.external_submission_id, consent: lead.consent, consent_text: lead.consent_text,
              consent_version: lead.consent_version, consented_at: lead.consented_at, score: lead.score, estimated_value: lead.estimated_value }, null, 2)}</pre>
            <p className="crm-muted">External estimates are separate from quoted prices and payments. Missing attribution is unknown.</p>
          </details>
          <details className="crm-details"><summary>Booking stages ({bookings.length})</summary>
            {bookings.map(booking => <p key={booking.id}>{booking.status} · Requested {dateText(booking.created_at)}
              {booking.confirmed_at && ` · Confirmed ${dateText(booking.confirmed_at)}`}
              {booking.completed_at && ` · Completed ${dateText(booking.completed_at)}`}
              {booking.payment_recorded_at && ` · Payment recorded ${dateText(booking.payment_recorded_at)}: $${booking.amount_charged ?? 0} (${booking.payment_method})`}</p>)}
          </details>
          <details className="crm-details"><summary>Staff alerts</summary>
            {events.flatMap(event => (event.staff_alerts ?? []).map(alert => <div key={alert.id}>
              <p>{alert.recipient || 'Recipient not configured'} · {alert.channel || 'sms'} · {alert.state} {alert.provider_status && `(${alert.provider_status})`} · {alert.attempts} attempts {alert.error_code && `· ${alert.error_code}`}</p>
              {alert.provider_sid ? <form action={processLeadAlert.bind(null, lead.id, alert.id, event.id, 'refresh')}><button className="crm-button">Check delivery</button></form>
                : ['pending','disabled','failed'].includes(alert.state) ? <form action={processLeadAlert.bind(null, lead.id, alert.id, event.id, 'retry')}><button className="crm-button">Retry staff alert</button></form>
                : <p>Check provider logs before resending; acceptance is uncertain.</p>}
            </div>))}
          </details>
          <details className="crm-details"><summary>Activity ({activities.length})</summary>
          {activities.length ? activities.map(activity => <div className="crm-activity" key={activity.id}>
            <span>{activity.kind}{activity.outcome ? ` · ${activity.outcome.replaceAll('_', ' ')}` : ''}{activity.body ? ` — ${activity.body}` : ''}</span>
            <small>{dateText(activity.occurred_at)} · {activity.actor_email || 'Staff'}</small>
          </div>) : <p className="crm-muted">No staff activity recorded yet.</p>}
          </details>
        </div>
      </div>
    </div>
    <div className="crm-quote-wrap">
      <MapQuoteBuilder staffQuote={{ id: lead.id, address: lead.address, sq_ft: lead.sq_ft, services: lead.services ?? [], frequency: lead.frequency,
        draft, updated_at: version, quote_status: quoteStatus, addressNeedsReview,
        onSaved: (updatedAt, wasReviewed, savedDraft) => { setVersion(updatedAt); setDraft(savedDraft); setReviewed(wasReviewed); setQuoteStatus('draft'); if (wasReviewed) setStage('quoted'); router.refresh() } }} />
    </div>
  </>
}
