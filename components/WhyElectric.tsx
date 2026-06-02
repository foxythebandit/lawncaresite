export default function WhyElectric() {
  return (
    <section className="why" id="why">
      <div className="section-label">Why electric</div>
      <h2 className="section-h2">Better for you.<br />Better for the planet.</h2>
      <p className="section-sub">Gas crews are loud, polluting, and increasingly banned. We built the alternative.</p>
      <div className="why-grid">
        <div className="why-card">
          <div className="why-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <h3>Whisper quiet</h3>
          <p>Our equipment runs at 60 dB — roughly the sound of a normal conversation. Gas crews hit 100 dB. You&apos;ll notice the difference immediately.</p>
          <div className="why-stat">60 dB</div>
        </div>
        <div className="why-card">
          <div className="why-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 20h20M6 20V10M10 20V4M14 20V8M18 20V14" />
            </svg>
          </div>
          <h3>Zero emissions</h3>
          <p>One gas leaf blower running for a day emits more pollution than a pickup truck driven for a year. Our fleet emits nothing.</p>
          <div className="why-stat">100% clean</div>
        </div>
        <div className="why-card">
          <div className="why-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <h3>WFH friendly</h3>
          <p>Working from home? No more losing your morning to gas blower crews. Schedule us around your meetings — we&apos;re the crew that won&apos;t interrupt your calls.</p>
          <div className="why-stat">No disruption</div>
        </div>
        <div className="why-card">
          <div className="why-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <h3>Regulation-ready</h3>
          <p>Over 200 cities have restricted gas-powered blowers. We&apos;re already ahead of the curve — future-proof lawn care that works everywhere, now and later.</p>
          <div className="why-stat">200+ cities</div>
        </div>
      </div>
    </section>
  )
}
