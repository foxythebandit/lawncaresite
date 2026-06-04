'use client'
import { useEffect, useRef } from 'react'

const MOWER_W  = 130
const START_X  = 20
const END_X    = 295
const MOWER_Y  = 535
const POOL     = 12
const FIRE_DIST = 16

const CLIP_SHAPES = [
  { x2:  3, y2: 7 }, { x2: -2, y2: 6 }, { x2:  4, y2: 5 },
  { x2: -3, y2: 8 }, { x2:  2, y2: 6 }, { x2: -4, y2: 5 },
  { x2:  3, y2: 6 }, { x2: -1, y2: 7 }, { x2:  5, y2: 5 },
  { x2: -2, y2: 5 }, { x2:  4, y2: 7 }, { x2: -3, y2: 6 },
]

export default function Hero() {
  const mowerRef      = useRef<SVGGElement>(null)
  const pGroupRef     = useRef<SVGGElement>(null)
  const rearWheelRef  = useRef<SVGGElement>(null)
  const frontWheelRef = useRef<SVGGElement>(null)
  const evBadgeRef    = useRef<SVGGElement>(null)

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
      for (let i = 0; i < 3; i++) {
        const idx = (pIdx + i) % POOL
        const p = ps[idx]; const el = pEls[idx]
        if (!el) continue
        p.x = cx + (Math.random() - 0.5) * 10
        p.y = cy
        p.vx = (right ? 1 : -1) * (Math.random() * 2.5 + 1.2)
        p.vy = -(Math.random() * 3 + 2)
        p.life = 0.8 + Math.random() * 0.2
        p.active = true
        el.setAttribute('transform', `translate(${p.x},${p.y})`)
        el.setAttribute('opacity', String(p.life))
      }
      pIdx = (pIdx + 3) % POOL
      cancelAnimationFrame(pRaf)
      pRaf = requestAnimationFrame(tick)
    }

    // ── Auto mower loop ──────────────────────────────────
    let autoX     = START_X
    let autoDir   = 1
    let lastFireX = START_X
    let totalDist = 0
    let autoRaf   = 0
    const SPEED   = 1.2

    const mowerTick = () => {
      totalDist += SPEED
      autoX += autoDir * SPEED
      if (autoX >= END_X)   { autoX = END_X;   autoDir = -1 }
      if (autoX <= START_X) { autoX = START_X; autoDir =  1 }

      const x  = Math.round(autoX)
      const fr = autoDir === 1

      const mower = mowerRef.current
      if (mower) {
        mower.setAttribute(
          'transform',
          fr
            ? `translate(${x},${MOWER_Y})`
            : `translate(${x + MOWER_W},${MOWER_Y}) scale(-1,1)`
        )
      }

      // Rolling wheels — rotate spokes by distance traveled
      const rearAngle  = (totalDist / (2 * Math.PI * 18)) * 360
      const frontAngle = (totalDist / (2 * Math.PI * 16)) * 360
      rearWheelRef.current?.setAttribute('transform',  `rotate(${rearAngle.toFixed(1)},20,52)`)
      frontWheelRef.current?.setAttribute('transform', `rotate(${frontAngle.toFixed(1)},110,52)`)

      // EV badge counter-transform — un-mirrors text when mower is flipped
      evBadgeRef.current?.setAttribute(
        'transform',
        fr ? '' : `translate(${MOWER_W},0) scale(-1,1)`
      )

      const nearEdge = autoX < START_X + 24 || autoX > END_X - 24
      if (!nearEdge && Math.abs(autoX - lastFireX) >= FIRE_DIST) {
        // Chute center is at local x=133 — compute world position after mower transform
        const cx = fr ? x + 133 : x + MOWER_W - 133
        spawn(cx, MOWER_Y + 30, fr)
        lastFireX = autoX
      }

      autoRaf = heroVisible ? requestAnimationFrame(mowerTick) : 0
    }

    // Pause mower when hero scrolls off-screen
    let heroVisible = true
    const visObserver = new IntersectionObserver(
      ([entry]) => {
        heroVisible = entry.isIntersecting
        if (heroVisible && !autoRaf) autoRaf = requestAnimationFrame(mowerTick)
      },
      { threshold: 0 }
    )
    const heroSection = mowerRef.current?.closest('section')
    if (heroSection) visObserver.observe(heroSection)

    // Delay mower start so headline reads first
    const startTimer = setTimeout(() => {
      autoRaf = requestAnimationFrame(mowerTick)
    }, 800)

    return () => {
      clearTimeout(startTimer)
      cancelAnimationFrame(autoRaf)
      cancelAnimationFrame(pRaf)
      visObserver.disconnect()
      pEls.forEach(el => el.parentNode?.removeChild(el))
    }
  }, [])

  return (
    <section className="hero">
      <div className="hero-overlay" />
      <div className="hero-left">
        <h1 className="hero-h1" style={{ color: '#fff', fontSize: 'clamp(32px, 3.8vw, 58px)' }}>
          Your lawn. <em>Finally</em> quiet.
        </h1>
        <div className="hero-scroll-cue">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </div>
      </div>

      <div className="hero-right">
        <svg
          className="hero-illustration"
          viewBox="0 0 800 700"
          preserveAspectRatio="xMidYMid slice"
          overflow="visible"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Sky — must fill full viewBox */}
          <rect width="800" height="700" fill="#1a3a2a" />

          {/* Atmosphere glow — wider so hill sweeps into text area */}
          <ellipse cx="400" cy="440" rx="520" ry="210" fill="#c87020" opacity=".13"/>
          <ellipse cx="400" cy="490" rx="440" ry="145" fill="#e09030" opacity=".10"/>
          <ellipse cx="400" cy="530" rx="500" ry="80"  fill="#d4a040" opacity=".08"/>

          {/* Left tree — soft partial bleed on left edge */}
          <ellipse cx="55"  cy="320" rx="44" ry="80"  fill="#0f2e1e" opacity=".55" />
          <rect    x="47"   y="395"  width="16" height="200" fill="#0f2e1e" opacity=".55" />

          {/* Right tree — far right edge */}
          <ellipse cx="760" cy="290" rx="42" ry="100" fill="#0f2e1e" opacity=".7" />
          <rect    x="751"  y="380"  width="18" height="210" fill="#0f2e1e" opacity=".7" />

          {/* Atmospheric mid-ground haze — separation between bg and fg */}
          <ellipse cx="440" cy="548" rx="480" ry="22" fill="#b8d4c2" opacity=".055" />

          {/* Foreground grass — mower rolls on this */}
          <ellipse cx="400" cy="580" rx="500" ry="60" fill="#2d6a4f" />
          <rect x="0" y="555" width="800" height="200" fill="#2d6a4f" />

          {/* Mow stripes */}
          <path d="M0 570 Q200 558 400 570 Q600 582 800 570" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".5" />
          <path d="M0 585 Q200 573 400 585 Q600 597 800 585" stroke="#3b8a63" strokeWidth="2" fill="none" opacity=".4" />
          <path d="M20 600 L780 600" stroke="#52b788" strokeWidth="1" opacity=".15" />

          {/* ── House — nudged right +20, up -20 ── */}
          <ellipse cx="402" cy="553" rx="28" ry="7" fill="#c47015" opacity=".1" />

          {/* Walls — base (lightened) */}
          <rect x="325" y="418" width="230" height="117" rx="2" fill="#3d6e52" />
          {/* Left face highlight */}
          <rect x="325" y="418" width="28" height="117" rx="2" fill="#52856a" opacity=".3" />
          {/* Right face shadow — softer */}
          <rect x="490" y="418" width="65" height="117" fill="#152e20" opacity=".18" />
          {/* Horizontal siding lines — break up the flatness */}
          <line x1="327" y1="436" x2="553" y2="436" stroke="#1e4030" strokeWidth="1" opacity=".4"/>
          <line x1="327" y1="451" x2="553" y2="451" stroke="#1e4030" strokeWidth="1" opacity=".35"/>
          <line x1="327" y1="466" x2="553" y2="466" stroke="#1e4030" strokeWidth="1" opacity=".3"/>
          <line x1="327" y1="481" x2="553" y2="481" stroke="#1e4030" strokeWidth="1" opacity=".25"/>
          <line x1="327" y1="496" x2="553" y2="496" stroke="#1e4030" strokeWidth="1" opacity=".2"/>
          <line x1="327" y1="511" x2="553" y2="511" stroke="#1e4030" strokeWidth="1" opacity=".18"/>

          {/* Roof — lightened for less contrast */}
          <path d="M313 422 L440 338 L567 422 Z" fill="#253f30" />
          {/* Left slope edge */}
          <line x1="313" y1="422" x2="440" y2="338" stroke="#3a6040" strokeWidth="1.5" opacity=".4" />
          {/* Right slope edge */}
          <line x1="440" y1="338" x2="567" y2="422" stroke="#172a1e" strokeWidth="1.5" opacity=".3" />
          {/* Eave shadow — softened */}
          <rect x="313" y="420" width="254" height="5" rx="1" fill="#0d1e14" opacity=".35" />
          {/* Fascia */}
          <line x1="313" y1="423" x2="567" y2="423" stroke="#2d5040" strokeWidth="2" opacity=".5" />

          {/* Chimney */}
          <rect x="498" y="363" width="18" height="32" fill="#1a3828" />
          <rect x="496" y="361" width="22" height="5" rx="1.5" fill="#163222" />

          {/* ── Bedroom window ── */}
          <rect x="338" y="425" width="84" height="60" rx="3" fill="#1a3828" />
          <rect x="340" y="427" width="80" height="56" rx="2" fill="#0d2018" />
          <rect x="340" y="427" width="80" height="56" rx="2" fill="#c87828" opacity=".12" />
          <rect x="340" y="427" width="14" height="56" fill="#163424" opacity=".85" />
          <rect x="406" y="427" width="14" height="56" fill="#163424" opacity=".75" />
          <line x1="391" y1="427" x2="391" y2="483" stroke="#e8c060" strokeWidth="1.5" opacity=".22" />
          <rect x="340" y="427" width="9"  height="56" fill="#091810" opacity=".95" />
          <rect x="349" y="476" width="69" height="7"  rx="2" fill="#091810" opacity=".85" />
          <rect x="349" y="456" width="69" height="20" rx="9"  fill="#122818" opacity=".95" />
          <rect x="349" y="456" width="69" height="5"  rx="4"  fill="#1e4030" opacity=".5" />
          <ellipse cx="362" cy="455" rx="11" ry="6" fill="#163020" opacity=".95" />
          <circle  cx="362" cy="445" r="9"  fill="#091810" opacity=".95" />
          <line x1="380" y1="427" x2="380" y2="483" stroke="#1a3828" strokeWidth="2" opacity=".65" />
          <line x1="340" y1="448" x2="420" y2="448" stroke="#1a3828" strokeWidth="2" opacity=".65" />

          {/* ZZZ */}
          <text className="zzz1" x="364" y="440" fontFamily="sans-serif" fontSize="16" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>
          <text className="zzz2" x="376" y="430" fontFamily="sans-serif" fontSize="13" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>
          <text className="zzz3" x="387" y="422" fontFamily="sans-serif" fontSize="10" fill="#b7e4c7" fontWeight="700" opacity="0">z</text>

          {/* Small window — right of door */}
          <rect x="488" y="428" width="38" height="40" rx="3" fill="#1a3828" />
          <rect x="490" y="430" width="34" height="36" rx="2" fill="#0d2018" />
          <line x1="507" y1="430" x2="507" y2="466" stroke="#1a3828" strokeWidth="1.5" opacity=".5" />
          <line x1="490" y1="448" x2="524" y2="448" stroke="#1a3828" strokeWidth="1.5" opacity=".5" />

          {/* Front door */}
          <path d="M430 535 L430 495 A21 21 0 0 1 472 495 L472 535 Z" fill="#1a3828"/>
          <path d="M432 535 L432 497 A19 19 0 0 1 470 497 L470 535 Z" fill="#0d2018"/>
          <circle cx="467" cy="516" r="2.5" fill="#52b788" opacity=".7"/>

          {/* ── Secondary elements — bridge text → house ── */}
          {/* Foundation shrubs */}
          <ellipse cx="355" cy="535" rx="26" ry="15" fill="#1e4030" opacity=".75" />
          <ellipse cx="382" cy="532" rx="20" ry="13" fill="#254838" opacity=".7" />
          <ellipse cx="530" cy="534" rx="22" ry="14" fill="#1e4030" opacity=".72" />
          <ellipse cx="553" cy="537" rx="16" ry="10" fill="#1a3828" opacity=".65" />

          {/* Stone path — draws eye from mower toward door */}
          <ellipse cx="451" cy="549" rx="22" ry="7" fill="#224838" opacity=".5" />
          <ellipse cx="451" cy="556" rx="26" ry="8" fill="#1e4030" opacity=".4" />
          <ellipse cx="451" cy="564" rx="30" ry="8" fill="#1a3828" opacity=".3" />

          {/* Mowing trail — subtle lighter stripes in lawn pulling left */}
          <path d="M120 568 Q280 560 420 568" stroke="#38805a" strokeWidth="8" fill="none" opacity=".18" strokeLinecap="round"/>
          <path d="M80 578 Q260 570 420 578" stroke="#38805a" strokeWidth="7" fill="none" opacity=".14" strokeLinecap="round"/>

          {/* ── Lawn mower — smooth flat style ── */}
          <g ref={mowerRef} transform={`translate(${START_X},${MOWER_Y})`}>

            {/* Rear wheel */}
            <circle cx="20" cy="52" r="18" fill="#0f2e1e" stroke="#52b788" strokeWidth="2.5"/>
            <g ref={rearWheelRef}>
              <circle cx="20" cy="52" r="7" fill="#2d6a4f"/>
              <circle cx="20" cy="52" r="3" fill="#143320"/>
              <line x1="20" y1="34" x2="20" y2="70" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>
              <line x1="2"  y1="52" x2="38" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>
            </g>
            <path d="M4 43 A18 18 0 0 1 36 43" stroke="#74c9a0" strokeWidth="2" fill="none" opacity=".5"/>

            {/* Front wheel */}
            <circle cx="110" cy="52" r="16" fill="#0f2e1e" stroke="#52b788" strokeWidth="2.5"/>
            <g ref={frontWheelRef}>
              <circle cx="110" cy="52" r="6" fill="#2d6a4f"/>
              <circle cx="110" cy="52" r="3" fill="#143320"/>
              <line x1="110" y1="36" x2="110" y2="68" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>
              <line x1="94"  y1="52" x2="126" y2="52" stroke="#52b788" strokeWidth="1.5" opacity=".3"/>
            </g>
            <path d="M95 43 A16 16 0 0 1 125 43" stroke="#74c9a0" strokeWidth="2" fill="none" opacity=".5"/>

            {/* Deck — single smooth rounded rect */}
            <rect x="2" y="16" width="126" height="30" rx="14" fill="#eef8f2"/>

            {/* Engine housing */}
            <rect x="26" y="4" width="60" height="16" rx="9" fill="#e0f0e8"/>

            {/* EV battery badge — group receives counter-transform when mower flips */}
            <g ref={evBadgeRef}>
              <rect x="33" y="24" width="44" height="14" rx="4"   fill="#2d6a4f"/>
              <rect x="77" y="27" width="5"  height="8"  rx="1.5" fill="#2d6a4f"/>
              <rect x="34" y="25" width="38" height="12" rx="3"   fill="#52b788" opacity=".9"/>
              <text x="53" y="34" fontFamily="sans-serif" fontSize="10" fill="#1a3a2a" fontWeight="700" textAnchor="middle">EV</text>
            </g>

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
