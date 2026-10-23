'use client'

import { useState, useCallback, type ReactNode } from 'react'
import { submitManualQuote } from '@/app/actions/submit-manual-quote'
import { trackWebsiteLead } from '@/lib/meta-events'
import { QUOTE_CONSENT_TEXT } from '@/lib/quote-consent'
import { submissionId } from '@/lib/submission-id'
import { getAttribution } from '@/lib/attribution'

type Size = 'Small' | 'Medium' | 'Large'

const SIZES: { key: Size; hint: string; icon: ReactNode }[] = [
  {
    key: 'Small',
    hint: 'Under 2,000 sq ft',
    icon: (
      <svg width="24" height="19" viewBox="0 0 40 32" fill="none" aria-hidden="true">
        <rect x="10" y="10" width="20" height="18" rx="2" fill="rgba(82,183,136,.15)" stroke="var(--green-bright)" strokeWidth="1.6"/>
        <path d="M14 10l6-6 6 6" stroke="var(--green-bright)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'Medium',
    hint: '2,000–8,000 sq ft',
    icon: (
      <svg width="24" height="19" viewBox="0 0 40 32" fill="none" aria-hidden="true">
        <rect x="4" y="8" width="32" height="20" rx="2" fill="rgba(82,183,136,.15)" stroke="var(--green-bright)" strokeWidth="1.6"/>
        <path d="M9 8l11-6 11 6" stroke="var(--green-bright)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'Large',
    hint: '8,000+ sq ft',
    icon: (
      <svg width="24" height="19" viewBox="0 0 40 32" fill="none" aria-hidden="true">
        <rect x="1" y="6" width="38" height="23" rx="2" fill="rgba(82,183,136,.15)" stroke="var(--green-bright)" strokeWidth="1.6"/>
        <path d="M6 6l14-5 14 5" stroke="var(--green-bright)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
]

export default function ManualQuoteForm() {
  const [consent, setConsent] = useState(false)
  const [open, setOpen]   = useState(false)
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [size, setSize]   = useState<Size | ''>('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [error, setError] = useState('')

  function startNewInquiry() {
    sessionStorage.removeItem('qg_submission_manual')
    setName(''); setPhone(''); setAddress(''); setSize(''); setNotes(''); setConsent(false); setError(''); setStatus('idle'); setOpen(true)
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('submitting'); setError('')
    const result = await submitManualQuote({ submission_id: submissionId('manual'), consent, name, phone, address, lawn_size_bucket: size || undefined, notes, ...getAttribution() })
      .catch(() => ({ success: false, error: 'Something went wrong. Please try again.', eventId: undefined }))
    if (result.success) { trackWebsiteLead(result.eventId); setStatus('success') }
    else { setStatus('idle'); setError(result.error ?? 'Something went wrong.') }
  }, [consent, name, phone, address, size, notes])

  if (status === 'success') {
    return (
      <div className="manualq-inline-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green-bright)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>
        </svg>
        Got it — we&apos;ll be in touch shortly with your price.
        <button type="button" onClick={startNewInquiry}>Start a new inquiry</button>
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" className="manualq-toggle" onClick={() => setOpen(true)}>
        <span className="manualq-toggle-main">Don&apos;t want to draw? We&apos;ll measure it for you →</span>
        <span className="manualq-toggle-sub">Leave your name, phone and address — we&apos;ll text you a price</span>
      </button>
    )
  }

  return (
    <div className="manualq-inline">
      <p className="manualq-inline-sub">Leave your info and we&apos;ll size up your lawn and text you a price.</p>
      <form onSubmit={handleSubmit} className="manualq-inline-form">
        <div className="manualq-inline-fields">
          <input
            type="text" placeholder="Your name" required autoComplete="name"
            value={name} onChange={e => setName(e.target.value)}
            className="mapq-input manualq-input"
          />
          <input
            type="tel" placeholder="Phone number" required autoComplete="tel"
            value={phone} onChange={e => setPhone(e.target.value)}
            className="mapq-input manualq-input"
          />
          <input
            type="text" placeholder="Property address" style={{ gridColumn: '1 / -1' }} required autoComplete="street-address"
            value={address} onChange={e => setAddress(e.target.value)}
            className="mapq-input manualq-input"
          />
        </div>

        <div className="manualq-inline-size-label">Lawn size <span className="manualq-optional">optional</span></div>
        <div className="manualq-inline-size-row">
          {SIZES.map(s => (
            <button
              key={s.key}
              type="button"
              className={`manualq-inline-size-btn ${size === s.key ? 'selected' : ''}`}
              aria-pressed={size === s.key}
              onClick={() => setSize(prev => prev === s.key ? '' : s.key)}
            >
              {s.icon}
              <span className="manualq-inline-size-text">
                <span className="manualq-inline-size-name">{s.key}</span>
                <span className="manualq-inline-size-hint">{s.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <label className="manualq-inline-size-label" htmlFor="manualq-notes">Notes <span className="manualq-optional">optional</span></label>
        <textarea
          id="manualq-notes" rows={2} maxLength={2000}
          placeholder="Gate code, dogs in the yard, areas to skip…"
          value={notes} onChange={e => setNotes(e.target.value)}
          className="mapq-input manualq-input manualq-notes"
        />

        <label className="mapq-consent-row manualq-consent">
          <input type="checkbox" className="mapq-consent-checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          <span className="mapq-consent-text">{QUOTE_CONSENT_TEXT} (Optional)</span>
        </label>
        {error && <p className="mapq-error">{error}</p>}

        <button type="submit" className="mapq-btn-primary" style={{ width: '100%' }} disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Sending…' : 'Get my quote'}
        </button>
      </form>
    </div>
  )
}
