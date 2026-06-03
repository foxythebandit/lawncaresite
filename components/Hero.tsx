'use client'
import { useEffect, useRef } from 'react'

const MOWER_W  = 130
const START_X  = 20
const END_X    = 450
const MOWER_Y  = 560
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

    // ── Auto mower loop ──────────────────────────────────
    let autoX    = START_X
    let autoDir  = 1
    let lastFireX = START_X
    let autoRaf  = 0
    const SPEED  = 1.2

    const mowerTick = () => {
      autoX += autoDir * SPEED
      if (autoX >= END_X)   { autoX = END_X;   autoDir = -1 }
      if (autoX <= START_X) { autoX = START_X; autoDir =  1 }

      const mower = mowerRef.current
      if (mower) {
        const x  = Math.round(autoX)
        const fr = autoDir === 1
        mower.setAttribute(
          'transform',
          fr
            ? `translate(${x},${MOWER_Y})`
            : `translate(${x + MOWER_W},${MOWER_Y}) scale(-1,1)`
        )
      }

      if (Math.abs(autoX - lastFireX) >= FIRE_DIST) {
        const cx = autoDir === 1 ? autoX + 118 : autoX + 12
        spawn(cx, MOWER_Y + 36, autoDir === 1)
        lastFireX = autoX
      }

      autoRaf = requestAnimationFrame(mowerTick)
    }

    autoRaf = requestAnimationFrame(mowerTick)

    return () => {
      cancelAnimationFrame(autoRaf)
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

          {/* Morning atmosphere — brighter warm sunrise */}
          <ellipse cx="300" cy="490" rx="360" ry="170" fill="#c87020" opacity=".16"/>
          <ellipse cx="300" cy="530" rx="300" ry="110" fill="#e09030" opacity=".14"/>
          <ellipse cx="300" cy="420" rx="80"  ry="50"  fill="#f0c040" opacity=".12"/>
          <ellipse cx="300" cy="560" rx="420" ry="70"  fill="#d4a040" opacity=".1"/>
          {/* Subtle overall sky lift */}
          <rect width="600" height="580" fill="#4a7060" opacity=".06"/>

          {/* Trees — left tree shortened to clear 0g card */}
          <ellipse cx="60"  cy="370" rx="32" ry="55"  fill="#0f2e1e" opacity=".7" />
          <rect    x="52"   y="420"  width="16" height="170" fill="#0f2e1e" opacity=".7" />
          <ellipse cx="540" cy="290" rx="42" ry="100" fill="#0f2e1e" opacity=".7" />
          <rect    x="531"  y="380"  width="18" height="210" fill="#0f2e1e" opacity=".7" />

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

          {/* ── House — wider, cleaner composition ── */}
          {/* Walls */}
          <rect x="185" y="438" width="230" height="117" rx="2" fill="#2a5840" />
          <line x1="415" y1="438" x2="415" y2="555" stroke="#1e4030" strokeWidth="3" opacity=".4" />

          {/* Roof */}
          <path d="M177 440 L300 360 L423 440 Z" fill="#1e4030" />
          <line x1="177" y1="440" x2="300" y2="360" stroke="#52b788" strokeWidth="1.5" opacity=".4" />
          <line x1="300" y1="360" x2="423" y2="440" stroke="#52b788" strokeWidth="1.5" opacity=".4" />
          <line x1="177" y1="440" x2="423" y2="440" stroke="#3a7050" strokeWidth="1.5" opacity=".5" />

          {/* Chimney */}
          <rect x="358" y="383" width="18" height="32" fill="#1a3828" />
          <rect x="356" y="381" width="22" height="5" rx="1.5" fill="#163222" />

          {/* ── Bedroom window — large, left side (60px tall) ── */}
          <rect x="198" y="445" width="84" height="60" rx="3" fill="#1a3828" />
          <rect x="200" y="447" width="80" height="56" rx="2" fill="#0d2018" />
          <rect x="200" y="447" width="80" height="56" rx="2" fill="#c87828" opacity=".12" />
          <rect x="200" y="447" width="14" height="56" fill="#163424" opacity=".85" />
          <rect x="266" y="447" width="14" height="56" fill="#163424" opacity=".75" />
          <line x1="251" y1="447" x2="251" y2="503" stroke="#e8c060" strokeWidth="1.5" opacity=".22" />
          <rect x="200" y="447" width="9"  height="56" fill="#091810" opacity=".95" />
          <rect x="209" y="496" width="69" height="7"  rx="2" fill="#091810" opacity=".85" />
          <rect x="209" y="476" width="69" height="20" rx="9"  fill="#122818" opacity=".95" />
          <rect x="209" y="476" width="69" height="5"  rx="4"  fill="#1e4030" opacity=".5" />
          <ellipse cx="222" cy="475" rx="11" ry="6" fill="#163020" opacity=".95" />
          <circle  cx="222" cy="465" r="9"  fill="#091810" opacity=".95" />
          <line x1="240" y1="447" x2="240" y2="503" stroke="#1a3828" strokeWidth="2" opacity=".65" />
          <line x1="200" y1="468" x2="280" y2="468" stroke="#1a3828" strokeWidth="2" opacity=".65" />

          {/* ZZZ — over sleeping person's head */}
          <text className="zzz1" x="224" y="460" fontFamily="sans-serif" fontSize="16" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>
          <text className="zzz2" x="236" y="450" fontFamily="sans-serif" fontSize="13" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>
          <text className="zzz3" x="247" y="442" fontFamily="sans-serif" fontSize="10" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>

          {/* Small window above door — just right of bedroom window */}
          <rect x="292" y="448" width="38" height="40" rx="3" fill="#1a3828" />
          <rect x="294" y="450" width="34" height="36" rx="2" fill="#0d2018" />
          <line x1="311" y1="450" x2="311" y2="486" stroke="#1a3828" strokeWidth="1.5" opacity=".5" />
          <line x1="294" y1="468" x2="328" y2="468" stroke="#1a3828" strokeWidth="1.5" opacity=".5" />

          {/* Front door — just right of center, close to bedroom window */}
          <path d="M290 555 L290 515 A21 21 0 0 1 332 515 L332 555 Z" fill="#1a3828"/>
          <path d="M292 555 L292 517 A19 19 0 0 1 330 517 L330 555 Z" fill="#0d2018"/>
          <circle cx="327" cy="536" r="2.5" fill="#52b788" opacity=".7"/>

          {/* ── Lawn mower — smooth flat style ── */}
          <g ref={mowerRef} transform={`translate(${START_X},${MOWER_Y})`}>

            {/* Rear wheel */}
            <circle cx="20" cy="52" r="18" fill="#0f2e1e" stroke="#52b788" strokeWidth="2.5"/>
            <path d="M4 43 A18 18 0 0 1 36 43" stroke="#74c9a0" strokeWidth="2" fill="none" opacity=".5"/>
            <circle cx="20" cy="52" r="7" fill="#2d6a4f"/>
            <circle cx="20" cy="52" r="3" fill="#143320"/>
            <line x1="20" y1="34" x2="20" y2="70" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>
            <line x1="2"  y1="52" x2="38" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>

            {/* Front wheel */}
            <circle cx="110" cy="52" r="16" fill="#0f2e1e" stroke="#52b788" strokeWidth="2.5"/>
            <path d="M95 43 A16 16 0 0 1 125 43" stroke="#74c9a0" strokeWidth="2" fill="none" opacity=".5"/>
            <circle cx="110" cy="52" r="6" fill="#2d6a4f"/>
            <circle cx="110" cy="52" r="3" fill="#143320"/>
            <line x1="110" y1="36" x2="110" y2="68" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>
            <line x1="94"  y1="52" x2="126" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>

            {/* Deck — single smooth rounded rect */}
            <rect x="2" y="16" width="126" height="30" rx="14" fill="#eef8f2"/>

            {/* Engine housing */}
            <rect x="26" y="4" width="60" height="16" rx="9" fill="#e0f0e8"/>

            {/* EV battery badge */}
            <rect x="33" y="24" width="44" height="14" rx="4"   fill="#2d6a4f"/>
            <rect x="77" y="27" width="5"  height="8"  rx="1.5" fill="#2d6a4f"/>
            <rect x="34" y="25" width="38" height="12" rx="3"   fill="#52b788" opacity=".9"/>
            <text x="53" y="34" fontFamily="sans-serif" fontSize="10" fill="#1a3a2a" fontWeight="700" textAnchor="middle">EV</text>

            {/* Discharge chute */}
            <rect x="126" y="20" width="14" height="20" rx="7" fill="#cceadb" opacity=".75"/>

            {/* Handle bars */}
            <line x1="10" y1="18" x2="-16" y2="-26" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round"/>
            <line x1="24" y1="18" x2="-2"  y2="-26" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round"/>
            <line x1="-16" y1="-26" x2="-2" y2="-26" stroke="#b7e4c7" strokeWidth="5" strokeLinecap="round"/>

            {/* Blade indicator */}
            <line x1="4" y1="46" x2="124" y2="46" stroke="#52b788" strokeWidth="1" strokeDasharray="6 4" opacity=".22"/>
          </g>

          {/* Particle container — after mower so clippings render in front */}
          <g ref={pGroupRef} />
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
