'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import type { SentOfferSummary } from '@/lib/sent-offer'
import { uuid } from '@/lib/uuid'
import { reviewExpiredQuoteEmail } from './quote-actions'

export default function ExpiredQuoteReview({ leadId, offer, attemptedAt, onSaved }: {
  leadId: string; offer: SentOfferSummary; attemptedAt: string; onSaved: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [resolution, setResolution] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const operation = useRef<{ key: string; id: string } | null>(null)

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const found = resolution === 'verified'
    const payload = { evidence: String(form.get('evidence') ?? ''),
      providerId: found ? String(form.get('provider-id') ?? '') : null,
      sentAt: found ? String(form.get('sent-at') ?? '') : null }
    const key = JSON.stringify(payload)
    if (operation.current?.key !== key) operation.current = { key, id: uuid() }
    const id = operation.current.id
    setError('')
    startTransition(async () => {
      const result = await reviewExpiredQuoteEmail(leadId, offer.id, id, payload)
        .catch(() => ({ error: 'Could not save the review. Retry to check the same review.' }))
      if ('error' in result) { setError(result.error); return }
      setOpen(false)
      onSaved(result.warning ?? 'Provider review recorded.')
    })
  }

  return <>
    <p className="crm-hint">This attempt is outside the safe retry window. Check the provider’s email history before sending again.</p>
    {!open ? <button type="button" className="crm-button crm-button-sm" onClick={() => setOpen(true)}>Review expired email</button>
      : <form className="crm-booking-request" onSubmit={save}>
        <h4>Record provider review</h4>
        <dl className="crm-kv">
          <div><dt>Attempted</dt><dd>{attemptedAt} Central</dd></div>
          <div><dt>Recipient</dt><dd>{offer.recipient}</dd></div>
          <div><dt>Subject</dt><dd>{offer.subject ?? 'Unavailable'}</dd></div>
        </dl>
        <p className="crm-hint">Compare the recipient, subject, send time and original quote link in Resend.</p>
        <label className="crm-field">Review result<select aria-label="Review result" value={resolution}
          required onChange={event => setResolution(event.target.value)}>
          <option value="">Choose a result</option>
          <option value="verified">Found this exact send</option>
          <option value="closed">Close as unconfirmed</option>
        </select></label>
        {resolution === 'verified' && <>
          <label className="crm-field">Resend email ID<input name="provider-id" maxLength={36} required /></label>
          <label className="crm-field">Provider send time<input name="sent-at" maxLength={40}
            placeholder="2026-11-09T15:45:00-06:00" required /></label>
          <p className="crm-hint">Include the time zone shown by the provider.</p>
        </>}
        {resolution === 'closed' && <p className="crm-hint">The original delivery stays unconfirmed. You can prepare a new quote after closing this attempt.</p>}
        <label className="crm-field">Provider evidence<textarea name="evidence" rows={2} maxLength={1000} required /></label>
        {error && <p className="crm-error" role="alert">{error}</p>}
        <div className="crm-action-row">
          <button type="submit" className="crm-button crm-button-primary" disabled={pending || !resolution}>Record provider review</button>
          <button type="button" className="crm-button" disabled={pending} onClick={() => setOpen(false)}>Cancel review</button>
        </div>
      </form>}
  </>
}
