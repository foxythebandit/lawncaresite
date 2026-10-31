import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { isColumn } from '@/lib/lead-board'
import type { SummaryBooking, SummaryLead } from '@/lib/lead-summary'
import { boardCard, groupBoard } from './board-cards'
import Board from './Board'
import CallerIdNote from './CallerIdNote'
import LeadWarmup from './LeadWarmup'

export const dynamic = 'force-dynamic'

// Only what boardCard/summarizeLead and the warmup read. No lawn_tracing (up to ~200 KB a lead):
// cards never show traced shapes, and summarizeLead falls back to sq_ft.
const LEAD_FIELDS = 'id,name,phone,address,sq_ft,created_at,source,services,frequency,timing,answers,attribution,'
  + 'utm_source,utm_medium,utm_campaign,utm_content,gclid,gbraid,wbraid,google_campaign_id,'
  + 'board_column,call_attempts,quoted_reason,closed_reason,check_back_on,first_visit_on,customer_canceled_at,'
  + 'phone_price_cents,phone_frequency,phone_price_at,website_price_cents,website_first_visit_cents,website_frequency,website_price_at,'
  + 'quote_status,quote_draft,quote_confirmed_at,quote_emailed_at,accepted_quote_snapshot,quote_accepted_at,'
  + 'taken_by,not_taken_at,needs_call_log_at,estimated_value'
// Only the summary's columns; requestBookings() picks the lead's own visit out of any plan visits.
const BOOKING_FIELDS = 'lead_id,status,created_at,preferred_date,preferred_time,confirmed_date,frequency,price_per_visit,first_visit_price,customer_notes,occurrence_on,agreement_id,manual_quote'

/** Lead board (PLAN.md 3.2, S6, S7): rendered on the server with every card already in place. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ view?: string; col?: string }> }) {
  await requireStaff('/admin/leads')
  const { view, col } = await searchParams
  const db = adminDb()
  const [{ data: leadRows }, { data: bookings }] = await Promise.all([
    db.from('leads').select(LEAD_FIELDS).order('created_at', { ascending: false }),
    db.from('bookings').select(BOOKING_FIELDS).not('lead_id', 'is', null),
  ])
  const leads = (leadRows ?? []) as unknown as (SummaryLead & { quote_draft?: { jobLatLng?: { lat: number; lng: number } | null } | null })[]
  const byLead = new Map<string, SummaryBooking[]>()
  for (const booking of bookings ?? []) byLead.set(booking.lead_id, [...(byLead.get(booking.lead_id) ?? []), booking])
  // One request timestamp keeps "12m" labels and check-back chips consistent.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const cards = leads.map(lead => boardCard(lead, byLead.get(lead.id) ?? [], now))
  // The top of New is what staff open while the phone rings; get it ready first.
  const top = groupBoard(cards).new.slice(0, 2).map(card => {
    const lead = leads.find(l => l.id === card.id)!
    const answers = lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers) ? lead.answers as { address_needs_review?: unknown } : {}
    return { href: card.href, address: lead.address ?? null, jobLatLng: lead.quote_draft?.jobLatLng ?? null, needsReview: answers.address_needs_review === true }
  })
  return <div className="crm-page crm-board-page">
    <Board cards={cards} initialView={view === 'list' ? 'list' : 'board'} initialColumn={isColumn(col) ? col : 'new'}><CallerIdNote /></Board>
    <LeadWarmup leads={top} />
  </div>
}
