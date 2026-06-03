'use client'
import { useEffect, useRef } from 'react'

const MOWER_W  = 130
const START_X  = 20
const END_X    = 450
const MOWER_Y  = 530

export default function Hero() {
  const mowerRef = useRef<SVGGElement>(null)

  useEffect(() => {
    let facingRight = true
    let lastScrollY = window.scrollY

    const onScroll = () => {
      const mower = mowerRef.current
      if (!mower) return

      const pct = Math.min(Math.max(window.scrollY / window.innerHeight, 0), 1)
      const x   = START_X + Math.round(pct * (END_X - START_X))

      const scrollingDown = window.scrollY >= lastScrollY
      facingRight  = scrollingDown
      lastScrollY  = window.scrollY

      mower.setAttribute(
        'transform',
        facingRight
          ? `translate(${x}, ${MOWER_Y})`
          : `translate(${x + MOWER_W}, ${MOWER_Y}) scale(-1,1)`
      )
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
          {/* Sky */}
          <rect width="600" height="800" fill="#1a3a2a" />

          {/* Stars */}
          <circle cx="80"  cy="60"  r="1.5" fill="#52b788" opacity=".4" />
          <circle cx="200" cy="40"  r="1"   fill="#52b788" opacity=".3" />
          <circle cx="380" cy="90"  r="1.5" fill="#52b788" opacity=".4" />
          <circle cx="480" cy="50"  r="1"   fill="#52b788" opacity=".25" />
          <circle cx="540" cy="130" r="2"   fill="#52b788" opacity=".3" />
          <circle cx="140" cy="150" r="1"   fill="#52b788" opacity=".2" />
          <circle cx="320" cy="30"  r="1.5" fill="#b7e4c7" opacity=".2" />

          {/* Trees */}
          <ellipse cx="60"  cy="320" rx="38" ry="90"  fill="#0f2e1e" opacity=".7" />
          <rect    x="52"   y="400"  width="16" height="80" fill="#0f2e1e" opacity=".7" />
          <ellipse cx="540" cy="290" rx="42" ry="100" fill="#0f2e1e" opacity=".7" />
          <rect    x="531"  y="380"  width="18" height="80" fill="#0f2e1e" opacity=".7" />

          {/* Grass */}
          <ellipse cx="300" cy="620" rx="360" ry="80" fill="#2d6a4f" />
          <rect x="0" y="600" width="600" height="200" fill="#2d6a4f" />

          {/* Mow stripes */}
          <path d="M0 640 Q150 620 300 640 Q450 660 600 640" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".5" />
          <path d="M0 660 Q150 640 300 660 Q450 680 600 660" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".4" />
          <path d="M0 680 Q150 660 300 680 Q450 700 600 680" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".3" />
          <path d="M20 700 L580 700" stroke="#52b788" strokeWidth="1" opacity=".15" />
          <path d="M20 715 L580 715" stroke="#52b788" strokeWidth="1" opacity=".15" />
          <path d="M20 730 L580 730" stroke="#52b788" strokeWidth="1" opacity=".15" />

          {/* ── Lawn mower (scroll-driven) ── */}
          <g ref={mowerRef} transform={`translate(${START_X}, ${MOWER_Y})`}>
            {/* Ground shadow */}
            <ellipse cx="65" cy="72" rx="66" ry="7" fill="#0d2118" opacity=".55" />

            {/* Rear wheel (left) */}
            <circle cx="20" cy="52" r="18" fill="#0f2e1e" stroke="#52b788" strokeWidth="2.5" />
            <circle cx="20" cy="52" r="7"  fill="#2d6a4f" />
            <line x1="20" y1="34" x2="20" y2="70" stroke="#52b788" strokeWidth="1.5" opacity=".45" />
            <line x1="2"  y1="52" x2="38" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".45" />

            {/* Front wheel (right) */}
            <circle cx="108" cy="52" r="16" fill="#0f2e1e" stroke="#52b788" strokeWidth="2.5" />
            <circle cx="108" cy="52" r="6"  fill="#2d6a4f" />
            <line x1="108" y1="36" x2="108" y2="68" stroke="#52b788" strokeWidth="1.5" opacity=".45" />
            <line x1="92"  y1="52" x2="124" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".45" />

            {/* Main deck */}
            <rect x="4" y="22" width="112" height="26" rx="8" fill="#f0faf4" />

            {/* Engine housing */}
            <rect x="28" y="10" width="56" height="16" rx="5" fill="#e4f5ec" />

            {/* Electric badge */}
            <rect x="34" y="13" width="44" height="9" rx="3" fill="#1a3a2a" />
            <text x="39" y="20" fontFamily="sans-serif" fontSize="8" fill="#52b788" fontWeight="700">⚡ ELEC</text>

            {/* Side discharge chute (right / front side) */}
            <path d="M116 28 Q132 34 130 46 L116 44 Z" fill="#cceadb" opacity=".75" />

            {/* Handle bars (left / rear side, extend up-left) */}
            <line x1="10" y1="24" x2="-16" y2="-24" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round" />
            <line x1="24" y1="24" x2="-2"  y2="-24" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round" />
            <line x1="-16" y1="-24" x2="-2" y2="-24" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round" />

            {/* Blade indicator dashes under deck */}
            <line x1="6" y1="48" x2="114" y2="48" stroke="#52b788" strokeWidth="1" strokeDasharray="6 4" opacity=".3" />
          </g>
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
