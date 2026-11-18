import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { AREAS, AREA_SLUGS } from '@/lib/areas'
import { BUSINESS_ID, SITE_URL, jsonLd } from '@/lib/site'

export async function generateStaticParams() {
  return AREA_SLUGS.map(area => ({ area }))
}

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
  const { area } = await params
  const data = AREAS[area]
  if (!data) return {}
  const title = `${data.name} Lawn Care — QuietGreen Electric Mowing`
  const description = `${data.tagline}. Fixed pricing, instant quotes. Serving ${data.zips.join(', ')}.`
  return {
    title,
    description,
    alternates: { canonical: `/areas/${area}` },
    openGraph: {
      title,
      description,
      url: `https://quietgreen.co/areas/${area}`,
      siteName: 'QuietGreen',
      locale: 'en_US',
      type: 'website',
    },
  }
}

export default async function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params
  const data = AREAS[area]
  if (!data) notFound()

  const url = `${SITE_URL}/areas/${area}`
  const otherAreas = AREA_SLUGS.filter(slug => slug !== area)
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        '@id': `${url}#service`,
        name: `Electric lawn care in ${data.name}`,
        serviceType: 'Lawn mowing',
        description: data.subheadline,
        url,
        provider: { '@id': BUSINESS_ID },
        areaServed: [
          { '@type': 'Place', name: `${data.name}, TX` },
          ...data.zips.map(postalCode => ({
            '@type': 'Place',
            address: { '@type': 'PostalAddress', postalCode, addressRegion: 'TX', addressCountry: 'US' },
          })),
        ],
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'QuietGreen', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: `${data.name} lawn care`, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: data.faqs.map(faq => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a },
        })),
      },
    ],
  }

  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(schema)} />

      <Nav />

      {/* Hero */}
      <section style={{ background: 'var(--green-deep)', padding: '80px 8vw 72px', color: '#fff' }}>
        <div style={{ maxWidth: 680 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--green-bright)', marginBottom: 16 }}>
            Austin, TX · {data.name}
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 4vw, 54px)', lineHeight: 1.15, marginBottom: 16 }}>
            {data.tagline}
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.7, color: 'rgba(255,255,255,.65)', maxWidth: 560, marginBottom: 32 }}>
            {data.subheadline}
          </p>
          <Link href="/#map-quote" style={{ display: 'inline-block', background: 'var(--green-bright)', color: '#fff', padding: '14px 28px', borderRadius: 100, fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>
            Get my instant quote →
          </Link>
        </div>
      </section>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 8vw' }}>

        {/* Intro */}
        <section style={{ padding: '52px 0 40px' }}>
          <p style={{ fontSize: 17, lineHeight: 1.8, color: 'var(--ink-soft)' }}>{data.intro}</p>
        </section>

        {/* Benefits grid */}
        <section style={{ paddingBottom: 52 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 20 }}>
            Why homeowners choose QuietGreen
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {[
              { label: 'Electric equipment', bullets: ['No gas fumes', 'No loud engines', 'Lower environmental impact'] },
              { label: 'Fixed pricing', bullets: ['Know the cost before we arrive', 'No surprise upsells'] },
              { label: 'Reliable scheduling', bullets: ['Easy online booking', 'Consistent service'] },
              { label: 'Professional results', bullets: ['Mowing', 'Edging', 'Full cleanup'] },
            ].map(c => (
              <div key={c.label} style={{ background: '#fff', border: '1px solid var(--rule)', borderRadius: 14, padding: '18px' }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, marginBottom: 10 }}>{c.label}</div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {c.bullets.map(b => (
                    <li key={b} style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green-bright)', flexShrink: 0, display: 'inline-block' }} />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Neighborhood-specific */}
        <section style={{ paddingBottom: 52 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 14 }}>
            Lawn care in {data.name}
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--ink-soft)', marginBottom: 28 }}>
            {data.localContext}
          </p>
          <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 14 }}>
            Areas we serve near {data.name}
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {data.nearbyAreas.map(n => (
              <span key={n} style={{ background: 'var(--green-pale)', border: '1px solid var(--green-light)', borderRadius: 100, padding: '5px 14px', fontSize: 13, color: 'var(--green-mid)', fontWeight: 500 }}>
                {n}
              </span>
            ))}
            {data.zips.map(z => (
              <span key={z} style={{ background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 100, padding: '5px 14px', fontSize: 13, color: 'var(--ink-soft)', fontWeight: 500 }}>
                {z}
              </span>
            ))}
          </div>
        </section>

        {/* FAQs */}
        <section id="faq" style={{ paddingBottom: 52 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 20 }}>
            Common questions about {data.name} lawn care
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data.faqs.map((faq, i) => (
              <details key={i} className="faq-item">
                <summary className="faq-q">
                  <span>{faq.q}</span>
                  <svg className="faq-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </summary>
                <p className="faq-a">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Sibling areas: crawlable links between area pages */}
        <section style={{ paddingBottom: 52 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 14 }}>
            More Austin-area lawn care
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {otherAreas.map(slug => (
              <Link key={slug} href={`/areas/${slug}`} style={{ background: '#fff', border: '1px solid var(--rule)', borderRadius: 100, padding: '6px 16px', fontSize: 14, color: 'var(--green-deep)', fontWeight: 500, textDecoration: 'none' }}>
                {AREAS[slug].name} lawn care
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section style={{ paddingBottom: 80 }}>
          <div style={{ background: 'var(--green-deep)', borderRadius: 20, padding: '48px 40px', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: '#fff', marginBottom: 12 }}>
              Ready for a quieter lawn care experience in {data.name}?
            </h2>
            <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 15, marginBottom: 28 }}>
              Get an instant quote in under 60 seconds.
            </p>
            <Link href="/#map-quote" style={{ display: 'inline-block', background: 'var(--green-bright)', color: '#fff', padding: '14px 32px', borderRadius: 100, fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>
              See my price →
            </Link>
          </div>
        </section>

      </div>
      <Footer />
    </main>
  )
}
