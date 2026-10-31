import type { Metadata } from 'next'
import { verifiedLead } from '@/lib/intake'
import { adminDb } from '@/lib/supabase/admin'
import { quoteOffer } from '@/lib/quote-offer'
import type { QuoteDraft } from '@/lib/quote-draft'
import QuoteBooking from './QuoteBooking'
import './quote.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your QuietGreen quote', robots: { index: false, follow: false } }

export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const id = verifiedLead(decodeURIComponent(token))
  const { data: lead } = id
    ? await adminDb().from('leads').select('name,email,address,services,quote_draft').eq('id', id).single()
    : { data: null }
  const draft = lead?.quote_draft as QuoteDraft | null | undefined
  if (!lead || !draft || !lead.address) {
    return <main className="qb-page"><div className="qb-wrap">
      <p className="qb-brand">QuietGreen</p>
      <h1>This quote isn’t available</h1>
      <p className="qb-sub">The link may be out of date. Reply to our email or call us and we’ll sort it out.</p>
    </div></main>
  }
  const firstName = lead.name?.trim().split(/\s+/)[0] ?? null
  // Only what the customer needs: no internal notes, attribution or staff data.
  const sections = draft.sections.map(s => ({ name: s.name, sqFt: Math.round(Number(s.sqFt) || 0), coords: s.coords }))
  return <QuoteBooking token={decodeURIComponent(token)} firstName={firstName} address={lead.address}
    services={Array.isArray(lead.services) && lead.services.length ? lead.services as string[] : ['Lawn mowing']}
    offer={quoteOffer(draft)} sections={sections} email={lead.email ?? ''} />
}
