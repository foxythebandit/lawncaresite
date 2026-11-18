import { OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'QuietGreen — electric lawn care in Austin, TX'
export const size = OG_SIZE
export const contentType = 'image/png'

export default function Image() {
  return ogCard('Austin, TX', 'Quiet, electric lawn care', 'Battery-powered mowing · Fixed pricing · Instant quotes')
}
