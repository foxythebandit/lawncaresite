'use client'

import { useState } from 'react'

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

const reviews = [
  {
    text: '"Finally a lawn service that doesn\'t wake up the whole street. Showed up on time, did a great job, and actually cleaned up after himself. The electric equipment is noticeably quieter — my dog didn\'t even bark. Booking again for next month."',
    initials: 'JG',
    name: 'Jordan Guild',
    loc: 'Google Review',
    avatarBg: 'var(--green-mid)',
  },
  {
    text: '"Quiet Green really stands out when it comes to lawn care service. I\'ve tried many different lawn services over the years but Quiet Green delivered the best mowing by far. Their crew was super friendly and they use electric mowers — I\'m happy and so is the environment. I will 100% continue to use Quiet Green."',
    initials: 'JB',
    name: 'Jeremy Burris',
    loc: 'Google Review',
    avatarBg: 'var(--green-bright)',
  },
  {
    text: '"Quiet Green goes above and beyond. They have truly done an amazing job with my home\'s landscape. If you are looking for a great company, you found it here! On time, honest, and reasonably priced."',
    initials: 'KC',
    name: 'Keagen Crawford',
    loc: 'Google Review',
    avatarBg: '#2d6a4f',
  },
  {
    text: '"Amazing service! Paxton took care of our lawn and did a great job mowing. He was professional, easy to work with, showed up on time, and left everything looking clean and well taken care of. Would definitely recommend him to anyone needing lawn care!!"',
    initials: 'C',
    name: 'Caelan',
    loc: 'Google Review',
    avatarBg: '#52b788',
  },
  {
    text: '"Paxton provided outstanding service from start to finish. He was professional, friendly, attentive, and made sure everything was handled efficiently. It\'s clear he genuinely cares about his customers and takes pride in his work. Highly recommend working with Paxton!"',
    initials: 'JP',
    name: 'Joah Pinkston',
    loc: 'Google Review',
    avatarBg: 'var(--green-deep)',
  },
]

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
          href="https://g.page/r/YOUR_GOOGLE_PLACE_ID/review"
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
