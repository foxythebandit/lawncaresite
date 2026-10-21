'use server'
import { submitManualQuote } from './submit-manual-quote'
export type QuoteState = { success: true; eventId?: string } | { success: false; error: string } | null
/** Retained legacy form uses the same durable CRM intake as the active manual form. */
export async function submitQuote(_prevState: QuoteState, formData: FormData): Promise<QuoteState> {
  const result = await submitManualQuote({
    submission_id: String(formData.get('submission_id') ?? ''), name: String(formData.get('name') ?? ''),
    phone: String(formData.get('phone') ?? ''), address: String(formData.get('postcode') ?? ''),
    lawn_size_bucket: String(formData.get('yard_size') ?? ''),
  })
  return result.success ? { success: true, eventId: result.eventId } : { success: false, error: result.error ?? 'Could not save inquiry.' }
}
