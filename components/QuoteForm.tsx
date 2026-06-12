'use client'

import { useActionState } from 'react'
import { submitQuote, type QuoteState } from '@/app/actions/submit-quote'

export default function QuoteForm() {
  const [state, action, isPending] = useActionState<QuoteState, FormData>(
    submitQuote,
    null
  )

  return (
    <section className="cta-section" id="quote">
      <div>
        <div className="section-label" style={{ color: 'rgba(255,255,255,.6)' }}>
          Get started
        </div>
        <h2 className="section-h2" style={{ color: '#fff' }}>
          Free quote for Austin lawns.<br />60 seconds, no commitment.
        </h2>
        <p className="section-sub" style={{ color: 'rgba(255,255,255,.65)' }}>
          Tell us a little about your lawn and we&apos;ll send a clear, fixed price
          — same day. No surprises, no upsells.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '36px' }}>
          {[
            'Fixed pricing — no surprise bills',
            'Available as soon as tomorrow',
            '100% satisfaction guarantee',
          ].map((item) => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'rgba(255,255,255,.8)', fontSize: '14px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#52b788" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {item}
            </div>
          ))}
        </div>
      </div>

      {state?.success ? (
        <div className="cta-form">
          <p className="form-title">We&apos;ll be in touch soon!</p>
          <p style={{ color: 'rgba(255,255,255,.7)', fontSize: '15px', lineHeight: '1.6', marginTop: '8px' }}>
            Thanks for reaching out. We&apos;ll call or text as soon as possible.
          </p>
        </div>
      ) : (
        <form action={action} className="cta-form" aria-describedby={state?.error ? 'form-error' : undefined}>
          <p className="form-title">Get my free quote</p>
          <div className="form-group">
            <label htmlFor="quote-name" className="sr-only">Your name</label>
            <input
              id="quote-name"
              type="text"
              name="name"
              placeholder="Your name"
              autoComplete="name"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="quote-phone" className="sr-only">Phone number</label>
            <input
              id="quote-phone"
              type="tel"
              name="phone"
              placeholder="Phone number"
              autoComplete="tel"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="quote-postcode" className="sr-only">ZIP code</label>
            <input
              id="quote-postcode"
              type="text"
              name="postcode"
              placeholder="ZIP code"
              autoComplete="postal-code"
              inputMode="numeric"
              pattern="[0-9]{5}(-[0-9]{4})?"
              title="5-digit ZIP code"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="quote-yard-size" className="sr-only">Yard size</label>
            <select id="quote-yard-size" name="yard_size" required defaultValue="">
              <option value="" disabled>Yard size</option>
              <option value="small">Small (under 2,000 sq ft)</option>
              <option value="medium">Medium (2,000–5,000 sq ft)</option>
              <option value="large">Large (5,000–10,000 sq ft)</option>
              <option value="xlarge">Very large (10,000+ sq ft)</option>
            </select>
          </div>
          {!state?.success && state?.error && (
            <p id="form-error" role="alert" style={{ color: '#ff9999', fontSize: '13px', marginBottom: '8px' }}>
              {state.error}
            </p>
          )}
          <button type="submit" className="form-submit" disabled={isPending}>
            {isPending ? 'Sending…' : 'Get my free quote →'}
          </button>
          <p className="form-disclaimer">We&apos;ll call or text you as soon as possible. No spam, ever.</p>
        </form>
      )}
    </section>
  )
}
