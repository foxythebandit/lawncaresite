'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

type TrustPoint = {
  label: string
  icon: ReactNode
  title: string
  body: string
  cta?: { label: string; href: string }
}

// Each trust point opens a short card explaining what the promise actually means.
const POINTS: TrustPoint[] = [
  {
    label: 'Same-day scheduling',
    icon: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
    title: 'Hear back the same day',
    body: 'Request a visit and we’ll confirm your time slot the same day — no waiting on callbacks.',
  },
  {
    label: 'Satisfaction guarantee',
    icon: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
    title: 'Not happy? We come back free.',
    body: 'If any part of your cut isn’t right, tell us within 48 hours and we’ll return to fix it at no charge.',
    cta: { label: 'Get your price', href: '#map-quote' },
  },
  {
    label: 'Licensed & insured',
    icon: <path d="M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z" />,
    title: 'Your property is covered',
    body: 'We carry liability insurance on every visit, so you’re protected if anything goes wrong.',
  },
]

// From the Google Business listing (maps cid 10749444056015936389) — update as reviews come in
const GOOGLE_RATING = '5.0'
const GOOGLE_REVIEW_COUNT = 9

const REVEAL_DELAYS = ['0', '150', '250', '350', '450']

export default function TrustBar() {
  const [open, setOpen] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Tap-opened cards close on an outside tap or Escape
  useEffect(() => {
    if (open === null) return
    const onDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`trust-bar${open !== null ? ' has-open' : ''}`} ref={barRef}>
      {/* Social proof first — neighbors' reviews carry more weight than our own claims */}
      <div className="trust-cell reveal" data-delay={REVEAL_DELAYS[0]}>
        <div className="trust-item">
          <a className="trust-trigger trust-rating" href="#reviews" aria-label={`Rated ${GOOGLE_RATING} out of 5 on Google from ${GOOGLE_REVIEW_COUNT} reviews — read them`}>
            <span className="trust-stars" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <svg key={i} viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                </svg>
              ))}
            </span>
            {GOOGLE_RATING} on Google
            <span className="trust-rating-count">({GOOGLE_REVIEW_COUNT} reviews)</span>
          </a>
        </div>
      </div>
      {POINTS.map((p, i) => (
        // .reveal sits on the static wrapper: the scroll-reveal script adds a `revealed`
        // class that a re-render of a dynamic className would wipe out (hiding the item)
        <div key={p.label} className="trust-cell reveal" data-delay={REVEAL_DELAYS[i + 1]}>
          <div className="trust-divider" />
          <div className={`trust-item${open === i ? ' open' : ''}`}>
            <button
              type="button"
              className="trust-trigger"
              aria-expanded={open === i}
              aria-controls={`trust-card-${i}`}
              onClick={() => setOpen(open === i ? null : i)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {p.icon}
              </svg>
              {p.label}
            </button>
            <div className="trust-card" id={`trust-card-${i}`} role="region" aria-label={p.label}>
              <p className="trust-card-title">{p.title}</p>
              <p className="trust-card-body">{p.body}</p>
              {p.cta && (
                <a className="trust-card-cta" href={p.cta.href} onClick={() => setOpen(null)}>
                  {p.cta.label} →
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
