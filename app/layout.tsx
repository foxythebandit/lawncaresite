import type { Metadata } from 'next'
import { DM_Serif_Display, DM_Sans } from 'next/font/google'
import PublicAnalytics from '@/components/PublicAnalytics'
import AttributionCapture from '@/components/AttributionCapture'
import { AREAS } from '@/lib/areas'
import { BUSINESS_ID, GOOGLE_MAPS_URL, SITE_URL, jsonLd } from '@/lib/site'
import './globals.css'

const dmSerifDisplay = DM_Serif_Display({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display',
})

const dmSans = DM_Sans({
  weight: ['300', '400', '500'],
  subsets: ['latin'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  icons: {
    // Google Search/Ads doesn't support SVG favicons and wants >=48px —
    // lead with PNG/ICO so it actually picks one up instead of falling
    // back to a generic globe icon. SVG still listed for browsers that
    // prefer it.
    icon: [
      { url: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/quietgreen-favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  title: 'QuietGreen — Electric Lawn Care in Austin, TX',
  description:
    'Electric lawn mowing in Austin, TX. Get a mowing estimate online or request a quote for landscaping and other outdoor projects.',
  keywords: 'lawn care Austin TX, lawn mowing Austin, electric lawn service, quiet lawn mower Austin, lawn care near me',
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'QuietGreen — Electric Lawn Care in Austin, TX',
    description: 'Battery-powered lawn mowing in Austin, TX. Fixed pricing, instant quotes, no noise.',
    url: SITE_URL,
    siteName: 'QuietGreen',
    locale: 'en_US',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${dmSerifDisplay.variable} ${dmSans.variable}`}
    >
      <body>
        <AttributionCapture />
        {children}
        <PublicAnalytics pixelId={process.env.NEXT_PUBLIC_META_PIXEL_ID} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLd({
            '@context': 'https://schema.org',
            '@type': 'LocalBusiness',
            '@id': BUSINESS_ID,
            name: 'QuietGreen',
            description: 'Battery-powered lawn care in Austin, TX. No noise, no fumes, fixed pricing.',
            url: SITE_URL,
            logo: `${SITE_URL}/icon-512.png`,
            image: `${SITE_URL}/opengraph-image`,
            telephone: '+16823528260',
            email: 'hello@quietgreen.co',
            hasMap: GOOGLE_MAPS_URL,
            address: {
              '@type': 'PostalAddress',
              addressLocality: 'Austin',
              addressRegion: 'TX',
              addressCountry: 'US',
            },
            areaServed: [
              { '@type': 'City', name: 'Austin', addressRegion: 'TX' },
              ...Object.values(AREAS).map(area => ({ '@type': 'Place', name: `${area.name}, TX` })),
            ],
            priceRange: '$$',
          })}
        />
      </body>
    </html>
  )
}
