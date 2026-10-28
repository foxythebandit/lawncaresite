'use server'
import { saveIntakeScreenshot } from '@/lib/intake-screenshot'
import { QUOTE_CONSENT_TEXT, QUOTE_CONSENT_VERSION } from '@/lib/quote-consent'
import { type Attribution } from '@/lib/attribution'
import { recordIntake, leadToken } from '@/lib/intake'
import { websiteLead } from '@/lib/website-intake'
export interface LeadData extends Attribution {
  submission_id: string
  phone: string
  address: string
  sq_ft: number | null
  consent: boolean
  consentText: string
  map_screenshot?: string
  /** The instant price shown at unlock and the traced shapes (PLAN.md 3.3); validated in websiteLead. */
  website_price?: { price_per_visit: number; first_visit_price: number; frequency: string }
  lawn_tracing?: { name: string; sqFt: number; coords: [number, number][] | null }[]
}
export async function submitLead(data: LeadData) {
  try {
    if (!data.consent || data.consentText !== QUOTE_CONSENT_TEXT) return { success: false, error: 'Please consent to being contacted.' }
    const result = await recordIntake('website-map', data.submission_id, {
      ...websiteLead(data, 'map'), consent: true, consent_text: QUOTE_CONSENT_TEXT, consent_version: QUOTE_CONSENT_VERSION, consented_at: new Date().toISOString(),
    })
    if (!result.duplicate && result.lead_id) await saveIntakeScreenshot('leads', result.lead_id, data.map_screenshot)
    return { success: true, leadToken: leadToken(result.lead_id), eventId: result.event_id }
  } catch { return { success: false, error: 'Could not save your inquiry. Please retry.' } }
}
