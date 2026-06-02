export default function Hero() {
  return (
    <section className="hero">
      <div className="hero-left">
        <div className="hero-badge">
          <div className="badge-pulse" />
          100% electric — zero emissions
        </div>
        <h1 className="hero-h1">
          Your lawn.<br />
          Your <em>peace</em><br />
          and quiet.
        </h1>
        <p className="hero-p">
          The only lawn care crew you won&apos;t hear coming. Battery-powered
          equipment, zero fumes, and a finish your yard deserves — scheduled
          around your life.
        </p>
        <div className="hero-actions">
          <a href="#map-quote" className="btn-primary">
            Get a free quote
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </a>
          <a href="#how" className="btn-secondary">
            See how it works
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 1v12M1 7l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      <div className="hero-right">
        <svg
          className="hero-illustration"
          viewBox="0 0 600 800"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="600" height="800" fill="#1a3a2a" />
          <circle cx="80" cy="60" r="1.5" fill="#52b788" opacity=".4" />
          <circle cx="200" cy="40" r="1" fill="#52b788" opacity=".3" />
          <circle cx="380" cy="90" r="1.5" fill="#52b788" opacity=".4" />
          <circle cx="480" cy="50" r="1" fill="#52b788" opacity=".25" />
          <circle cx="540" cy="130" r="2" fill="#52b788" opacity=".3" />
          <circle cx="140" cy="150" r="1" fill="#52b788" opacity=".2" />
          <circle cx="320" cy="30" r="1.5" fill="#b7e4c7" opacity=".2" />

          <ellipse cx="60" cy="320" rx="38" ry="90" fill="#0f2e1e" opacity=".7" />
          <rect x="52" y="400" width="16" height="80" fill="#0f2e1e" opacity=".7" />
          <ellipse cx="540" cy="290" rx="42" ry="100" fill="#0f2e1e" opacity=".7" />
          <rect x="531" y="380" width="18" height="80" fill="#0f2e1e" opacity=".7" />

          <ellipse cx="300" cy="620" rx="360" ry="80" fill="#2d6a4f" />
          <rect x="0" y="600" width="600" height="200" fill="#2d6a4f" />

          <path d="M0 640 Q150 620 300 640 Q450 660 600 640" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".5" />
          <path d="M0 660 Q150 640 300 660 Q450 680 600 660" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".4" />
          <path d="M0 680 Q150 660 300 680 Q450 700 600 680" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".3" />

          <path d="M20 700 L580 700" stroke="#52b788" strokeWidth="1" opacity=".15" />
          <path d="M20 715 L580 715" stroke="#52b788" strokeWidth="1" opacity=".15" />
          <path d="M20 730 L580 730" stroke="#52b788" strokeWidth="1" opacity=".15" />

          <g transform="translate(200,540)">
            <rect x="0" y="20" width="140" height="50" rx="8" fill="#f0faf4" />
            <path d="M110 20 L130 -30 M10 20 L-10 -30" stroke="#b7e4c7" strokeWidth="6" strokeLinecap="round" fill="none" />
            <line x1="-10" y1="-30" x2="130" y2="-30" stroke="#b7e4c7" strokeWidth="6" strokeLinecap="round" />
            <circle cx="20" cy="72" r="14" fill="#1a3a2a" stroke="#52b788" strokeWidth="2.5" />
            <circle cx="120" cy="72" r="14" fill="#1a3a2a" stroke="#52b788" strokeWidth="2.5" />
            <circle cx="20" cy="72" r="5" fill="#52b788" />
            <circle cx="120" cy="72" r="5" fill="#52b788" />
            <rect x="45" y="32" width="50" height="24" rx="4" fill="#2d6a4f" />
            <rect x="95" y="37" width="6" height="14" rx="2" fill="#2d6a4f" />
            <rect x="48" y="35" width="36" height="18" rx="3" fill="#52b788" opacity=".9" />
            <text x="58" y="48" fontFamily="sans-serif" fontSize="11" fill="#1a3a2a" fontWeight="600">EV</text>
            <ellipse cx="70" cy="90" rx="55" ry="6" fill="#52b788" opacity=".3" />
          </g>

          <g opacity=".5">
            <path d="M370 490 Q380 480 390 490 Q400 500 410 490" stroke="#52b788" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M375 478 Q390 464 405 478" stroke="#52b788" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity=".6" />
          </g>
          <circle cx="390" cy="490" r="28" fill="none" stroke="#52b788" strokeWidth="1" opacity=".3" />
          <line x1="368" y1="468" x2="412" y2="512" stroke="#52b788" strokeWidth="1.5" opacity=".4" strokeLinecap="round" />
        </svg>

        <div className="stat-card card-1">
          <div className="stat-card-val">60<span>dB</span></div>
          <div className="stat-card-label">Library-quiet operation</div>
        </div>
        <div className="stat-card card-2">
          <div className="stat-card-val">0<span>g</span></div>
          <div className="stat-card-label">Zero emissions, zero fumes</div>
        </div>
      </div>
    </section>
  )
}
