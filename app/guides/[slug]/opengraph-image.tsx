import { GUIDES, guide } from '@/lib/guides'
import { OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'QuietGreen lawn care guide for Austin, TX'
export const size = OG_SIZE
export const contentType = 'image/png'

export function generateStaticParams() {
  return GUIDES.map(g => ({ slug: g.slug }))
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = guide(slug)
  return ogCard('Austin lawn care guide', data?.title ?? 'Austin lawn care guides', 'By QuietGreen · Electric lawn care in Austin, TX')
}
