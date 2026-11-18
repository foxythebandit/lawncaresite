import { OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'QuietGreen lawn care guides for Austin, TX'
export const size = OG_SIZE
export const contentType = 'image/png'

export default function Image() {
  return ogCard('Austin, TX · Guides', 'Austin lawn care guides', 'Mowing, weeds and St. Augustine care, season by season')
}
