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
    text: '"I work from home and used to dread Tuesdays. Now I genuinely don\'t notice when they\'re here. The lawn looks incredible and my 9am calls are safe."',
    initials: 'SL',
    name: 'Sarah L.',
    loc: 'Lakeview — weekly maintenance',
    avatarBg: 'var(--green-mid)',
  },
  {
    text: '"Finally switched from our old company. No fumes, no noise, and they actually clean up after themselves. My neighbour asked for the number before they\'d even left."',
    initials: 'MR',
    name: 'Marcus R.',
    loc: 'Riverside — bi-weekly service',
    avatarBg: 'var(--green-bright)',
  },
  {
    text: '"We have a newborn. The fact that I can put her down for a nap without worrying about a gas blower waking her up is worth every penny of the premium."',
    initials: 'JP',
    name: 'Jenny P.',
    loc: 'Northside — monthly full service',
    avatarBg: '#2d6a4f',
  },
]

export default function Testimonials() {
  return (
    <section className="testimonials" id="reviews">
      <div className="section-label reveal">Reviews</div>
      <h2 className="section-h2 reveal" data-delay="80">What customers are saying</h2>
      <div className="testi-grid">
        {reviews.map((r, i) => (
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
    </section>
  )
}
