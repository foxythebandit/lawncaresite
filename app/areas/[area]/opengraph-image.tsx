import { AREAS, AREA_SLUGS } from '@/lib/areas'
import { OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'QuietGreen electric lawn care service area'
export const size = OG_SIZE
export const contentType = 'image/png'

export function generateStaticParams() {
  return AREA_SLUGS.map(area => ({ area }))
}

export default async function Image({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params
  const data = AREAS[area]
  return ogCard(`Austin, TX · ${data?.name ?? 'Service areas'}`, data?.tagline ?? 'Quiet, electric lawn care', 'Battery-powered mowing · Fixed pricing · Instant quotes')
}
