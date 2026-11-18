import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { AREAS } from '@/lib/areas'
import { GUIDES, guide as findGuide } from '@/app/guides/guides'
import { BUSINESS_ID, SITE_URL, jsonLd } from '@/lib/site'

const h2Style = { fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 14 }
const pStyle = { fontSize: 17, lineHeight: 1.8, color: 'var(--ink-soft)', marginBottom: 14 }

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export async function generateStaticParams() {
  return GUIDES.map(g => ({ slug: g.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = findGuide(slug)
  if (!data) return {}
  const title = `${data.title} — QuietGreen`
  return {
    title,
    description: data.description,
    alternates: { canonical: `/guides/${slug}` },
    openGraph: {
      title,
      description: data.description,
      url: `${SITE_URL}/guides/${slug}`,
      siteName: 'QuietGreen',
      locale: 'en_US',
      type: 'article',
      publishedTime: data.published,
      modifiedTime: data.updated,
    },
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = findGuide(slug)
  if (!data) notFound()

  const url = `${SITE_URL}/guides/${slug}`
  const otherGuides = GUIDES.filter(g => g.slug !== slug)
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${url}#article`,
        headline: data.title,
        description: data.description,
        url,
        mainEntityOfPage: url,
        image: `${url}/opengraph-image`,
        datePublished: data.published,
        dateModified: data.updated,
        author: { '@id': BUSINESS_ID },
        publisher: { '@id': BUSINESS_ID },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'QuietGreen', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Lawn care guides', item: `${SITE_URL}/guides` },
          { '@type': 'ListItem', position: 3, name: data.title, item: url },
        ],
      },
    ],
  }

  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(schema)} />

      <Nav />

      {/* Hero */}
      <section style={{ background: 'var(--green-deep)', padding: '80px 8vw 64px', color: '#fff' }}>
        <div style={{ maxWidth: 720 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--green-bright)', marginBottom: 16 }}>
            <Link href="/guides" style={{ color: 'inherit', textDecoration: 'none' }}>Austin lawn care guides</Link>
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 4vw, 54px)', lineHeight: 1.15, marginBottom: 16 }}>
            {data.title}
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.7, color: 'rgba(255,255,255,.65)', maxWidth: 600, marginBottom: 20 }}>
            {data.description}
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.5)' }}>
            By QuietGreen · Updated <time dateTime={data.updated}>{formatDate(data.updated)}</time>
          </p>
        </div>
      </section>

      <article style={{ maxWidth: 760, margin: '0 auto', padding: '52px 8vw 12px' }}>
        {data.sections.map(section => (
          <section key={section.heading} style={{ paddingBottom: 36 }}>
            <h2 style={h2Style}>{section.heading}</h2>
            {section.paragraphs.map(p => <p key={p} style={pStyle}>{p}</p>)}
            {section.list && (
              <ul style={{ listStyle: 'disc', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {section.list.map(item => (
                  <li key={item} style={{ fontSize: 17, lineHeight: 1.7, color: 'var(--ink-soft)' }}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section style={{ paddingBottom: 44, borderTop: '1px solid var(--rule)', paddingTop: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 12 }}>
            Sources
          </h2>
          <ul style={{ listStyle: 'disc', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.sources.map(source => (
              <li key={source.url} style={{ fontSize: 14, lineHeight: 1.6 }}>
                <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-mid)' }}>{source.label}</a>
              </li>
            ))}
          </ul>
        </section>

        {/* CTA */}
        <section style={{ paddingBottom: 52 }}>
          <div style={{ background: 'var(--green-deep)', borderRadius: 20, padding: '40px 24px', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: '#fff', marginBottom: 12 }}>
              Rather have it handled?
            </h2>
            <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 15, lineHeight: 1.7, marginBottom: 24 }}>
              QuietGreen mows Austin-area lawns with quiet, battery-powered equipment at the right height for your grass.
              Trace your lawn on the map and see your price in about a minute.
            </p>
            <Link href="/#map-quote" style={{ display: 'inline-block', background: 'var(--green-bright)', color: '#fff', padding: '14px 32px', borderRadius: 100, fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>
              See my price →
            </Link>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 16px', marginTop: 24, fontSize: 13 }}>
              {Object.entries(AREAS).map(([areaSlug, area]) => (
                <Link key={areaSlug} href={`/areas/${areaSlug}`} style={{ color: 'rgba(255,255,255,.7)' }}>{area.name}</Link>
              ))}
            </div>
          </div>
        </section>

        {/* More guides */}
        <section style={{ paddingBottom: 72 }}>
          <h2 style={h2Style}>More spring guides</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {otherGuides.map(g => (
              <Link key={g.slug} href={`/guides/${g.slug}`} style={{ display: 'block', background: '#fff', border: '1px solid var(--rule)', borderRadius: 14, padding: '18px 20px', textDecoration: 'none' }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 16, marginBottom: 4 }}>{g.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-soft)' }}>{g.description}</div>
              </Link>
            ))}
          </div>
        </section>
      </article>

      <Footer />
    </main>
  )
}
