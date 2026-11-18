import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { GUIDES } from '@/app/guides/guides'
import { SITE_URL } from '@/lib/site'

const title = 'Austin Lawn Care Guides — QuietGreen'
const description = 'Practical, season-by-season lawn care advice for Austin homeowners: when to start mowing, when to put down pre-emergent, and how to care for St. Augustine.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/guides' },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/guides`,
    siteName: 'QuietGreen',
    locale: 'en_US',
    type: 'website',
  },
}

export default function GuidesIndex() {
  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>
      <Nav />

      <section style={{ background: 'var(--green-deep)', padding: '80px 8vw 64px', color: '#fff' }}>
        <div style={{ maxWidth: 680 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--green-bright)', marginBottom: 16 }}>
            Austin, TX · Guides
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 4vw, 54px)', lineHeight: 1.15, marginBottom: 16 }}>
            Austin lawn care guides
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.7, color: 'rgba(255,255,255,.65)', maxWidth: 560 }}>
            Straightforward advice for keeping an Austin lawn healthy through the year, based on Texas A&amp;M AgriLife guidance.
          </p>
        </div>
      </section>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '52px 8vw 80px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {GUIDES.map(g => (
          <Link key={g.slug} href={`/guides/${g.slug}`} style={{ display: 'block', background: '#fff', border: '1px solid var(--rule)', borderRadius: 16, padding: '24px 26px', textDecoration: 'none' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--green-deep)', marginBottom: 8 }}>{g.title}</h2>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--ink-soft)', marginBottom: 10 }}>{g.description}</p>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--green-mid)' }}>Read the guide →</span>
          </Link>
        ))}
      </div>

      <Footer />
    </main>
  )
}
