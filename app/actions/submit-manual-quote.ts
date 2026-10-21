'use server'
import { QUOTE_CONSENT_TEXT, QUOTE_CONSENT_VERSION } from '@/lib/quote-consent'
import { type Attribution } from '@/lib/attribution'
import { recordIntake } from '@/lib/intake'
import { websiteLead } from '@/lib/website-intake'
export interface ManualQuoteData extends Attribution {
  submission_id: string
  consent?: boolean
  name: string
  phone: string
  address: string
  lawn_size_bucket?: string
}
export async function submitManualQuote(data: ManualQuoteData) {
  try {
    if (!data.name?.trim() || !data.address?.trim()) return { success: false, error: 'Name and address are required.' }
    const result = await recordIntake('website-manual', data.submission_id, {
      ...websiteLead(data, 'manual'), answers: { lawn_size_bucket: data.lawn_size_bucket?.slice(0, 30) }, consent: data.consent === true,
      consent_text: data.consent === true ? QUOTE_CONSENT_TEXT : null, consent_version: data.consent === true ? QUOTE_CONSENT_VERSION : null,
      consented_at: data.consent === true ? new Date().toISOString() : null,
    })
    return { success: true, eventId: result.event_id }
  } catch { return { success: false, error: 'Could not save your inquiry. Please retry.' } }
}
