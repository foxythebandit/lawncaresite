import { SERVICE_PAGES, servicePage } from '@/lib/service-pages'
import { OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'QuietGreen outdoor services in Austin, TX'
export const size = OG_SIZE
export const contentType = 'image/png'

export function generateStaticParams() {
  return SERVICE_PAGES.map(page => ({ service: page.slug }))
}

export default async function Image({ params }: { params: Promise<{ service: string }> }) {
  const { service } = await params
  const data = servicePage(service)
  return ogCard(`Austin, TX · ${data?.name ?? 'Services'}`, data?.tagline ?? 'Quiet, electric lawn care', 'Tell us about your home · We call with a quote')
}
