'use client'
import { useEffect, useRef } from 'react'

const MOWER_W  = 130
const START_X  = 20
const END_X    = 450
const MOWER_Y  = 530
const POOL     = 12
const FIRE_DIST = 16

const CLIP_SHAPES = [
  { x2:  3, y2: 7 }, { x2: -2, y2: 6 }, { x2:  4, y2: 5 },
  { x2: -3, y2: 8 }, { x2:  2, y2: 6 }, { x2: -4, y2: 5 },
  { x2:  3, y2: 6 }, { x2: -1, y2: 7 }, { x2:  5, y2: 5 },
  { x2: -2, y2: 5 }, { x2:  4, y2: 7 }, { x2: -3, y2: 6 },
]

export default function Hero() {
  const mowerRef  = useRef<SVGGElement>(null)
  const pGroupRef = useRef<SVGGElement>(null)

  useEffect(() => {
    // ── Particle pool ────────────────────────────────────
    const pEls: SVGGElement[] = []
    const ps = Array.from({ length: POOL }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false,
    }))
    let pIdx = 0
    let pRaf = 0

    const group = pGroupRef.current
    if (group) {
      CLIP_SHAPES.forEach(shape => {
        const g    = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        line.setAttribute('x1', '0'); line.setAttribute('y1', '0')
        line.setAttribute('x2', String(shape.x2)); line.setAttribute('y2', String(shape.y2))
        line.setAttribute('stroke', '#95dbb8')
        line.setAttribute('stroke-width', '2')
        line.setAttribute('stroke-linecap', 'round')
        g.setAttribute('opacity', '0')
        g.appendChild(line)
        group.appendChild(g)
        pEls.push(g)
      })
    }

    const tick = () => {
      let anyAlive = false
      for (let i = 0; i < POOL; i++) {
        const p = ps[i]; const el = pEls[i]
        if (!p.active || !el) continue
        anyAlive = true
        p.x  += p.vx
        p.y  += p.vy
        p.vy += 0.28
        p.life -= 0.052
        if (p.life <= 0) {
          p.active = false
          el.setAttribute('opacity', '0')
        } else {
          el.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`)
          el.setAttribute('opacity', p.life.toFixed(2))
        }
      }
      if (anyAlive) pRaf = requestAnimationFrame(tick)
    }

    const spawn = (cx: number, cy: number, right: boolean) => {
      for (let i = 0; i < 4; i++) {
        const idx = (pIdx + i) % POOL
        const p = ps[idx]; const el = pEls[idx]
        if (!el) continue
        const spread = (Math.random() - 0.5) * 22
        p.x = cx + spread; p.y = cy
        p.vx = (right ? 1 : -1) * (Math.random() * 2 + 0.8) + (Math.random() - 0.5)
        p.vy = -(Math.random() * 4 + 2.5)
        p.life = 0.75 + Math.random() * 0.25
        p.active = true
        el.setAttribute('transform', `translate(${p.x},${p.y})`)
        el.setAttribute('opacity', String(p.life))
      }
      pIdx = (pIdx + 4) % POOL
      cancelAnimationFrame(pRaf)
      pRaf = requestAnimationFrame(tick)
    }

    // ── Scroll handler ───────────────────────────────────
    let lastScrollY   = window.scrollY
    let facingRight   = true
    let lastFireX     = START_X

    const onScroll = () => {
      const mower = mowerRef.current
      if (!mower) return

      const pct = Math.min(Math.max(window.scrollY / window.innerHeight, 0), 1)
      const x   = START_X + Math.round(pct * (END_X - START_X))

      facingRight = window.scrollY >= lastScrollY
      lastScrollY = window.scrollY

      mower.setAttribute(
        'transform',
        facingRight
          ? `translate(${x},${MOWER_Y})`
          : `translate(${x + MOWER_W},${MOWER_Y}) scale(-1,1)`
      )

      if (Math.abs(x - lastFireX) >= FIRE_DIST) {
        const cx = facingRight ? x + 118 : x + 12
        spawn(cx, MOWER_Y + 36, facingRight)
        lastFireX = x
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(pRaf)
      pEls.forEach(el => el.parentNode?.removeChild(el))
    }
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
          <em>Finally</em> quiet.
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

          {/* ── House ── */}
          {/* Morning light spill on grass below window */}
          <ellipse cx="248" cy="588" rx="32" ry="6" fill="#e8c060" opacity=".12" />

          {/* Walls — lighter green so it reads against the dark sky */}
          <rect x="200" y="473" width="200" height="117" rx="2" fill="#2a5840" />
          {/* Wall edge shadow (right) */}
          <line x1="400" y1="473" x2="400" y2="590" stroke="#1e4030" strokeWidth="3" opacity=".5" />

          {/* Roof */}
          <path d="M192 475 L300 400 L408 475 Z" fill="#1e4030" />
          {/* Ridge highlight */}
          <line x1="192" y1="475" x2="300" y2="400" stroke="#52b788" strokeWidth="1.5" opacity=".4" />
          <line x1="300" y1="400" x2="408" y2="475" stroke="#52b788" strokeWidth="1.5" opacity=".4" />
          {/* Eave line */}
          <line x1="192" y1="475" x2="408" y2="475" stroke="#3a7050" strokeWidth="1.5" opacity=".5" />

          {/* Chimney */}
          <rect x="344" y="418" width="18" height="32" fill="#1a3828" />
          <rect x="342" y="416" width="22" height="5"  rx="1.5" fill="#163222" />

          {/* ── Bedroom window — morning light, person in bed ── */}
          {/* Frame */}
          <rect x="210" y="484" width="78" height="65" rx="3" fill="#1a3828" />
          {/* Morning sky — cool blue at top */}
          <rect x="212" y="486" width="74" height="30" rx="2" fill="#8ec4d8" opacity=".22" />
          {/* Morning sun warmth — golden at bottom */}
          <rect x="212" y="514" width="74" height="33" rx="2" fill="#e8c060" opacity=".32" />
          {/* Rising sun in top-right corner */}
          <circle cx="278" cy="494" r="9"  fill="#f5d050" opacity=".85" />
          <line x1="278" y1="482" x2="278" y2="479" stroke="#f5d050" strokeWidth="1.5" opacity=".6" />
          <line x1="288" y1="485" x2="290" y2="482" stroke="#f5d050" strokeWidth="1.5" opacity=".6" />
          <line x1="265" y1="486" x2="262" y2="483" stroke="#f5d050" strokeWidth="1.5" opacity=".6" />
          {/* ── Bed & sleeping person ── */}
          {/* Headboard — left wall of room, visible strip */}
          <rect x="212" y="486" width="9" height="63" fill="#143020" opacity=".8" />
          {/* Bed base */}
          <rect x="221" y="541" width="63" height="8"  rx="2" fill="#143020" opacity=".7" />
          {/* Blanket — clear horizontal body lump */}
          <rect x="221" y="521" width="63" height="22" rx="9" fill="#1e4830" opacity=".85" />
          {/* Slight blanket highlight (top edge) */}
          <rect x="221" y="521" width="63" height="5"  rx="4" fill="#2d6a4f" opacity=".5" />
          {/* Pillow */}
          <ellipse cx="232" cy="520" rx="10" ry="6" fill="#244830" opacity=".9" />
          {/* Head — clearly above/on pillow */}
          <circle  cx="232" cy="512" r="9"  fill="#143020" opacity=".9" />
          {/* Window mullions */}
          <line x1="249" y1="486" x2="249" y2="549" stroke="#1a3828" strokeWidth="2" opacity=".7" />
          <line x1="212" y1="517" x2="286" y2="517" stroke="#1a3828" strokeWidth="2" opacity=".7" />

          {/* Right window — dark / unlit */}
          <rect x="314" y="487" width="50" height="50" rx="3" fill="#1a3828" />
          <rect x="316" y="489" width="46" height="46" rx="2" fill="#163020" />
          <line x1="339" y1="489" x2="339" y2="535" stroke="#1a3828" strokeWidth="2" opacity=".55" />
          <line x1="316" y1="512" x2="362" y2="512" stroke="#1a3828" strokeWidth="2" opacity=".55" />

          {/* Front door */}
          <rect x="270" y="535" width="40" height="55" rx="3" fill="#1a3828" />
          <rect x="272" y="537" width="36" height="51" rx="2" fill="#143020" />
          <circle cx="306" cy="562" r="2.5" fill="#52b788" opacity=".7" />

          {/* Particle container */}
          <g ref={pGroupRef} />

          {/* ── 3-D Lawn mower (scroll-driven) ── */}
          <g ref={mowerRef} transform={`translate(${START_X},${MOWER_Y})`}>

            {/* Ground shadow */}
            <ellipse cx="65" cy="74" rx="68" ry="7" fill="#0d2118" opacity=".6" />

            {/* ── Rear wheel ── */}
            {/* Tyre depth (dark ellipse behind wheel) */}
            <ellipse cx="20" cy="66" rx="18" ry="4" fill="#060f0a" opacity=".55" />
            {/* Tyre */}
            <circle cx="20" cy="52" r="18" fill="#0f2e1e" stroke="#3d9a6a" strokeWidth="2.5" />
            {/* Rim highlight — upper arc suggests 3-D roundness */}
            <path d="M4 43 A18 18 0 0 1 36 43" stroke="#74c9a0" strokeWidth="2" fill="none" opacity=".55" />
            {/* Hub + spokes */}
            <circle cx="20" cy="52" r="7" fill="#2d6a4f" />
            <circle cx="20" cy="52" r="3" fill="#143320" />
            <line x1="20" y1="34" x2="20" y2="70" stroke="#52b788" strokeWidth="1.5" opacity=".35" />
            <line x1="2"  y1="52" x2="38" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".35" />
            <line x1="7"  y1="39" x2="33" y2="65" stroke="#52b788" strokeWidth="1"   opacity=".22" />
            <line x1="33" y1="39" x2="7"  y2="65" stroke="#52b788" strokeWidth="1"   opacity=".22" />

            {/* ── Front wheel ── */}
            <ellipse cx="108" cy="65" rx="16" ry="3.5" fill="#060f0a" opacity=".55" />
            <circle cx="108" cy="52" r="16" fill="#0f2e1e" stroke="#3d9a6a" strokeWidth="2.5" />
            <path d="M93 43 A16 16 0 0 1 123 43" stroke="#74c9a0" strokeWidth="2" fill="none" opacity=".55" />
            <circle cx="108" cy="52" r="6"  fill="#2d6a4f" />
            <circle cx="108" cy="52" r="3"  fill="#143320" />
            <line x1="108" y1="36" x2="108" y2="68" stroke="#52b788" strokeWidth="1.5" opacity=".35" />
            <line x1="92"  y1="52" x2="124" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".35" />
            <line x1="96"  y1="40" x2="120" y2="64" stroke="#52b788" strokeWidth="1"   opacity=".22" />
            <line x1="120" y1="40" x2="96"  y2="64" stroke="#52b788" strokeWidth="1"   opacity=".22" />

            {/* ── Deck — 3-D top + side faces ── */}
            {/* Top face (lighter, sits above the side face) */}
            <path d="M6 14 L116 14 L116 22 L4 22 Z" fill="#f7fcf9" />
            {/* Side face */}
            <rect x="4" y="22" width="112" height="26" rx="8" fill="#e8f4ee" />
            {/* Top-face front edge highlight */}
            <line x1="6" y1="14" x2="116" y2="14" stroke="#fff" strokeWidth="1" opacity=".45" />
            {/* Side-face bottom edge shadow */}
            <line x1="6" y1="47" x2="114" y2="47" stroke="#b8d8c4" strokeWidth="1" opacity=".6" />

            {/* ── Engine housing — 3-D ── */}
            {/* Top face */}
            <path d="M30 5 L84 5 L84 10 L28 10 Z" fill="#f4faf6" />
            {/* Side face */}
            <rect x="28" y="10" width="56" height="14" rx="5" fill="#dff2e8" />
            {/* Top highlight */}
            <line x1="30" y1="5" x2="84" y2="5" stroke="#fff" strokeWidth="1" opacity=".4" />

            {/* EV battery badge — centred on deck side face */}
            <rect x="39" y="28" width="42" height="14" rx="3"   fill="#2d6a4f" />
            <rect x="81" y="31" width="5"  height="8"  rx="1.5" fill="#2d6a4f" />
            <rect x="40" y="29" width="36" height="12" rx="2"   fill="#52b788" opacity=".9" />
            <text x="58" y="38" fontFamily="sans-serif" fontSize="10" fill="#1a3a2a" fontWeight="700" textAnchor="middle">EV</text>

            {/* ── Discharge chute (right / front) ── */}
            {/* Side face */}
            <path d="M116 28 Q133 34 130 46 L116 44 Z" fill="#cceadb" opacity=".8" />
            {/* Top face */}
            <path d="M116 22 Q133 26 133 34 L116 28 Z" fill="#d8f0e4" opacity=".65" />

            {/* ── Handle bars ── */}
            {/* Shadow behind handles */}
            <line x1="10" y1="22" x2="-16" y2="-26" stroke="#071410" strokeWidth="7" strokeLinecap="round" opacity=".18" />
            <line x1="24" y1="22" x2="-2"  y2="-26" stroke="#071410" strokeWidth="7" strokeLinecap="round" opacity=".18" />
            {/* Handles */}
            <line x1="10" y1="22" x2="-16" y2="-26" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round" />
            <line x1="24" y1="22" x2="-2"  y2="-26" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round" />
            {/* Cross-bar */}
            <line x1="-16" y1="-26" x2="-2" y2="-26" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round" />
            {/* Grip highlight */}
            <line x1="-16" y1="-26" x2="-2" y2="-26" stroke="#e0f5ec" strokeWidth="2" strokeLinecap="round" opacity=".5" />

            {/* Blade indicator */}
            <line x1="6" y1="48" x2="114" y2="48" stroke="#52b788" strokeWidth="1" strokeDasharray="6 4" opacity=".28" />
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
