import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Terms of Service — QuietGreen',
  description: 'QuietGreen terms of service, including our SMS terms.',
  alternates: { canonical: '/terms' },
}

const h2 = { fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--green-deep)', margin: '40px 0 12px' }
const p = { fontSize: 15.5, lineHeight: 1.8, color: 'var(--ink-soft)', marginBottom: 14 }
const ul = { fontSize: 15.5, lineHeight: 1.8, color: 'var(--ink-soft)', margin: '0 0 14px 20px', listStyle: 'disc' }

export default function TermsPage() {
  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>
      <Nav />

      <section style={{ background: 'var(--green-deep)', padding: '64px 8vw 56px', color: '#fff' }}>
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 4vw, 48px)', lineHeight: 1.15, marginBottom: 12 }}>
            Terms of Service
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.65)' }}>Effective October 28, 2026</p>
        </div>
      </section>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 8vw 80px' }}>
        <p style={p}>
          These terms cover quotes, bookings and services from QuietGreen, operated by Quietgreen LLC (&quot;QuietGreen,&quot; &quot;we,&quot; &quot;us&quot;),
          an electric lawn care service in the Austin, Texas area, and your use of quietgreen.co.
        </p>

        <h2 style={h2}>Quotes and pricing</h2>
        <p style={p}>
          Online prices are estimates based on the lawn area you measure on our map. We may adjust a price if the property differs from what was measured,
          and we will tell you before any work starts.
        </p>

        <h2 style={h2}>Bookings and scheduling</h2>
        <p style={p}>
          A booking request is confirmed once we contact you to set the visit. Weather or access problems may move a visit; we will let you know.
          You can cancel or pause service at any time by contacting us.
        </p>

        <h2 style={h2}>Payment</h2>
        <p style={p}>Payment is due after each completed visit unless we agree otherwise. We may send invoices or payment links by email or text.</p>

        <h2 id="sms" style={{ ...h2, scrollMarginTop: 84 }}>SMS Terms</h2>
        <ul style={ul}>
          <li><strong>Program:</strong> QuietGreen sends text messages about quote requests, appointments and service.</li>
          <li><strong>Consent:</strong> you agree to receive texts by checking the consent box on our quote forms. Consent is not a condition of purchase.</li>
          <li><strong>Frequency:</strong> message frequency varies.</li>
          <li><strong>Cost:</strong> message and data rates may apply.</li>
          <li><strong>Opt out:</strong> reply STOP at any time to stop receiving texts. Reply HELP for help, or email hello@quietgreen.co.</li>
          <li>Carriers are not liable for delayed or undelivered messages.</li>
          <li>See our <a href="/privacy" style={{ color: 'var(--green-mid)' }}>Privacy Policy</a> for how we handle your information.</li>
        </ul>

        <h2 style={h2}>Changes</h2>
        <p style={p}>If we change these terms, we will update the date at the top of this page.</p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>
          Quietgreen LLC · Austin, Texas ·{' '}
          <a href="mailto:hello@quietgreen.co" style={{ color: 'var(--green-mid)' }}>hello@quietgreen.co</a>
        </p>
      </div>

      <Footer />
    </main>
  )
}
