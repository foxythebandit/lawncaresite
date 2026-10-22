/** Shared server/database contract. Money crosses RPC boundaries as decimal strings. */
export type LeadStage = 'new' | 'contacted' | 'quoted' | 'booked' | 'lost'
export type ContactOutcome = 'no_answer' | 'reached' | 'wrong_number'
export type QuoteStatus = 'draft' | 'accepted' | 'declined' | 'canceled'
export type ActivityKind = 'note' | 'call' | 'stage' | 'quote' | 'follow_up'
export type AgreementStatus = 'active' | 'paused' | 'ended'
export type IntervalUnit = 'week' | 'month'
export type AlertChannel = 'sms' | 'voice'
export type PaymentProvenance = 'manual' | 'processor_verified'
export type MoneyDecimal = string

export type LeadWorkflowPatch = Partial<{
  name: string | null
  phone: string
  email: string | null
  address: string
  stage: LeadStage
  contact_outcome: ContactOutcome | null
  follow_up_at: string | null
  quote_status: QuoteStatus
  quote_draft: unknown
  review_quote: boolean
}>

export type LeadActivityInput = {
  kind: ActivityKind
  outcome?: string | null
  body?: string | null
  data?: unknown
}

export type LeadWorkflowResult = { lead_id: string; updated_at: string }
export type JobItemInput = {
  kind: 'service' | 'discount'
  description: string
  amount: MoneyDecimal
}
export type CreateJobResult = { booking_id: string; duplicate: boolean }
export type CompleteJobResult = {
  booking_id: string
  next_booking_id: string | null
  duplicate: boolean
}

/** Convert integer cents without binary floating-point money arithmetic. */
export function centsToAmount(cents: number): MoneyDecimal {
  if (!Number.isSafeInteger(cents)) throw new Error('Amount must be integer cents')
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
