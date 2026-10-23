'use client'

import { useState } from 'react'
import { REVIEWS as reviews } from '@/lib/reviews'

const StarIcon = () => (
  <svg className="star" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
  </svg>
)

const Stars = () => (
  <div className="stars">
    {Array.from({ length: 5 }).map((_, i) => <StarIcon key={i} />)}
  </div>
)

const SHOWN = 3

export default function Testimonials() {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? reviews : reviews.slice(0, SHOWN)
  const remaining = reviews.length - SHOWN

  return (
    <section className="testimonials" id="reviews">
      <div className="section-label reveal">Reviews</div>
      <h2 className="section-h2 reveal" data-delay="80">What customers are saying</h2>
      <div className="testi-grid">
        {visible.map((r, i) => (
          <div key={r.name} className="testi-card reveal" data-delay={i * 150}>
            <Stars />
            <p className="testi-text">{r.text}</p>
            <div className="testi-author">
              <div className="testi-avatar" style={{ background: r.avatarBg }}>{r.initials}</div>
              <div>
                <div className="testi-name">{r.name}</div>
                <div className="testi-loc">{r.loc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="testi-actions">
        {!expanded && (
          <button className="testi-more-btn" onClick={() => setExpanded(true)}>
            See {remaining} more review{remaining !== 1 ? 's' : ''}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        )}
        <a
          className="testi-google-link"
          href="https://www.google.com/maps?cid=10749444056015936389"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          See all reviews on Google
        </a>
      </div>
    </section>
  )
}
