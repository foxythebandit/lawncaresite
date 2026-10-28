import { MetadataRoute } from 'next'

const AREAS = ['south-austin','east-austin','cedar-park','round-rock','pflugerville','north-austin']

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://quietgreen.co', changeFrequency: 'monthly', priority: 1 },
    ...AREAS.map(area => ({
      url: `https://quietgreen.co/areas/${area}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: 'https://quietgreen.co/privacy', changeFrequency: 'yearly', priority: 0.3 },
  ]
}
