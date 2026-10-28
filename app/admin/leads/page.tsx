import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { isColumn } from '@/lib/lead-board'
import type { SummaryBooking, SummaryLead } from '@/lib/lead-summary'
import { boardCard, groupBoard } from './board-cards'
import Board from './Board'
import LeadWarmup from './LeadWarmup'

export const dynamic = 'force-dynamic'

const BOOKING_FIELDS = 'lead_id,status,created_at,preferred_date,preferred_time,confirmed_date,frequency,price_per_visit,first_visit_price,overgrowth_fee,customer_notes,addon_interest,occurrence_on'

/** Lead board (PLAN.md 3.2, S6, S7): rendered on the server with every card already in place. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ view?: string; col?: string }> }) {
  await requireStaff('/admin/leads')
  const { view, col } = await searchParams
  const db = adminDb()
  const [{ data: leads }, { data: bookings }] = await Promise.all([
    db.from('leads').select('*').order('created_at', { ascending: false }),
    db.from('bookings').select(BOOKING_FIELDS).not('lead_id', 'is', null),
  ])
  const byLead = new Map<string, SummaryBooking[]>()
  for (const booking of bookings ?? []) byLead.set(booking.lead_id, [...(byLead.get(booking.lead_id) ?? []), booking])
  // One request timestamp keeps "12m" labels and check-back chips consistent.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const cards = (leads ?? []).map(lead => boardCard(lead as SummaryLead, byLead.get(lead.id) ?? [], now))
  // The top of New is what staff open while the phone rings; get it ready first.
  const top = groupBoard(cards).new.slice(0, 2).map(card => {
    const lead = leads!.find(l => l.id === card.id)!
    const answers = lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers) ? lead.answers as { address_needs_review?: unknown } : {}
    return { href: card.href, address: lead.address, jobLatLng: lead.quote_draft?.jobLatLng ?? null, needsReview: answers.address_needs_review === true }
  })
  return <div className="crm-page crm-board-page">
    <Board cards={cards} initialView={view === 'list' ? 'list' : 'board'} initialColumn={isColumn(col) ? col : 'new'} />
    <LeadWarmup leads={top} />
  </div>
}
