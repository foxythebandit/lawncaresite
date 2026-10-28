// Flat scene per service page, in the same palette as the Hero lawn illustration.

const LEAF = 'M0 -7 C5 -5 6 3 0 7 C-6 3 -5 -5 0 -7 Z'

function Leaf({ x, y, r = 0, s = 1, fill }: { x: number; y: number; r?: number; s?: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <path d={LEAF} fill={fill} />
      <line x1="0" y1="-6" x2="0" y2="6" stroke="#7a4a18" strokeWidth=".8" opacity=".5" />
    </g>
  )
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <>
      <rect width="480" height="360" rx="20" fill="#1e4030" />
      <circle cx="400" cy="70" r="34" fill="#f0c060" opacity=".16" />
      <circle cx="400" cy="70" r="20" fill="#f0c060" opacity=".22" />
      {children}
    </>
  )
}

function Gutters() {
  return (
    <Backdrop>
      {/* Wall and window */}
      <rect x="60" y="150" width="320" height="210" fill="#3d6e52" />
      <rect x="60" y="150" width="40" height="210" fill="#52856a" opacity=".3" />
      {[175, 200, 225, 250, 275, 300, 325].map(y => <line key={y} x1="60" y1={y} x2="380" y2={y} stroke="#1e4030" strokeWidth="1" opacity=".3" />)}
      <rect x="150" y="200" width="90" height="80" rx="3" fill="#1a3828" />
      <rect x="154" y="204" width="82" height="72" rx="2" fill="#0d2018" />
      <rect x="154" y="204" width="82" height="72" rx="2" fill="#c87828" opacity=".14" />
      <line x1="195" y1="204" x2="195" y2="276" stroke="#1a3828" strokeWidth="2" />
      <line x1="154" y1="240" x2="236" y2="240" stroke="#1a3828" strokeWidth="2" />

      {/* Roof */}
      <path d="M30 150 L230 40 L430 150 Z" fill="#0f2419" />
      <path d="M230 40 L430 150 L330 150 Z" fill="#091810" opacity=".5" />
      <line x1="30" y1="150" x2="230" y2="40" stroke="#52856a" strokeWidth="2.5" opacity=".6" />
      <line x1="230" y1="40" x2="430" y2="150" stroke="#52856a" strokeWidth="2.5" opacity=".35" />
      {[70, 95, 120].map(y => <line key={y} x1={30 + (150 - y) * 1.82} y1={y} x2={430 - (150 - y) * 1.82} y2={y} stroke="#2d5040" strokeWidth="1.2" opacity=".5" />)}
      <rect x="30" y="148" width="400" height="6" fill="#0d1e14" opacity=".35" />

      {/* Gutter trough: clean right half, leaf-filled left half */}
      <rect x="40" y="150" width="380" height="16" rx="3" fill="#cceadb" />
      <rect x="40" y="162" width="380" height="4" rx="2" fill="#8fb8a2" />
      <Leaf x={62} y={150} r={-30} fill="#e09030" />
      <Leaf x={78} y={148} r={40} fill="#c87828" />
      <Leaf x={95} y={151} r={-70} fill="#d4a040" />
      <Leaf x={112} y={148} r={15} fill="#c47015" />
      <Leaf x={128} y={150} r={-45} fill="#e09030" />
      <Leaf x={146} y={149} r={60} fill="#b7e4c7" s={.9} />

      {/* Downspout with water */}
      <rect x="392" y="164" width="16" height="170" rx="3" fill="#cceadb" />
      <rect x="402" y="164" width="6" height="170" fill="#8fb8a2" opacity=".6" />
      <path d="M392 334 L408 334 L420 348 L404 348 Z" fill="#cceadb" />
      {[0, 1, 2].map(i => <ellipse key={i} cx={430 + i * 9} cy={350 - i * 2} rx="2.5" ry="4" fill="#b7e4c7" opacity={0.8 - i * 0.2} />)}

      {/* Ladder */}
      <g transform="rotate(-12 300 360)">
        <rect x="270" y="150" width="7" height="215" rx="2" fill="#d4a040" />
        <rect x="318" y="150" width="7" height="215" rx="2" fill="#c47015" />
        {[175, 205, 235, 265, 295, 325].map(y => <rect key={y} x="272" y={y} width="50" height="6" rx="2" fill="#e09030" />)}
      </g>

      {/* Bucket of debris hooked on the ladder */}
      <path d="M246 214 L280 214 L276 246 L250 246 Z" fill="#52b788" />
      <path d="M248 214 Q263 196 278 214" fill="none" stroke="#cceadb" strokeWidth="2" />
      <Leaf x={256} y={212} r={-20} fill="#c87828" s={.8} />
      <Leaf x={268} y={211} r={35} fill="#e09030" s={.8} />

      {/* Falling leaves */}
      <Leaf x={190} y={110} r={30} fill="#e09030" s={.9} />
      <Leaf x={350} y={200} r={-50} fill="#d4a040" s={.8} />
      <Leaf x={120} y={310} r={70} fill="#c87828" s={.9} />
    </Backdrop>
  )
}

function Leaves() {
  const scattered: [number, number, number, string][] = [
    [40, 300, 20, '#e09030'], [62, 318, -40, '#c87828'], [88, 296, 65, '#d4a040'], [110, 322, -15, '#c47015'],
    [130, 305, 45, '#e09030'], [52, 338, -70, '#d4a040'], [96, 342, 10, '#c87828'], [150, 330, -55, '#e09030'],
    [172, 312, 30, '#c47015'], [140, 350, 80, '#d4a040'],
  ]
  return (
    <Backdrop>
      {/* Lawn */}
      <path d="M0 250 Q240 225 480 250 L480 340 Q480 360 460 360 L20 360 Q0 360 0 340 Z" fill="#2d6a4f" />
      <path d="M0 262 Q240 240 480 262" fill="none" stroke="#52b788" strokeWidth="2" opacity=".25" />
      {/* Mow stripes on the cleared side */}
      {[290, 330].map(x => <path key={x} d={`M${x} 246 L${x + 40} 246 L${x + 60} 360 L${x + 20} 360 Z`} fill="#52b788" opacity=".12" />)}

      {/* Oak */}
      <rect x="86" y="150" width="18" height="110" rx="5" fill="#1a3020" />
      <path d="M95 190 L70 160 M95 175 L124 150" stroke="#1a3020" strokeWidth="6" strokeLinecap="round" />
      <circle cx="95" cy="116" r="64" fill="#2d6a4f" />
      <circle cx="52" cy="140" r="38" fill="#1a3828" />
      <circle cx="140" cy="138" r="40" fill="#2d6a4f" />
      <circle cx="74" cy="90" r="26" fill="#d4a040" opacity=".85" />
      <circle cx="128" cy="104" r="22" fill="#e09030" opacity=".8" />
      <circle cx="96" cy="150" r="20" fill="#c87828" opacity=".75" />
      <circle cx="52" cy="132" r="14" fill="#e09030" opacity=".6" />

      {/* Leaves still on the lawn */}
      {scattered.map(([x, y, r, fill], i) => <Leaf key={i} x={x} y={y} r={r} fill={fill} />)}

      {/* Leaf pile */}
      <path d="M176 306 Q240 214 308 306 Z" fill="#c87828" />
      <path d="M194 306 Q242 240 290 306 Z" fill="#e09030" />
      <Leaf x={232} y={272} r={20} fill="#d4a040" />
      <Leaf x={252} y={280} r={-40} fill="#c47015" />
      <Leaf x={244} y={262} r={70} fill="#e09030" s={.8} />

      {/* Lawn bag */}
      <path d="M392 230 Q384 300 396 318 L446 318 Q458 300 450 230 Z" fill="#cceadb" />
      <path d="M392 230 L450 230 L444 220 L398 220 Z" fill="#b7e4c7" />
      <Leaf x={410} y={222} r={-30} fill="#e09030" s={.9} />
      <Leaf x={430} y={220} r={25} fill="#c87828" s={.9} />
      <rect x="404" y="262" width="34" height="22" rx="4" fill="#52b788" />
      <path d="M415 268 l6 6 l8 -10" fill="none" stroke="#f7f6f2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Battery blower */}
      <g transform="rotate(-8 330 250)">
        <rect x="300" y="226" width="56" height="30" rx="12" fill="#52b788" />
        <rect x="312" y="216" width="30" height="12" rx="4" fill="#0d2018" />
        <rect x="316" y="218" width="10" height="8" rx="2" fill="#b7e4c7" />
        <path d="M312 226 Q326 200 342 226" fill="none" stroke="#163424" strokeWidth="5" strokeLinecap="round" />
        <path d="M300 236 L240 262 L244 272 L302 250 Z" fill="#163424" />
      </g>
      {/* Air flow */}
      {[0, 1, 2].map(i => <path key={i} d={`M232 ${262 + i * 10} Q${212 - i * 4} ${270 + i * 10} ${196 - i * 6} ${266 + i * 12}`} fill="none" stroke="#f7f6f2" strokeWidth="2" strokeLinecap="round" opacity={0.45 - i * 0.1} />)}

      {/* Falling leaves */}
      <Leaf x={170} y={170} r={40} fill="#e09030" s={.9} />
      <Leaf x={196} y={208} r={-30} fill="#d4a040" s={.8} />
    </Backdrop>
  )
}

function Beds() {
  return (
    <Backdrop>
      {/* Lawn */}
      <path d="M0 210 Q240 190 480 210 L480 340 Q480 360 460 360 L20 360 Q0 360 0 340 Z" fill="#2d6a4f" />
      {[60, 160, 260, 360].map(x => <path key={x} d={`M${x} 206 L${x + 50} 204 L${x + 70} 360 L${x + 20} 360 Z`} fill="#52b788" opacity=".1" />)}

      {/* Fence and shrubs behind the bed */}
      {Array.from({ length: 16 }, (_, i) => <rect key={i} x={i * 31} y="120" width="26" height="96" rx="3" fill="#163424" />)}
      <rect x="0" y="140" width="480" height="5" fill="#0d2018" opacity=".5" />

      {/* Mulched bed with a crisp edge */}
      <path d="M20 300 Q60 228 240 226 Q420 228 460 300 Z" fill="#7a4e2e" />
      <path d="M44 296 Q80 240 240 238 Q400 240 436 296 Z" fill="#5a3a22" />
      {Array.from({ length: 40 }, (_, i) => {
        const x = 70 + ((i * 53) % 340)
        const y = 250 + ((i * 29) % 42)
        return <rect key={i} x={x} y={y} width="7" height="2.5" rx="1" fill="#9a6a3e" opacity=".55" transform={`rotate(${(i * 37) % 60 - 30} ${x} ${y})`} />
      })}
      <path d="M20 300 Q60 228 240 226 Q420 228 460 300" fill="none" stroke="#b7e4c7" strokeWidth="3" opacity=".55" />

      {/* Shrubs and flowers */}
      <circle cx="120" cy="236" r="34" fill="#2d6a4f" />
      <circle cx="106" cy="224" r="16" fill="#52b788" opacity=".45" />
      <circle cx="360" cy="236" r="36" fill="#2d6a4f" />
      <circle cx="346" cy="222" r="17" fill="#52b788" opacity=".45" />
      <circle cx="240" cy="230" r="26" fill="#3d7a5a" />
      <circle cx="232" cy="222" r="11" fill="#b7e4c7" opacity=".3" />
      {[[190, 262], [208, 274], [280, 266], [298, 278], [168, 280], [318, 262]].map(([x, y], i) => (
        <g key={i}>
          <line x1={x} y1={y} x2={x} y2={y + 14} stroke="#52b788" strokeWidth="2" />
          {[0, 72, 144, 216, 288].map(a => <circle key={a} cx={x + 5 * Math.cos(a * Math.PI / 180)} cy={y + 5 * Math.sin(a * Math.PI / 180)} r="3.6" fill={i % 2 ? '#e07a5f' : '#f0c060'} />)}
          <circle cx={x} cy={y} r="2.4" fill="#f7f6f2" />
        </g>
      ))}

      {/* Wheelbarrow of mulch */}
      <g transform="translate(330 284)">
        <path d="M0 0 L90 0 L76 34 L14 34 Z" fill="#52b788" />
        <path d="M6 0 Q45 -26 84 0 Z" fill="#7a4e2e" />
        <path d="M18 -4 Q45 -18 72 -4" fill="none" stroke="#9a6a3e" strokeWidth="3" opacity=".7" />
        <circle cx="30" cy="48" r="12" fill="#0d2018" />
        <circle cx="30" cy="48" r="4" fill="#cceadb" />
        <line x1="76" y1="20" x2="122" y2="44" stroke="#cceadb" strokeWidth="5" strokeLinecap="round" />
        <line x1="62" y1="34" x2="66" y2="62" stroke="#163424" strokeWidth="4" strokeLinecap="round" />
      </g>

      {/* Rake */}
      <line x1="40" y1="350" x2="110" y2="210" stroke="#d4a040" strokeWidth="5" strokeLinecap="round" />
      <path d="M96 204 L128 220" stroke="#cceadb" strokeWidth="6" strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map(i => <line key={i} x1={98 + i * 7} y1={205 + i * 3.5} x2={104 + i * 7} y2={194 + i * 3.5} stroke="#cceadb" strokeWidth="2.5" strokeLinecap="round" />)}
    </Backdrop>
  )
}

const SCENES = { 'gutter-cleaning': Gutters, 'leaf-cleanup': Leaves, 'garden-beds-mulch': Beds } as const

export default function ServiceIllustration({ slug, label }: { slug: string; label: string }) {
  const Scene = SCENES[slug as keyof typeof SCENES]
  if (!Scene) return null
  return (
    <svg viewBox="0 0 480 360" role="img" aria-label={label} className="service-hero-art">
      <Scene />
    </svg>
  )
}
