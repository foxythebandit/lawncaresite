import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'

interface AreaData {
  name: string
  zips: string[]
  tagline: string
  subheadline: string
  intro: string
  localContext: string
  nearbyAreas: string[]
  faqs: { q: string; a: string }[]
}

const AREAS: Record<string, AreaData> = {
  'south-austin': {
    name: 'South Austin',
    zips: ['78704', '78745', '78748'],
    tagline: 'Quiet electric lawn care for South Austin homes',
    subheadline: 'QuietGreen provides electric lawn mowing, edging, and cleanup throughout South Austin. No gas fumes, no loud equipment, and no disruption to your day.',
    intro: 'South Austin homeowners value great-looking yards without the weekend noise. QuietGreen provides electric lawn mowing, edging, and cleanup throughout 78704, 78745, and 78748 using battery-powered equipment that keeps neighborhoods peaceful.',
    localContext: 'Lawn care in South Austin comes with its own rhythm — fast spring growth, intense summer heat, and mature oak canopies that create shade and debris. Whether your yard backs up to Barton Creek or sits on a tight lot in Bouldin, consistent maintenance is what keeps it looking sharp. QuietGreen serves homes throughout South Austin, including nearby areas such as Travis Heights, Zilker, and South Lamar.',
    nearbyAreas: ['Travis Heights', 'Bouldin Creek', 'Zilker', 'South Lamar', 'Barton Hills', 'Slaughter Creek'],
    faqs: [
      { q: 'Do you service homes in 78704?', a: 'Yes, QuietGreen provides electric lawn care throughout 78704 and surrounding South Austin neighborhoods including Travis Heights, Bouldin Creek, and Barton Hills.' },
      { q: 'How often should South Austin lawns be mowed?', a: 'Weekly from March through June when St. Augustine grows fast, then bi-weekly through summer and fall as growth slows. We\'ll let you know if your yard needs a schedule adjustment.' },
      { q: 'Will your equipment work under oak trees?', a: 'Yes. Our mowers handle mixed sun and shade without issue, and we clean up all clippings and debris before leaving.' },
    ],
  },
  'east-austin': {
    name: 'East Austin',
    zips: ['78702', '78721', '78722'],
    tagline: 'Quiet electric lawn care for East Austin homeowners',
    subheadline: 'QuietGreen provides electric lawn mowing, edging, and cleanup throughout East Austin. No gas fumes, no loud equipment, and no disruption to your day.',
    intro: 'Mueller residents appreciate walkable streets and sustainable living. QuietGreen\'s electric lawn care fits naturally into East Austin\'s focus on cleaner, quieter communities — battery-powered equipment, zero emissions, and a service that\'s done before your neighbors notice.',
    localContext: 'East Austin\'s mix of older bungalows and newer infill builds means lawn sizes and grass conditions vary a lot block to block. Tight lots in Cherrywood need precise edging; larger new builds in Mueller and Windsor Park need consistent scheduling to stay ahead of summer Bermuda growth. QuietGreen serves homes throughout East Austin, including nearby areas such as Cherrywood, French Place, and Govalle.',
    nearbyAreas: ['Cherrywood', 'Windsor Park', 'Govalle', 'Mueller', 'French Place', 'Holly'],
    faqs: [
      { q: 'Do you service the Mueller neighborhood?', a: 'Yes. Mueller is one of our most active areas in East Austin. We service homes throughout the development and the surrounding streets.' },
      { q: 'Do you use electric equipment?', a: 'Yes. All mowing, edging, and cleanup is performed using battery-powered equipment — no gas engines, no exhaust fumes.' },
      { q: 'Can you handle tight lots with fences and gates?', a: 'Absolutely. We work with small and oddly shaped yards regularly. Just let us know about any gate codes or access details when you book.' },
    ],
  },
  'cedar-park': {
    name: 'Cedar Park',
    zips: ['78613', '78730'],
    tagline: 'Quiet electric lawn care in Cedar Park, TX',
    subheadline: 'QuietGreen provides electric lawn mowing, edging, and cleanup throughout Cedar Park. No gas fumes, no loud equipment, and no disruption to your day.',
    intro: 'Cedar Park is known for its family-friendly neighborhoods, strong HOA communities, and yards that need to meet a certain standard. QuietGreen helps Cedar Park homeowners keep their lawns looking sharp without the noise and emissions of traditional lawn crews — priced by your actual square footage, not a rough estimate.',
    localContext: 'Cedar Park lots tend to run larger than what you\'d find inside Austin, and HOA guidelines in communities like Twin Creeks and Buttercup Creek mean curb appeal matters year-round. Lawn care here requires consistent scheduling and attention to edging along driveways and beds. QuietGreen serves homes throughout Cedar Park, including nearby areas such as Leander and the 183A corridor.',
    nearbyAreas: ['Buttercup Creek', 'Twin Creeks', 'Lakeline', 'Anderson Mill', 'Leander', 'Brushy Creek'],
    faqs: [
      { q: 'Do you work with HOA-managed communities?', a: 'Yes. We regularly service homes in HOA-managed neighborhoods and follow community guidelines for appearance and scheduling.' },
      { q: 'How do you price larger Cedar Park lots?', a: 'We price by square footage measured from satellite imagery. You trace your lawn on our map tool and get a locked-in price instantly — no estimator visit needed.' },
      { q: 'Do you serve Leander as well?', a: 'Yes, we serve Leander and the surrounding area. Drop your address into our quote tool to confirm coverage.' },
    ],
  },
  'round-rock': {
    name: 'Round Rock',
    zips: ['78664', '78681', '78665'],
    tagline: 'Electric lawn mowing service in Round Rock, TX',
    subheadline: 'QuietGreen provides electric lawn mowing, edging, and cleanup throughout Round Rock. No gas fumes, no loud equipment, and no disruption to your day.',
    intro: 'Round Rock has grown into one of the largest suburbs in Central Texas, and its subdivisions — Teravista, Forest Creek, Stone Canyon — come with the kind of lawns that need regular attention to stay looking good. QuietGreen makes it easy to stay on schedule without making a single phone call.',
    localContext: 'Lawn care in Round Rock comes with unique challenges — fast-growing Bermuda in summer, HOA-sensitive curb appeal, and neighborhoods spread far enough apart that consistency matters more than speed. QuietGreen serves homes throughout Round Rock, including nearby areas such as Hutto and Georgetown.',
    nearbyAreas: ['Teravista', 'Forest Creek', 'Old Settlers', 'Stone Canyon', 'Paloma Lake', 'Hutto'],
    faqs: [
      { q: 'Do you service Teravista and Forest Creek?', a: 'Yes, both are active service areas. We work throughout Round Rock including Teravista, Forest Creek, Stone Canyon, and Paloma Lake.' },
      { q: 'What grass types are common in Round Rock?', a: 'Bermuda and Zoysia are the most common in Round Rock\'s newer subdivisions. Both do well with regular mowing and we\'re familiar with what they need each season.' },
      { q: 'How far in advance do I need to book?', a: 'Most bookings can be confirmed within 24 hours. We\'ll text you to confirm your first visit after you submit a quote.' },
    ],
  },
  'pflugerville': {
    name: 'Pflugerville',
    zips: ['78660'],
    tagline: 'Quiet lawn care service in Pflugerville, TX',
    subheadline: 'QuietGreen provides electric lawn mowing, edging, and cleanup throughout Pflugerville. No gas fumes, no loud equipment, and no disruption to your day.',
    intro: 'Pflugerville is one of the fastest-growing communities in Central Texas, and neighborhoods like Blackhawk, Springbrook, and Highland Park come with larger lots and the ongoing question of who\'s going to mow them. QuietGreen gives Pflugerville homeowners a fixed price, electric equipment, and a booking process that takes about a minute.',
    localContext: 'Pflugerville\'s newer builds sit on some of the larger residential lots in the Austin metro, which makes consistent scheduling important — a yard that gets ahead of you in summer is harder to bring back. QuietGreen serves homes throughout Pflugerville, including nearby areas such as Hutto and Wells Branch.',
    nearbyAreas: ['Blackhawk', 'Springbrook', 'Highland Park', 'Verona', 'Hutto', 'Wells Branch'],
    faqs: [
      { q: 'Do you service Blackhawk and Springbrook?', a: 'Yes, both neighborhoods are in our regular service area. We work throughout Pflugerville\'s 78660 zip code.' },
      { q: 'Are your prices higher for larger Pflugerville lots?', a: 'Pricing is based on your actual square footage, so larger lots cost more than smaller ones — but you\'ll see the exact price before you book, not after.' },
      { q: 'What\'s the best mowing schedule for Pflugerville lawns?', a: 'Weekly in spring during peak growth, bi-weekly in summer and fall. Buffalo grass and Bermuda both slow down significantly once the heat peaks in July and August.' },
    ],
  },
  'north-austin': {
    name: 'North Austin',
    zips: ['78758', '78759', '78750'],
    tagline: 'Electric lawn mowing in North Austin and the Domain area',
    subheadline: 'QuietGreen provides electric lawn mowing, edging, and cleanup throughout North Austin. No gas fumes, no loud equipment, and no disruption to your day.',
    intro: 'North Austin runs busy — between the Domain, the tech corridor along 183, and established neighborhoods like Allandale and Crestview, most homeowners here don\'t have weekends to spare for lawn maintenance. QuietGreen shows up on time, works quietly, and texts you when it\'s done. You don\'t even have to be home.',
    localContext: 'Lawn care in North Austin varies by neighborhood — shadier lots near creek corridors in Allandale need different care than the sun-exposed yards out near Milwood and Balcones Woods. QuietGreen serves homes throughout North Austin, including nearby areas such as Rundberg, the Domain corridor, and Anderson Mill.',
    nearbyAreas: ['Allandale', 'Crestview', 'Milwood', 'Balcones Woods', 'Scofield Farms', 'Anderson Mill'],
    faqs: [
      { q: 'Do you service the Domain area?', a: 'Yes. We service homes throughout North Austin including the neighborhoods surrounding the Domain, Milwood, and Balcones Woods.' },
      { q: 'Do I need to be home for service?', a: 'No. We handle everything outside. You\'ll get a text when we\'re on the way and another when we\'re done. Just let us know about any gate access in advance.' },
      { q: 'What grass is most common in North Austin?', a: 'St. Augustine is dominant in North Austin\'s shadier lots, especially near creek corridors. It needs consistent mowing height and sharp blades to stay healthy through Austin\'s humid summers.' },
    ],
  },
}

export async function generateStaticParams() {
  return Object.keys(AREAS).map(area => ({ area }))
}

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
  const { area } = await params
  const data = AREAS[area]
  if (!data) return {}
  return {
    title: `${data.name} Lawn Care — QuietGreen Electric Mowing`,
    description: `${data.tagline}. Fixed pricing, instant quotes. Serving ${data.zips.join(', ')}.`,
    alternates: { canonical: `/areas/${area}` },
  }
}

export default async function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params
  const data = AREAS[area]
  if (!data) notFound()

  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>

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
        <section style={{ paddingBottom: 52 }}>
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
    </main>
  )
}
