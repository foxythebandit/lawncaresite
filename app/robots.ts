import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/admin/login', '/portal/login'],
      disallow: ['/admin/', '/portal/'],
    },
    sitemap: 'https://quietgreen.co/sitemap.xml',
  }
}
