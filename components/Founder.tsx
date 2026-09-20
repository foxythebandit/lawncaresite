export default function Founder() {
  return (
    <section className="founder-section">
      <div className="founder-grid">
        <div className="founder-photo-wrap reveal">
          <div className="founder-photo-frame">
            <img src="/paxton-founder.jpg" alt="Paxton, founder of QuietGreen" />
          </div>
          <div className="founder-photo-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            Hyde Park, Austin
          </div>
        </div>

        <div className="founder-copy reveal" data-delay="150">
          <div className="section-label">Who&apos;s behind this</div>
          <h2 className="section-h2">
            A gas blower woke me up. <em>So I fixed it.</em>
          </h2>
          <p className="section-sub">
            I&apos;m Paxton. The neighbor&apos;s gas lawn crew woke me up one too many times, so I borrowed my dad&apos;s electric mower and started cutting lawns myself. Word got around the neighborhood fast.
          </p>
          <p className="section-sub">
            I still run every visit myself, or with someone I trained personally — same electric equipment, same fixed price you were quoted. Your yard doesn&apos;t get handed off to a subcontractor you&apos;ve never met.
          </p>
          <div className="founder-signoff">Paxton, Founder</div>
          <div className="founder-stats">
            <div className="founder-stat">
              <div className="founder-stat-num">2026</div>
              <div className="founder-stat-label">Founded in Hyde Park</div>
            </div>
            <div className="founder-stat">
              <div className="founder-stat-num">100%</div>
              <div className="founder-stat-label">Electric equipment</div>
            </div>
            <div className="founder-stat">
              <div className="founder-stat-num">0</div>
              <div className="founder-stat-label">Subcontractors</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
