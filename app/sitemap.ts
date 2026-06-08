import { MetadataRoute } from 'next'

const AREAS = ['south-austin','east-austin','cedar-park','round-rock','pflugerville','north-austin']

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://quietgreen.co', lastModified: new Date(), changeFrequency: 'monthly', priority: 1 },
    ...AREAS.map(area => ({
      url: `https://quietgreen.co/areas/${area}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ]
}
