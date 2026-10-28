/**
 * One-time placement of existing leads on the board (PLAN.md 3.5 S8). Pure rules, no imports at
 * runtime, so `scripts/place-leads-on-board.mjs` can load this file with plain Node.
 */
import type { BoardColumn, ClosedReason } from './lead-board'

export type PlacementLead = {
  id: string; stage?: string | null; quote_status?: string | null; contact_outcome?: string | null
  source?: string | null; answers?: unknown; updated_at?: string | null
  quote_confirmed_at?: string | null; quote_emailed_at?: string | null
}
export type PlacementBooking = { status?: string | null; agreement_id?: string | null; occurrence_on?: string | null; created_at?: string | null; updated_at?: string | null }
export type PlacementActivity = { kind: string; outcome?: string | null }

export type Placement = {
  column: BoardColumn
  /** Why, in a few words, for the dry-run table. */
  reason: string
  closed_reason?: ClosedReason
  /** Set when a customer canceled after booking (stays in Customer with a Canceled chip, S9). */
  canceled?: boolean
  call_attempts?: number
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Rules, first match wins:
 * 1. confirmed/completed visit → Customer (Canceled chip if the lead was later lost/canceled)
 * 2. pending request (not a generated plan visit) → Booking request
 * 3. quote declined → Closed · price; stage lost → Closed · never responded (never reached) or other
 * 4. wrong number → Closed · bad number
 * 5. outside area / waitlist → Closed · outside area
 * 6. stage quoted, or a quote saved or emailed → Quoted
 * 7. no answer or stage contacted → In talks (attempts = logged no-answer calls)
 * 8. else New
 * Closed rules come before Quoted/In talks so a definite "no" wins over an older state.
 */
export function placeLead(lead: PlacementLead, bookings: PlacementBooking[] = [], activities: PlacementActivity[] = []): Placement {
  const answers = isObject(lead.answers) ? lead.answers : {}
  const lost = lead.stage === 'lost' || lead.quote_status === 'canceled'
  if (bookings.some(b => b.status === 'confirmed' || b.status === 'completed')) {
    const canceled = lost && !bookings.some(b => b.status === 'pending' || b.status === 'confirmed')
    return { column: 'customer', reason: canceled ? 'booked, then canceled' : 'visit confirmed', ...(canceled ? { canceled } : {}) }
  }
  if (bookings.some(b => b.status === 'pending' && !b.agreement_id && !b.occurrence_on)) {
    return { column: 'booking_request', reason: 'pending booking' }
  }
  if (lead.quote_status === 'declined') return { column: 'closed', reason: 'quote declined', closed_reason: 'price' }
  if (lead.contact_outcome === 'wrong_number') return { column: 'closed', reason: 'wrong number', closed_reason: 'bad_number' }
  const outside = lead.source === 'website-waitlist' || answers.waitlist === true || answers.outside_area === true
  if (outside) return { column: 'closed', reason: 'outside area / waitlist', closed_reason: 'outside_area' }
  if (lead.stage === 'lost') {
    const neverReached = !lead.contact_outcome || lead.contact_outcome === 'no_answer'
    return { column: 'closed', reason: 'stage lost', closed_reason: neverReached ? 'never_responded' : 'other' }
  }
  const quoteSent = !!lead.quote_confirmed_at || !!lead.quote_emailed_at
    || activities.some(a => a.kind === 'quote' && (a.outcome === 'emailed' || a.outcome === 'reviewed'))
  if (lead.stage === 'quoted' || quoteSent) return { column: 'quoted', reason: lead.stage === 'quoted' ? 'stage quoted' : 'quote saved/emailed' }
  if (lead.contact_outcome === 'no_answer' || lead.stage === 'contacted') {
    const attempts = activities.filter(a => a.kind === 'call' && a.outcome === 'no_answer').length
    return { column: 'in_talks', reason: lead.contact_outcome === 'no_answer' ? 'no answer' : 'stage contacted', call_attempts: attempts }
  }
  return { column: 'new', reason: 'no contact yet' }
}
