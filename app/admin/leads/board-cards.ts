/**
 * Board cards and their order (PLAN.md 3.2). Pure, so the server page and the tests share it.
 * Every word on a card comes from summarizeLead, so card, lead page and alert text agree.
 */
import { BOARD_COLUMNS, type BoardColumn } from '@/lib/lead-board'
import { ago, money, summarizeLead, type LeadSummary, type SummaryBooking, type SummaryLead } from '@/lib/lead-summary'

export type BoardCard = {
  id: string; href: string; column: BoardColumn
  name: string; ago: string; value: string | null
  card: LeadSummary['card']
  createdAt: string; checkBackOn: string | null
  /** New column only: not taken from the alert, or saw the website price and didn't book. */
  warm: boolean
}

export function boardCard(lead: SummaryLead & { estimated_value?: unknown }, bookings: SummaryBooking[] = [], now = Date.now()): BoardCard {
  const s = summarizeLead(lead, bookings, { now })
  const value = Number(lead.estimated_value)
  return {
    id: lead.id, href: `/admin/leads/${lead.id}`, column: s.column,
    name: s.name, ago: ago(lead.created_at, now), card: s.card,
    value: lead.estimated_value != null && Number.isFinite(value) && value > 0 ? money(Math.round(value * 100)) : null,
    createdAt: lead.created_at, checkBackOn: lead.check_back_on ?? null,
    warm: (!!lead.not_taken_at && !lead.taken_by) || (s.price?.source === 'website' && s.booking === 'not_booked'),
  }
}

const newest = (a: BoardCard, b: BoardCard) => Date.parse(b.createdAt) - Date.parse(a.createdAt)

/**
 * New: warm cards first, then newest. Quoted: check-back date soonest first (overdue on top),
 * cards without one after, newest first. Every other column: newest first.
 */
export function sortColumn(column: BoardColumn, cards: BoardCard[]): BoardCard[] {
  const list = [...cards]
  if (column === 'new') return list.sort((a, b) => Number(b.warm) - Number(a.warm) || newest(a, b))
  if (column === 'quoted') {
    return list.sort((a, b) => a.checkBackOn && b.checkBackOn ? a.checkBackOn.localeCompare(b.checkBackOn) || newest(a, b)
      : a.checkBackOn ? -1 : b.checkBackOn ? 1 : newest(a, b))
  }
  return list.sort(newest)
}

export function groupBoard(cards: BoardCard[]): Record<BoardColumn, BoardCard[]> {
  const groups = Object.fromEntries(BOARD_COLUMNS.map(column => [column, [] as BoardCard[]])) as Record<BoardColumn, BoardCard[]>
  for (const card of cards) groups[card.column].push(card)
  for (const column of BOARD_COLUMNS) groups[column] = sortColumn(column, groups[column])
  return groups
}
