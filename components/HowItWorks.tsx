const noiseBars = [
  { name: 'Gas hedge trimmer',             db: '103 dB — pain threshold',       width: '95%', cls: 'bar-red'   },
  { name: 'Gas leaf blower',               db: '92 dB — hearing damage risk',   width: '84%', cls: 'bar-red'   },
  { name: 'Gas lawn mower',                db: '85 dB — city traffic level',    width: '77%', cls: 'bar-amber' },
  { name: 'QuietGreen electric equipment', db: '60 dB — washing machine level', width: '54%', cls: 'bar-green', highlight: true },
]

export default function HowItWorks() {
  return (
    <section className="how" id="how">
      <div className="section-label reveal">How &amp; why</div>

      <div className="how-two-col">

        {/* ── Left: Steps ── */}
        <div className="how-col">
          <h2 className="section-h2 reveal" data-delay="60">Three steps to a quieter lawn</h2>

          <div className="steps-v">
            <div className="step-v reveal" data-delay="160">
              <div className="step-num">01</div>
              <div>
                <h3>Get your free quote</h3>
                <p>Map your yard in 60 seconds. We&apos;ll send a clear, fixed-price quote — no upsells, no vague estimates.</p>
              </div>
            </div>
            <div className="step-v reveal" data-delay="240">
              <div className="step-num">02</div>
              <div>
                <h3>We arrive quietly</h3>
                <p>Our electric-only crew shows up on schedule — mow, edge, blow clippings, full cleanup. Zero gas, zero exhaust, zero disruption.</p>
              </div>
            </div>
            <div className="step-v reveal" data-delay="320">
              <div className="step-num">03</div>
              <div>
                <h3>Enjoy your lawn</h3>
                <p>Driveways clear, edges sharp, not a clipping out of place. You&apos;ll barely know we were there.</p>
              </div>
            </div>
          </div>

        </div>

        {/* ── Right: Numbers ── */}
        <div className="how-col">
          <h2 className="section-h2 reveal" data-delay="60">Hear the difference</h2>
          <p className="section-sub reveal" data-delay="120">Gas equipment doesn&apos;t just sound loud — it&apos;s classified as a noise hazard. Here&apos;s how electric compares.</p>

          <div className="noise-bars" style={{ marginTop: 40 }}>
            {noiseBars.map((bar, i) => (
              <div key={bar.name} className="noise-row reveal" data-delay={i * 100 + 160}>
                <div className="noise-meta">
                  <span className="noise-name" style={bar.highlight ? { color: 'var(--green-mid)', fontSize: '17px' } : undefined}>
                    {bar.name}
                  </span>
                  <span className="noise-db" style={bar.highlight ? { color: 'var(--green-mid)', fontWeight: 500, fontSize: '14px' } : undefined}>
                    {bar.db}
                  </span>
                </div>
                <div className="noise-bar-bg">
                  <div
                    className={`noise-bar-fill ${bar.cls}`}
                    style={{ width: 0 }}
                    data-reveal-width={bar.width}
                    data-delay={i * 100 + 260}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="noise-note reveal" style={{ marginTop: 24 }} data-delay="460">
            * dB levels measured at operator distance. The scale is logarithmic — 10 dB difference = 10× the perceived loudness.
          </p>
        </div>

      </div>

      {/* ── Full-width included band ── */}
      <div className="included-row reveal" data-delay="380">
        <div className="included-label">Every visit includes</div>
        <div className="included-items">
          {['Full mow', 'Crisp edging', 'Clipping blowdown', 'Complete cleanup'].map(item => (
            <div key={item} className="included-item">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8.5l4 4 8-8" />
              </svg>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
