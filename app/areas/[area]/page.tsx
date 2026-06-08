import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'

const AREAS: Record<string, {
  name: string
  zip: string
  tagline: string
  description: string
  grassTypes: string
  neighborhoods: string[]
}> = {
  'south-austin': {
    name: 'South Austin',
    zip: '78704, 78745, 78748',
    tagline: 'Quiet electric lawn care for South Austin homes',
    description: 'South Austin homeowners know the value of a good-looking yard without the weekend noise. QuietGreen serves the 78704, 78745, and 78748 zip codes with battery-powered mowing, edging, and cleanup — no gas fumes, no 7am engine noise. Whether you\'re in Travis Heights, Bouldin Creek, or Slaughter Creek, we\'ll keep your lawn sharp all season.',
    grassTypes: 'St. Augustine and Bermuda are the most common grasses in South Austin. Both grow fast in spring and need weekly mowing from March through June.',
    neighborhoods: ['Travis Heights', 'Bouldin Creek', 'Barton Hills', 'Slaughter Creek', 'Manchaca'],
  },
  'east-austin': {
    name: 'East Austin',
    zip: '78702, 78721, 78722',
    tagline: 'Electric lawn mowing in East Austin — zero noise, zero emissions',
    description: 'East Austin is one of the fastest-growing neighborhoods in the city, and a lot of those new homeowners are finding out lawn care is a whole new responsibility. QuietGreen makes it easy — fixed pricing, instant quotes, and battery-powered equipment that won\'t bother your neighbors or your work-from-home setup.',
    grassTypes: 'Bermuda grass dominates most East Austin lots, especially in full-sun yards. It grows aggressively in summer and benefits from consistent weekly cuts.',
    neighborhoods: ['Cherrywood', 'Windsor Park', 'Govalle', 'Mueller', 'French Place'],
  },
  'cedar-park': {
    name: 'Cedar Park',
    zip: '78613, 78730',
    tagline: 'Lawn care in Cedar Park, TX — electric, quiet, fixed pricing',
    description: 'Cedar Park lawns tend to be larger than the Austin average, which is why pricing that\'s tied to your actual square footage matters. QuietGreen uses satellite-based measurement to quote your specific yard — not a ballpark based on your zip code. We serve Cedar Park and the surrounding area with fully electric equipment and no long-term contracts.',
    grassTypes: 'St. Augustine is the dominant grass in Cedar Park, thriving in the area\'s clay-heavy soil. It needs consistent watering and regular mowing to stay healthy through the summer.',
    neighborhoods: ['Buttercup Creek', 'Twin Creeks', 'Lakeline', 'Anderson Mill'],
  },
  'round-rock': {
    name: 'Round Rock',
    zip: '78664, 78681, 78665',
    tagline: 'Electric lawn mowing service in Round Rock, TX',
    description: 'Round Rock is growing fast, and so are its lawns. QuietGreen brings fixed-price, electric lawn care to Round Rock homeowners who want a reliable service without the hassle of scheduling calls or surprise charges. Trace your lawn on our map tool and get a locked-in price in under a minute.',
    grassTypes: 'Bermuda and Zoysia are common in Round Rock subdivisions. Zoysia in particular goes semi-dormant in winter and bounces back fast in spring — it\'s forgiving but benefits from a consistent mowing schedule.',
    neighborhoods: ['Teravista', 'Forest Creek', 'Old Settlers', 'Stone Canyon', 'Paloma Lake'],
  },
  'pflugerville': {
    name: 'Pflugerville',
    zip: '78660',
    tagline: 'Quiet lawn care service in Pflugerville, TX',
    description: 'Pflugerville is one of the fastest-growing suburbs in Central Texas, and its new-build neighborhoods come with large yards that need regular attention. QuietGreen offers electric, fixed-price lawn care to Pflugerville homeowners — trace your lawn on our interactive map, get an instant price, and book without ever making a phone call.',
    grassTypes: 'Buffalo grass and Bermuda are popular in Pflugerville\'s newer subdivisions. Both are drought-tolerant once established but need consistent mowing during active growth months.',
    neighborhoods: ['Blackhawk', 'Springbrook', 'Highland Park', 'Verona'],
  },
  'north-austin': {
    name: 'North Austin',
    zip: '78758, 78759, 78750',
    tagline: 'Electric lawn mowing in North Austin and the Domain area',
    description: 'North Austin — from the Domain corridor to the tech campuses along 183 — is full of busy homeowners who don\'t have time to manage an unpredictable lawn service. QuietGreen gives you a fixed price upfront, texts you when we\'re on the way, and handles everything without you needing to be home.',
    grassTypes: 'St. Augustine thrives in North Austin\'s shadier lots, especially near creek corridors. It needs sharp blades and consistent height management to stay disease-free in Austin\'s humid summers.',
    neighborhoods: ['Allandale', 'Crestview', 'Milwood', 'Balcones Woods', 'Scofield Farms'],
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
    description: `${data.tagline}. Fixed pricing, instant quotes, no contracts. Serving ${data.zip}.`,
    alternates: { canonical: `/areas/${area}` },
  }
}

export default async function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params
  const data = AREAS[area]
  if (!data) notFound()

  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>

      {/* Nav placeholder */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 5vw', height: 68, background: 'rgba(247,246,242,.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--rule)' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--green-deep)', textDecoration: 'none' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green-bright)', display: 'inline-block' }} />
          QuietGreen
        </Link>
        <Link href="/#quote" style={{ background: 'var(--green-mid)', color: '#fff', padding: '10px 22px', borderRadius: 100, fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
          Get a quote
        </Link>
      </nav>

      {/* Hero */}
      <section style={{ background: 'var(--green-deep)', padding: '80px 8vw 72px', color: '#fff' }}>
        <div style={{ maxWidth: 680 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--green-bright)', marginBottom: 16 }}>
            Austin, TX · {data.name}
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 4vw, 54px)', lineHeight: 1.15, marginBottom: 20 }}>
            {data.tagline}
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.7, color: 'rgba(255,255,255,.7)', maxWidth: 560, marginBottom: 32 }}>
            {data.description}
          </p>
          <Link href="/#map-quote" style={{ display: 'inline-block', background: 'var(--green-bright)', color: '#fff', padding: '14px 28px', borderRadius: 100, fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>
            Get my instant quote →
          </Link>
        </div>
      </section>

      {/* Content */}
      <section style={{ padding: '64px 8vw', maxWidth: 800, margin: '0 auto' }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 56 }}>
          {[
            { icon: '⚡', label: 'Electric equipment', sub: 'No gas, no fumes, no noise' },
            { icon: '💲', label: 'Fixed pricing', sub: 'Locked in before we show up' },
            { icon: '📍', label: `Zip codes served`, sub: data.zip },
            { icon: '📅', label: 'No contracts', sub: 'Cancel or pause anytime' },
          ].map(c => (
            <div key={c.label} style={{ background: '#fff', border: '1px solid var(--rule)', borderRadius: 14, padding: '20px' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{c.icon}</div>
              <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{c.sub}</div>
            </div>
          ))}
        </div>

        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--green-deep)', marginBottom: 14 }}>
          Grass in {data.name}
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--ink-soft)', marginBottom: 48 }}>
          {data.grassTypes}
        </p>

        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--green-deep)', marginBottom: 14 }}>
          Neighborhoods we serve in {data.name}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 56 }}>
          {data.neighborhoods.map(n => (
            <span key={n} style={{ background: 'var(--green-pale)', border: '1px solid var(--green-light)', borderRadius: 100, padding: '6px 14px', fontSize: 13, color: 'var(--green-mid)', fontWeight: 500 }}>
              {n}
            </span>
          ))}
        </div>

        <div style={{ background: 'var(--green-deep)', borderRadius: 20, padding: '40px', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: '#fff', marginBottom: 12 }}>
            Ready to get a quote?
          </h2>
          <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 15, marginBottom: 24 }}>
            Trace your lawn on our map and get a fixed price in 60 seconds.
          </p>
          <Link href="/#map-quote" style={{ display: 'inline-block', background: 'var(--green-bright)', color: '#fff', padding: '14px 28px', borderRadius: 100, fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>
            See my price →
          </Link>
        </div>
      </section>

    </main>
  )
}
