const bars = [
  { name: 'Gas hedge trimmer',             db: '103 dB — pain threshold',       width: '95%', cls: 'bar-red',   shake: 'intense' },
  { name: 'Gas leaf blower',               db: '92 dB — hearing damage risk',   width: '84%', cls: 'bar-red',   shake: 'strong'  },
  { name: 'Gas lawn mower',                db: '85 dB — city traffic level',    width: '77%', cls: 'bar-amber', shake: 'mild'    },
  { name: 'QuietGreen electric equipment', db: '60 dB — washing machine level', width: '54%', cls: 'bar-green', shake: '',       highlight: true },
]

export default function NoiseComparison() {
  return (
    <section className="noise">
      <div className="section-label reveal">The numbers</div>
      <h2 className="section-h2 reveal" data-delay="80">Hear the difference</h2>
      <p className="section-sub reveal" data-delay="160">
        Gas equipment doesn&apos;t just sound loud — it&apos;s classified as a noise
        hazard. Here&apos;s how electric compares.
      </p>
      <div className="noise-bars">
        {bars.map((bar, i) => (
          <div key={bar.name} className="noise-row reveal" data-delay={i * 100}>
            <div className="noise-meta">
              <span
                className="noise-name"
                style={bar.highlight ? { color: 'var(--green-mid)', fontWeight: 500 } : undefined}
              >
                {bar.name}
              </span>
              <span
                className="noise-db"
                style={bar.highlight ? { color: 'var(--green-mid)' } : undefined}
              >
                {bar.db}
              </span>
            </div>
            <div className="noise-bar-bg">
              <div
                className={`noise-bar-fill ${bar.cls}`}
                style={{ width: 0 }}
                data-reveal-width={bar.width}
                data-delay={i * 100 + 200}
                data-shake={bar.shake}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="noise-note reveal" style={{ marginTop: '28px' }} data-delay="200">
        * dB levels measured at operator distance. Lower = quieter. The scale is
        logarithmic — 10 dB difference = 10× the perceived loudness.
      </p>
    </section>
  )
}
