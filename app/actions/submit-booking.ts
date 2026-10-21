 'use server'
import { saveIntakeScreenshot } from '@/lib/intake-screenshot'
import { type Attribution } from '@/lib/attribution'
import { recordIntake } from '@/lib/intake'
import { websiteLead } from '@/lib/website-intake'
export interface BookingData extends Attribution {
  submission_id: string
  lead_token?: string
  name:              string
  phone:             string
  email:             string
  preferred_date:    string
  preferred_time?:   string
  notes?:            string
  address:           string
  sq_ft:             number | null
  frequency:         string
  one_time?:         boolean
  price_per_visit:   number
  first_visit_price: number
  overgrowth_fee:    number
  last_mow:          string
  distance_miles?:   number
  distance_fee?:     number
  map_screenshot?:   string
  addon_interest?:   Record<string, unknown> | null
}

export async function submitBooking(data: BookingData) {
  try {
    if (!data.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email ?? '')) return { success: false, error: 'Name and valid email are required.' }
    for (const amount of [data.price_per_visit, data.first_visit_price, data.overgrowth_fee]) {
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return { success: false, error: 'Invalid estimate.' }
    }
    const lead = websiteLead(data, 'booking')
    const result = await recordIntake('website-booking', data.submission_id, lead, {
      name: lead.name, phone: lead.phone, email: lead.email, address: lead.address,
      sq_ft: lead.sq_ft, frequency: lead.frequency, one_time: data.one_time ?? false, manual_quote: false,
      preferred_date: data.preferred_date || null, preferred_time: data.preferred_time?.slice(0, 50) || null,
      customer_notes: data.notes?.slice(0, 2000) || null, price_per_visit: Math.round(data.price_per_visit),
      first_visit_price: Math.round(data.first_visit_price), overgrowth_fee: Math.round(data.overgrowth_fee),
      last_mow: data.last_mow?.slice(0, 50), addon_interest: data.addon_interest ?? null,
      gclid: lead.gclid, utm_source: lead.utm_source, utm_medium: lead.utm_medium, utm_campaign: lead.utm_campaign,
      utm_term: lead.utm_term, utm_content: lead.utm_content,
    }, data.lead_token)
    if (!result.duplicate && result.booking_id) await saveIntakeScreenshot('bookings', result.booking_id, data.map_screenshot)
    return { success: true, eventId: result.event_id }
  } catch { return { success: false, error: 'Could not save your booking request. Please retry.' } }
}
