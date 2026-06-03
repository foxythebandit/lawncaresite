export default function HowItWorks() {
  return (
    <section className="how" id="how">
      <div className="section-label reveal">How it works</div>
      <h2 className="section-h2 reveal" data-delay="80">Three steps to a quieter lawn</h2>
      <p className="section-sub reveal" data-delay="160">No contracts. No surprises. Just a cleaner, greener lawn — without the noise.</p>
      <div className="steps">
        <div className="step reveal" data-delay="0">
          <div className="step-num">01</div>
          <h3>Get your free quote</h3>
          <p>Tell us about your yard in 60 seconds. We&apos;ll send a clear, fixed-price quote — no upsells, no vague estimates.</p>
        </div>
        <div className="step reveal" data-delay="150">
          <div className="step-num">02</div>
          <h3>We arrive quietly</h3>
          <p>Our electric-only crew shows up on schedule. Every visit is the full treatment — mow, edge every border crisp, blow all clippings off hard surfaces, and a complete cleanup. Zero gas, zero exhaust, zero disruption.</p>
        </div>
        <div className="step reveal" data-delay="300">
          <div className="step-num">03</div>
          <h3>Enjoy your lawn</h3>
          <p>We leave the place spotless — driveways clear, edges sharp, not a clipping out of place. You&apos;ll barely know we were there, except for the perfectly finished lawn.</p>
        </div>
      </div>

      <div className="included-row reveal" data-delay="100">
        <div className="included-label">Every visit includes</div>
        <div className="included-items">
          <div className="included-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8.5l4 4 8-8" />
            </svg>
            Full mow
          </div>
          <div className="included-sep" />
          <div className="included-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8.5l4 4 8-8" />
            </svg>
            Crisp edging
          </div>
          <div className="included-sep" />
          <div className="included-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8.5l4 4 8-8" />
            </svg>
            Clipping blowdown
          </div>
          <div className="included-sep" />
          <div className="included-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8.5l4 4 8-8" />
            </svg>
            Complete cleanup
          </div>
        </div>
      </div>
    </section>
  )
}
