/* Looping illustration for the empty map state: shows that the dashed
   parcel line (from Regrid) is only the property boundary, and that you
   trace just the grass inside it — around the house, walkway and driveway.
   Pure SVG + CSS keyframes in globals.css (tap timings there match PTS). */

// Grass outline, clockwise from the back-left corner. Follows the edges of
// the driveway, the house and the front walkway so no concrete is included.
const PTS: [number, number][] = [
  [28, 40], [292, 40], [292, 212], [266, 212], [266, 104], [228, 104],
  [228, 212], [156, 212], [156, 122], [200, 122], [200, 62], [100, 62],
  [100, 122], [144, 122], [144, 212], [28, 212],
]

export default function TraceDemo() {
  const poly = PTS.map(p => p.join(',')).join(' ')
  return (
    <svg className="qg-demo" viewBox="0 0 320 240" role="img"
      aria-label="Example: the dashed line is the property line; tap around just the grass, skipping the house, walkway and driveway">
      <g className="qg-demo-scene">
        {/* aerial backdrop: street, then the lot's tree line / beds */}
        <rect width="320" height="240" rx="10" fill="#2f4a2c" />
        <rect x="0" y="226" width="320" height="14" fill="#55585a" />
        <path d="M0 233h320" stroke="#c9c9c9" strokeWidth="1" strokeDasharray="10 8" opacity=".5" />
        <rect x="20" y="18" width="280" height="204" fill="#2a3d24" />
        <circle cx="40" cy="26" r="16" fill="#1f331b" />
        <circle cx="96" cy="22" r="14" fill="#1f331b" />
        <circle cx="226" cy="24" r="15" fill="#1f331b" />
        <circle cx="282" cy="26" r="17" fill="#1f331b" />

        {/* grass, sidewalk, driveway, house, front walkway */}
        <rect x="28" y="40" width="264" height="172" fill="#45693b" />
        <rect x="20" y="212" width="280" height="10" fill="#9e9a93" />
        <rect x="228" y="104" width="38" height="118" fill="#a19d95" />
        <rect x="100" y="62" width="100" height="60" rx="2" fill="#8a8277" />
        <path d="M100 92h100" stroke="#6f685f" strokeWidth="2" />
        <rect x="144" y="122" width="12" height="90" fill="#b3aea6" />
        <circle cx="62" cy="80" r="16" fill="#24401f" />
        <circle cx="282" cy="76" r="9" fill="#24401f" />

        {/* Regrid parcel boundary — same look as on the live map */}
        <rect x="20" y="18" width="280" height="204" fill="none"
          stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="5 4" />
        <g className="qg-demo-parcel-tag">
          <rect x="88" y="6" width="144" height="22" rx="11" fill="rgba(15,38,27,.92)" stroke="rgba(255,255,255,.35)" />
          <text x="160" y="21" textAnchor="middle" fontSize="10.5" fill="#fff">Dashed line = property line</text>
        </g>

        {/* the trace */}
        <polygon className="qg-demo-fill" points={poly} fill="#52b788" />
        <polygon className="qg-demo-line" points={poly} pathLength={100} fill="none"
          stroke="#52b788" strokeWidth="2.5" strokeLinejoin="round" />
        {PTS.map(([x, y], i) => (
          <circle key={i} className={`qg-demo-pt qg-demo-pt${i + 1}`} cx={x} cy={y} r="4"
            fill="#fff" stroke="#52b788" strokeWidth="2" />
        ))}

        <g className="qg-demo-result">
          <rect x="32" y="154" width="108" height="24" rx="12" fill="rgba(15,38,27,.92)" />
          <text x="86" y="170" textAnchor="middle" fontSize="10" fontWeight="600" fill="#fff">Lawn · 6,420 sq ft ✓</text>
        </g>

        {/* finger */}
        <g className="qg-demo-finger">
          <circle className="qg-demo-ripple" r="8" fill="none" stroke="#fff" strokeWidth="2" />
          <circle r="8" fill="rgba(255,255,255,.85)" stroke="rgba(0,0,0,.25)" />
        </g>
      </g>
    </svg>
  )
}
