'use client'

import { useState, useCallback, type ReactNode } from 'react'
import { submitManualQuote } from '@/app/actions/submit-manual-quote'
import { getAttribution } from '@/lib/attribution'

type Size = 'Small' | 'Medium' | 'Large'

const SIZES: { key: Size; hint: string; icon: ReactNode }[] = [
  {
    key: 'Small',
    hint: 'Under 2,000 sq ft',
    icon: (
      <svg width="34" height="26" viewBox="0 0 40 32" fill="none">
        <rect x="10" y="10" width="20" height="18" rx="2" fill="rgba(82,183,136,.15)" stroke="var(--green-bright)" strokeWidth="1.6"/>
        <path d="M14 10l6-6 6 6" stroke="var(--green-bright)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'Medium',
    hint: '2,000–8,000 sq ft',
    icon: (
      <svg width="34" height="26" viewBox="0 0 40 32" fill="none">
        <rect x="4" y="8" width="32" height="20" rx="2" fill="rgba(82,183,136,.15)" stroke="var(--green-bright)" strokeWidth="1.6"/>
        <path d="M9 8l11-6 11 6" stroke="var(--green-bright)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'Large',
    hint: '8,000+ sq ft',
    icon: (
      <svg width="34" height="26" viewBox="0 0 40 32" fill="none">
        <rect x="1" y="6" width="38" height="23" rx="2" fill="rgba(82,183,136,.15)" stroke="var(--green-bright)" strokeWidth="1.6"/>
        <path d="M6 6l14-5 14 5" stroke="var(--green-bright)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
]

export default function ManualQuoteForm() {
  const [open, setOpen]   = useState(false)
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [size, setSize]   = useState<Size | ''>('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('submitting'); setError('')
    const result = await submitManualQuote({ name, phone, address, lawn_size_bucket: size || undefined, ...getAttribution() })
      .catch(() => ({ success: false, error: 'Something went wrong. Please try again.' }))
    if (result.success) { setStatus('success') }
    else { setStatus('idle'); setError(result.error ?? 'Something went wrong.') }
  }, [name, phone, address, size])

  if (status === 'success') {
    return (
      <div className="manualq-inline-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green-bright)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>
        </svg>
        Got it — we&apos;ll be in touch shortly with your price.
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" className="manualq-toggle" onClick={() => setOpen(true)}>
        Prefer we measure it for you? →
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
            className="mapq-input"
          />
          <input
            type="tel" placeholder="Phone number" required autoComplete="tel"
            value={phone} onChange={e => setPhone(e.target.value)}
            className="mapq-input"
          />
          <input
            type="text" placeholder="Property address" required autoComplete="street-address"
            value={address} onChange={e => setAddress(e.target.value)}
            className="mapq-input"
          />
        </div>

        <div className="manualq-inline-size-label">Lawn size <span className="manualq-optional">optional</span></div>
        <div className="manualq-inline-size-row">
          {SIZES.map(s => (
            <button
              key={s.key}
              type="button"
              className={`manualq-inline-size-btn ${size === s.key ? 'selected' : ''}`}
              onClick={() => setSize(prev => prev === s.key ? '' : s.key)}
            >
              {s.icon}
              <span className="manualq-inline-size-name">{s.key}</span>
              <span className="manualq-inline-size-hint">{s.hint}</span>
            </button>
          ))}
        </div>

        {error && <p className="mapq-error">{error}</p>}

        <button type="submit" className="mapq-btn-primary" style={{ width: '100%' }} disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Sending…' : 'Get my quote'}
        </button>
      </form>
    </div>
  )
}
