import { MetadataRoute } from 'next'
import { AREA_SLUGS } from '@/lib/areas'
import { SITE_URL } from '@/lib/site'
import { SERVICE_PAGES } from '@/lib/service-pages'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1 },
    ...AREA_SLUGS.map(area => ({
      url: `${SITE_URL}/areas/${area}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...SERVICE_PAGES.map(page => ({
      url: `${SITE_URL}/services/${page.slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
