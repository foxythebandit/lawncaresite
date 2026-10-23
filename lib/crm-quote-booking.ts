/** Plan-generated visits copy the lead ID, but are not a new acceptance of its quote. */
export function isQuoteBooking(booking: { accepted_quote_snapshot?: unknown; creation_operation_id?: string | null }) {
  const snapshot = booking.accepted_quote_snapshot
  return !!booking.creation_operation_id || !(snapshot && typeof snapshot === 'object' && 'agreement_id' in snapshot)
}

export function latestQuoteBooking<T extends { created_at: string; accepted_quote_snapshot?: unknown; creation_operation_id?: string | null }>(bookings: T[]): T | undefined {
  return bookings.filter(isQuoteBooking).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
}
