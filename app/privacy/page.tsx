import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Privacy Policy — QuietGreen',
  description: 'How QuietGreen collects, uses and protects your information, including our text messaging terms.',
  alternates: { canonical: '/privacy' },
}

const h2 = { fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--green-deep)', margin: '40px 0 12px' }
const p = { fontSize: 15.5, lineHeight: 1.8, color: 'var(--ink-soft)', marginBottom: 14 }
const ul = { fontSize: 15.5, lineHeight: 1.8, color: 'var(--ink-soft)', margin: '0 0 14px 20px', listStyle: 'disc' }

export default function PrivacyPage() {
  return (
    <main style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: 68 }}>
      <Nav />

      <section style={{ background: 'var(--green-deep)', padding: '64px 8vw 56px', color: '#fff' }}>
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 4vw, 48px)', lineHeight: 1.15, marginBottom: 12 }}>
            Privacy Policy
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.65)' }}>Effective October 28, 2026</p>
        </div>
      </section>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 8vw 80px' }}>
        <p style={p}>
          QuietGreen is operated by Quietgreen LLC (&quot;QuietGreen,&quot; &quot;we,&quot; &quot;us&quot;), an electric lawn care service in the Austin, Texas area.
          This policy explains what information we collect through quietgreen.co, by phone and by text message, and how we use it.
        </p>

        <h2 style={h2}>Information we collect</h2>
        <ul style={ul}>
          <li><strong>Information you give us</strong> when you request a quote, book a service or contact us: your name, phone number, email address, service address, the lawn area you trace on our map, the services you want and any notes you add.</li>
          <li><strong>Service records</strong>, such as quotes, scheduled visits, completed work and payments.</li>
          <li><strong>How you found us</strong>, such as the ad or link you clicked (for example, UTM tags and ad click IDs).</li>
          <li><strong>Usage information</strong> collected by analytics and advertising tools, such as pages visited, device and browser type, and cookies.</li>
        </ul>

        <h2 style={h2}>How we use it</h2>
        <ul style={ul}>
          <li>To prepare quotes, schedule and perform lawn care, and send confirmations and reminders.</li>
          <li>To call or text you about your quote, appointments and service, when you have agreed to that.</li>
          <li>To take payment and keep business records.</li>
          <li>To understand which ads and pages bring customers to us, and to improve our website.</li>
        </ul>

        <h2 style={h2}>Who we share it with</h2>
        <p style={p}>We do not sell your personal information. We share it only with service providers that help us run the business, and only so they can do that work for us:</p>
        <ul style={ul}>
          <li>Website hosting and our customer database (Vercel, Supabase).</li>
          <li>Phone calls and text messages (Twilio).</li>
          <li>Payments (Stripe).</li>
          <li>Map and satellite imagery for measuring lawns (Mapbox, Esri).</li>
          <li>Analytics and advertising measurement (Google, Meta, Vercel).</li>
        </ul>
        <p style={p}>We may also disclose information when required by law or to protect our rights and safety.</p>

        <h2 id="sms" style={{ ...h2, scrollMarginTop: 84 }}>Text messaging</h2>
        <p style={p}>
          If you check the consent box when you request a quote, you agree to receive calls and text messages from QuietGreen about your quote,
          appointments and service at the number you provided. Consent is not a condition of purchase.
        </p>
        <ul style={ul}>
          <li>Message frequency varies. Message and data rates may apply.</li>
          <li>Reply <strong>STOP</strong> to stop receiving texts at any time. Reply <strong>HELP</strong> for help, or email hello@quietgreen.co.</li>
          <li>Carriers are not liable for delayed or undelivered messages.</li>
        </ul>
        <p style={p}>
          <strong>We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes.</strong>{' '}
          No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.{' '}
          Text messaging opt-in data and consent are never shared with or sold to any third party.
          The service providers listed above, such as Twilio, receive your number only to deliver our messages to you.
        </p>

        <h2 style={h2}>Cookies and analytics</h2>
        <p style={p}>
          Our website uses cookies and similar tools from Google, Meta and Vercel to measure visits and ad performance.
          You can block or delete cookies in your browser settings; the site will still work.
        </p>

        <h2 style={h2}>How long we keep it</h2>
        <p style={p}>We keep customer and service records for as long as we need them to serve you and to meet tax and legal obligations.</p>

        <h2 style={h2}>Your choices</h2>
        <p style={p}>
          You can ask us to see, correct or delete your information by emailing{' '}
          <a href="mailto:hello@quietgreen.co" style={{ color: 'var(--green-mid)' }}>hello@quietgreen.co</a>.
          We may keep records we are required to keep by law.
        </p>

        <h2 style={h2}>Children</h2>
        <p style={p}>Our services are for adults. We do not knowingly collect information from children under 13.</p>

        <h2 style={h2}>Changes</h2>
        <p style={p}>If we change this policy, we will update the date at the top of this page.</p>

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
