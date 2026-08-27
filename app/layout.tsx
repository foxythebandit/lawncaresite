import type { Metadata } from 'next'
import { DM_Serif_Display, DM_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
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
    icon: '/quietgreen-favicon.svg',
    shortcut: '/quietgreen-favicon.svg',
    apple: '/quietgreen-favicon.svg',
  },
  title: 'QuietGreen — Electric Lawn Care in Austin, TX',
  description:
    'Battery-powered lawn mowing in Austin, TX. No noise, no fumes, fixed pricing. Get an instant quote and book online — available as soon as tomorrow.',
  keywords: 'lawn care Austin TX, lawn mowing Austin, electric lawn service, quiet lawn mower Austin, lawn care near me',
  metadataBase: new URL('https://quietgreen.co'),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'QuietGreen — Electric Lawn Care in Austin, TX',
    description: 'Battery-powered lawn mowing in Austin, TX. Fixed pricing, instant quotes, no noise.',
    url: 'https://quietgreen.co',
    siteName: 'QuietGreen',
    locale: 'en_US',
    type: 'website',
  },
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
        {children}
        <Analytics />
        <Script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-RCG8V5DEXX"
          strategy="afterInteractive"
        />
        <Script
          id="google-tag"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-RCG8V5DEXX');
              gtag('config', 'AW-18401747819');
            `,
          }}
        />
        {process.env.NEXT_PUBLIC_META_PIXEL_ID && (
          <>
            <Script
              id="meta-pixel"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `
                  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){
                  n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                  n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
                  s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
                  (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
                  fbq('init','${process.env.NEXT_PUBLIC_META_PIXEL_ID}');
                  fbq('track','PageView');
                `,
              }}
            />
            <noscript>
              <img
                height="1"
                width="1"
                style={{ display: 'none' }}
                src={`https://www.facebook.com/tr?id=${process.env.NEXT_PUBLIC_META_PIXEL_ID}&ev=PageView&noscript=1`}
                alt=""
              />
            </noscript>
          </>
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'LocalBusiness',
            name: 'QuietGreen',
            description: 'Battery-powered lawn care in Austin, TX. No noise, no fumes, fixed pricing.',
            url: 'https://quietgreen.co',
            telephone: '+16823528260',
            address: {
              '@type': 'PostalAddress',
              addressLocality: 'Austin',
              addressRegion: 'TX',
              addressCountry: 'US',
            },
            geo: {
              '@type': 'GeoCoordinates',
              latitude: 30.2672,
              longitude: -97.7431,
            },
            areaServed: { '@type': 'City', name: 'Austin', addressRegion: 'TX' },
            priceRange: '$$',
            openingHoursSpecification: {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
            },
          })}}
        />
      </body>
    </html>
  )
}
