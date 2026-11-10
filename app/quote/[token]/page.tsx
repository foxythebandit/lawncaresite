import type { Metadata } from 'next'
import Link from 'next/link'
import { verifiedLead } from '@/lib/intake'
import { adminDb } from '@/lib/supabase/admin'
import { offerPath, verifiedOffer, type OfferTerms } from '@/lib/sent-offer'
import { quoteTotalCents, type QuoteDraft } from '@/lib/quote-draft'
import QuoteBooking from './QuoteBooking'
import './quote.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your QuietGreen quote', robots: { index: false, follow: false } }

export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const reference = verifiedOffer(token)
  if (reference) {
    const { data: offer } = await adminDb().from('sent_offers')
      .select('terms,recipient,state,sent_at,replaced_by,accepted_booking_id')
      .eq('lead_id', reference.leadId).eq('id', reference.offerId).maybeSingle()
    const terms = offer?.terms as OfferTerms | undefined
    if (!offer?.sent_at || !terms?.address) return <Unavailable />
    const { address, firstName, sqFt, mowing, rows, message, draft } = terms
    const latest = offer.replaced_by
      ? await adminDb().from('sent_offers').select('id').eq('lead_id', reference.leadId).eq('state', 'sent').is('replaced_by', null).order('version', { ascending: false }).limit(1).maybeSingle()
      : null
    const notice = offer.replaced_by ? <div className="qb-card">
      <h2>A revised quote is available</h2><p className="qb-sub">This page shows the original terms.</p>
      <Link className="qb-link" href={offerPath(reference.leadId, latest?.data?.id ?? offer.replaced_by)}>Review the revised quote ›</Link>
    </div> : offer.accepted_booking_id ? <p className="qb-sub">We’ve received your request for this quote. We’ll contact you about your first visit.</p>
      : offer.state === 'review' ? <p className="qb-sub">This proposal needs review. Reply to our email to discuss it.</p> : null
    return <QuoteBooking token={token} firstName={firstName} address={address}
      offer={{ sqFt, mowing, rows, message }} sections={draft.sections.map(({ name, sqFt, coords }) => ({ name, sqFt: Math.round(sqFt), coords }))}
      email={offer.recipient} notice={notice} closed={!!(offer.replaced_by || offer.accepted_booking_id || offer.state === 'review')} />
  }

  const id = verifiedLead(token)
  if (!id) return <Unavailable />
  const db = adminDb()
  const [{ data: lead }, { data: visit }] = await Promise.all([
    db.from('leads').select('name,email,address,accepted_quote_snapshot').eq('id', id).maybeSingle(),
    db.from('bookings').select('status,address').eq('lead_id', id)
      .in('status', ['pending','confirmed','completed']).order('created_at').limit(1).maybeSingle(),
  ])
  const address = visit?.address ?? lead?.address
  if (!lead || !address) return <Unavailable />
  const accepted = lead.accepted_quote_snapshot as (QuoteDraft & { sent_offer?: unknown }) | null
  const historicalTotal = accepted?.sections && !accepted.sent_offer && Number.isFinite(quoteTotalCents(accepted)) ? quoteTotalCents(accepted) : null
  return <QuoteBooking token={token} firstName={lead.name?.trim().split(/\s+/)[0] ?? null} address={address}
    sections={[]} email={lead.email ?? ''} closed={!!visit} historicalTotal={historicalTotal}
    notice={<p className="qb-sub">{visit ? 'We already have your visit on file. Reply to our email if you need to make a change.'
      : 'This is an older quote link. Request a preferred date and we’ll review the quoted terms with you before confirming.'}</p>} />
}

function Unavailable() {
  return <main className="qb-page"><div className="qb-wrap">
    <p className="qb-brand">QuietGreen</p>
    <h1>This quote isn’t available</h1>
    <p className="qb-sub">Reply to our email or call us and we’ll help.</p>
  </div></main>
}
