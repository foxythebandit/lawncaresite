import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import GeneralInquiry from '@/components/GeneralInquiry'
import ServiceIllustration from '@/components/ServiceIllustration'
import { SERVICE_PAGES, servicePage } from '@/lib/service-pages'

export async function generateStaticParams() {
  return SERVICE_PAGES.map(page => ({ service: page.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ service: string }> }): Promise<Metadata> {
  const { service } = await params
  const data = servicePage(service)
  if (!data) return {}
  const title = `${data.name} in Austin — QuietGreen`
  const description = data.subheadline
  return {
    title,
    description,
    alternates: { canonical: `/services/${service}` },
    openGraph: {
      title,
      description,
      url: `https://quietgreen.co/services/${service}`,
      siteName: 'QuietGreen',
      locale: 'en_US',
      type: 'website',
    },
  }
}

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }) {
  const { service } = await params
  const data = servicePage(service)
  if (!data) notFound()

  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>

      <Nav />

      {/* Hero */}
      <section className="service-hero" style={{ background: 'var(--green-deep)', padding: '80px 8vw 72px', color: '#fff' }}>
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
          <a href="#service-inquiry" style={{ display: 'inline-block', background: 'var(--green-bright)', color: '#fff', padding: '14px 28px', borderRadius: 100, fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>
            Request a quote →
          </a>
        </div>
        <ServiceIllustration slug={data.slug} label={`Illustration: ${data.name.toLowerCase()}`} />
      </section>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 8vw' }}>

        {/* Intro */}
        <section style={{ padding: '52px 0 40px' }}>
          <p style={{ fontSize: 17, lineHeight: 1.8, color: 'var(--ink-soft)' }}>{data.intro}</p>
        </section>

        {/* Job video */}
        {data.video && (
          <section style={{ paddingBottom: 52 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 8 }}>
              {data.video.title}
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--ink-soft)', marginBottom: 20 }}>{data.video.caption}</p>
            <video
              src={data.video.src}
              poster={data.video.poster}
              controls
              playsInline
              preload="none"
              style={{ display: 'block', width: '100%', maxWidth: 360, aspectRatio: '9 / 16', borderRadius: 16, background: '#000', objectFit: 'cover' }}
            />
          </section>
        )}

        {/* What's included */}
        <section style={{ paddingBottom: 52 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 20 }}>
            What&apos;s included
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {data.included.map(item => (
              <div key={item} style={{ background: '#fff', border: '1px solid var(--rule)', borderRadius: 14, padding: '18px', fontSize: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green-bright)', flexShrink: 0, display: 'inline-block' }} />
                {item}
              </div>
            ))}
          </div>
        </section>

        {/* FAQs */}
        <section id="faq" style={{ paddingBottom: 52 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', marginBottom: 20 }}>
            Common questions about {data.name.toLowerCase()}
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

      </div>

      <GeneralInquiry defaultService={data.inquiryService} />

      <Footer />
    </main>
  )
}
