import TracingMap, { type Shape } from './leads/TracingMap'

/**
 * The customer's lawn, the same on the lead page and on Jobs: the map image saved from the website
 * (what the customer drew) when there is one, else their tracing drawn on satellite tiles.
 */
export default function LawnMap({ screenshotUrl, shapes, sqFt, width = 640, height = 300 }: {
  screenshotUrl: string | null; shapes: Shape[]; sqFt?: number | null; width?: number; height?: number
}) {
  const label = `Traced lawn${sqFt ? `, ${sqFt.toLocaleString('en-US')} sq ft` : ''}`
  if (screenshotUrl) return <a href={screenshotUrl} target="_blank" rel="noopener noreferrer" className="crm-map-shot">
    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not an optimizable asset */}
    <img src={screenshotUrl} alt={label} />
  </a>
  return shapes.length ? <TracingMap shapes={shapes} width={width} height={height} label={label} /> : null
}
