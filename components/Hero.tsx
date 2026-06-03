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

          {/* ── Bedroom window — large, left side ── */}
          <rect x="198" y="445" width="84" height="75" rx="3" fill="#1a3828" />
          <rect x="200" y="447" width="80" height="71" rx="2" fill="#0d2018" />
          <rect x="200" y="447" width="80" height="71" rx="2" fill="#c87828" opacity=".12" />
          {/* Left curtain */}
          <rect x="200" y="447" width="14" height="71" fill="#163424" opacity=".85" />
          {/* Right curtain */}
          <rect x="266" y="447" width="14" height="71" fill="#163424" opacity=".75" />
          {/* Light seam */}
          <line x1="251" y1="447" x2="251" y2="518" stroke="#e8c060" strokeWidth="1.5" opacity=".22" />
          {/* Headboard */}
          <rect x="200" y="447" width="9" height="71" fill="#091810" opacity=".95" />
          {/* Bed base */}
          <rect x="209" y="509" width="69" height="7" rx="2" fill="#091810" opacity=".85" />
          {/* Blanket lump */}
          <rect x="209" y="488" width="69" height="23" rx="10" fill="#122818" opacity=".95" />
          <rect x="209" y="488" width="69" height="5"  rx="4"  fill="#1e4030" opacity=".5" />
          {/* Pillow */}
          <ellipse cx="222" cy="487" rx="12" ry="7" fill="#163020" opacity=".95" />
          {/* Head */}
          <circle cx="222" cy="477" r="10" fill="#091810" opacity=".95" />
          {/* Mullions */}
          <line x1="240" y1="447" x2="240" y2="518" stroke="#1a3828" strokeWidth="2" opacity=".65" />
          <line x1="200" y1="480" x2="280" y2="480" stroke="#1a3828" strokeWidth="2" opacity=".65" />

          {/* ZZZ — over sleeping person's head, float up through window */}
          <text className="zzz1" x="226" y="470" fontFamily="sans-serif" fontSize="13" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>
          <text className="zzz2" x="236" y="461" fontFamily="sans-serif" fontSize="10" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>
          <text className="zzz3" x="245" y="453" fontFamily="sans-serif" fontSize="8"  fill="#b7e4c7" fontWeight="700" opacity="0">z</text>

          {/* Small accent window — right side */}
          <rect x="356" y="450" width="42" height="42" rx="3" fill="#1a3828" />
          <rect x="358" y="452" width="38" height="38" rx="2" fill="#0d2018" />
          <line x1="377" y1="452" x2="377" y2="490" stroke="#1a3828" strokeWidth="1.5" opacity=".5" />
          <line x1="358" y1="471" x2="396" y2="471" stroke="#1a3828" strokeWidth="1.5" opacity=".5" />

          {/* Arched front door — centered */}
          <path d="M279 555 L279 515 A21 21 0 0 1 321 515 L321 555 Z" fill="#1a3828"/>
          <path d="M281 555 L281 517 A19 19 0 0 1 319 517 L319 555 Z" fill="#0d2018"/>
          <circle cx="315" cy="537" r="2.5" fill="#52b788" opacity=".7"/>

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
