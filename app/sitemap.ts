import { MetadataRoute } from 'next'
import { AREA_SLUGS } from '@/lib/areas'
import { SITE_URL } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1 },
    ...AREA_SLUGS.map(area => ({
      url: `${SITE_URL}/areas/${area}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ]
}
