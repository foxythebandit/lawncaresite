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
          {/* Warm window light spill on ground */}
          <ellipse cx="262" cy="573" rx="28" ry="7" fill="#c47015" opacity=".1" />

          {/* Walls */}
          <rect x="220" y="484" width="160" height="91" rx="2" fill="#0d2418" />

          {/* Roof */}
          <path d="M212 486 L300 418 L388 486 Z" fill="#091c11" />
          <line x1="212" y1="486" x2="300" y2="418" stroke="#2d6a4f" strokeWidth="1.5" opacity=".45" />
          <line x1="300" y1="418" x2="388" y2="486" stroke="#2d6a4f" strokeWidth="1.5" opacity=".45" />
          <line x1="212" y1="486" x2="388" y2="486" stroke="#1a4430" strokeWidth="1" opacity=".5" />

          {/* Chimney */}
          <rect x="336" y="432" width="16" height="28" fill="#091c11" />
          <rect x="334" y="430" width="20" height="5" rx="1.5" fill="#0a1a0f" />

          {/* Bedroom window — warm, lit */}
          <rect x="232" y="496" width="56" height="46" rx="3" fill="#143320" />
          <rect x="234" y="498" width="52" height="42" rx="2" fill="#b86010" opacity=".38" />
          <rect x="234" y="498" width="52" height="42" rx="2" fill="#e09020" opacity=".1" />
          {/* Sleeping silhouette — pillow, head, blanket lump */}
          <ellipse cx="260" cy="528" rx="14" ry="6"  fill="#0a1e10" opacity=".65" />
          <circle  cx="250" cy="523" r="8"            fill="#0a1e10" opacity=".75" />
          <path d="M237 529 Q260 524 284 530 L284 541 Q260 537 237 541 Z" fill="#0a1e10" opacity=".5" />
          {/* Bedside lamp glow */}
          <circle  cx="281" cy="502" r="4"            fill="#e8a020" opacity=".55" />
          <ellipse cx="281" cy="506" rx="7" ry="5"    fill="#e8a020" opacity=".16" />
          {/* Window cross */}
          <line x1="260" y1="498" x2="260" y2="540" stroke="#143320" strokeWidth="2" opacity=".7" />
          <line x1="234" y1="519" x2="286" y2="519" stroke="#143320" strokeWidth="2" opacity=".7" />

          {/* Right window — dark / unlit */}
          <rect x="306" y="496" width="40" height="36" rx="3" fill="#143320" />
          <rect x="308" y="498" width="36" height="32" rx="2" fill="#091c11" />
          <line x1="326" y1="498" x2="326" y2="530" stroke="#143320" strokeWidth="2" opacity=".55" />
          <line x1="308" y1="514" x2="344" y2="514" stroke="#143320" strokeWidth="2" opacity=".55" />

          {/* Front door */}
          <rect x="274" y="533" width="34" height="42" rx="3" fill="#143320" />
          <rect x="276" y="535" width="30" height="38" rx="2" fill="#091c11" />
          <circle cx="303" cy="555" r="2.5" fill="#2d6a4f" opacity=".7" />

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
