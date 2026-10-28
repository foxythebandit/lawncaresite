/** Fixed board vocabulary (PLAN.md 3.2, 3.5 S4/S4b). The database checks the same values. */
export const BOARD_COLUMNS = ['new', 'in_talks', 'quoted', 'booking_request', 'customer', 'closed'] as const
export type BoardColumn = typeof BOARD_COLUMNS[number]
export const COLUMN_LABEL: Record<BoardColumn, string> = {
  new: 'New', in_talks: 'In talks', quoted: 'Quoted', booking_request: 'Booking request', customer: 'Customer', closed: 'Closed',
}

export const QUOTED_REASONS = ['start_later', 'budget', 'thinking', 'checking_with_someone', 'comparing_quotes', 'wants_lower_price', 'other'] as const
export type QuotedReason = typeof QUOTED_REASONS[number]
export const QUOTED_REASON_LABEL: Record<QuotedReason, string> = {
  start_later: 'Start later', budget: 'Budget', thinking: 'Thinking', checking_with_someone: 'Checking with someone',
  comparing_quotes: 'Comparing quotes', wants_lower_price: 'Wants lower price', other: 'Other',
}

export const CLOSED_REASONS = ['price', 'has_someone_else', 'never_responded', 'outside_area', 'just_checking_prices', 'spam_duplicate', 'bad_number', 'other'] as const
export type ClosedReason = typeof CLOSED_REASONS[number]
export const CLOSED_REASON_LABEL: Record<ClosedReason, string> = {
  price: 'Price', has_someone_else: 'Has someone else', never_responded: 'Never responded', outside_area: 'Outside area',
  just_checking_prices: 'Just checking prices', spam_duplicate: 'Spam/duplicate', bad_number: 'Bad number', other: 'Other',
}

/** Log call sheet v2: step 1 picks the group, step 2 the outcome. `to` is the column the card moves to. */
export const CALL_OUTCOMES = ['no_answer', 'voicemail', 'bad_number', 'booked', 'yes_tbd', 'not_now', 'no'] as const
export type CallOutcome = typeof CALL_OUTCOMES[number]
export const CALL_OUTCOME: Record<CallOutcome, { label: string; icon: string; step: 'not_reached' | 'talked'; to: BoardColumn }> = {
  no_answer:  { label: 'No answer',      icon: '⚪', step: 'not_reached', to: 'in_talks' },
  voicemail:  { label: 'Left voicemail', icon: '⚪', step: 'not_reached', to: 'in_talks' },
  bad_number: { label: 'Bad number',     icon: '⚫', step: 'not_reached', to: 'closed' },
  booked:     { label: 'Booked',         icon: '🟢', step: 'talked',      to: 'customer' },
  yes_tbd:    { label: 'Yes, date TBD',  icon: '🟢', step: 'talked',      to: 'booking_request' },
  not_now:    { label: 'Not now',        icon: '🟡', step: 'talked',      to: 'quoted' },
  no:         { label: 'No',             icon: '🔴', step: 'talked',      to: 'closed' },
}

/** Mowing frequencies as stored (`weekly`) or as older rows wrote them (`Bi-weekly`). */
export const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'onetime'] as const
export type Frequency = typeof FREQUENCIES[number]
export const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: 'weekly', biweekly: 'every 2 wks', monthly: 'monthly', onetime: 'one time' }
export function normalizeFrequency(value: unknown): Frequency | null {
  const key = typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  if (key === 'weekly') return 'weekly'
  if (['biweekly', 'every2weeks', 'every2wks', 'everyotherweek'].includes(key)) return 'biweekly'
  if (key === 'monthly') return 'monthly'
  if (['onetime', 'once', 'justonce', 'single', 'singlevisit', 'thisjob'].includes(key)) return 'onetime'
  return null
}

export const isColumn = (value: unknown): value is BoardColumn => BOARD_COLUMNS.includes(value as BoardColumn)
export const isQuotedReason = (value: unknown): value is QuotedReason => QUOTED_REASONS.includes(value as QuotedReason)
export const isClosedReason = (value: unknown): value is ClosedReason => CLOSED_REASONS.includes(value as ClosedReason)
export const isCallOutcome = (value: unknown): value is CallOutcome => CALL_OUTCOMES.includes(value as CallOutcome)
