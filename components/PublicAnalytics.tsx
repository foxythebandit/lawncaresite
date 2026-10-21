'use client'
import { usePathname } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
export default function PublicAnalytics({ pixelId }: { pixelId?: string }) {
  const path = usePathname()
  if (path.startsWith('/admin') || path.startsWith('/portal')) return null
  if (pixelId && !/^\d+$/.test(pixelId)) pixelId = undefined
  return <>
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
        {pixelId && (
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
                  fbq('init','${pixelId}');
                  fbq('track','PageView');
                `,
              }}
            />
            <noscript>
              <img
                height="1"
                width="1"
                style={{ display: 'none' }}
                src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
                alt=""
              />
            </noscript>
          </>
        )}
  </>
}
