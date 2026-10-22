'use server'

import { type Attribution } from '@/lib/attribution'
import { recordIntake } from '@/lib/intake'
import { QUOTE_CONSENT_TEXT, QUOTE_CONSENT_VERSION } from '@/lib/quote-consent'
import { websiteLead } from '@/lib/website-intake'

const SERVICES = ['Landscaping', 'Yard cleanup', 'Gutter cleaning', 'Lawn mowing', 'Other'] as const
export type ServiceInquiryKind = typeof SERVICES[number]

export interface ServiceInquiryData extends Attribution {
  submission_id: string
  name: string
  phone: string
  address: string
  email?: string
  service: ServiceInquiryKind
  notes?: string
  consent?: boolean
}

export async function submitServiceInquiry(data: ServiceInquiryData) {
  if (!data || typeof data !== 'object') return { success: false, error: 'Please check your details and try again.' }
  const { name, phone, address, email, service, notes } = data
  if (typeof name !== 'string' || !name.trim() || name.length > 150 ||
      typeof address !== 'string' || !address.trim() || address.length > 500 ||
      typeof phone !== 'string' || !/^[\d\s()+-]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7 ||
      !SERVICES.includes(service) ||
      (email != null && (typeof email !== 'string' || email.length > 254 || (email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())))) ||
      (notes != null && (typeof notes !== 'string' || notes.length > 2000))) {
    return { success: false, error: 'Please check your name, phone, address, and project details.' }
  }

  try {
    const lead = websiteLead({ ...data, name, phone, address, email, notes }, 'service')
    const result = await recordIntake('website-service', data.submission_id, {
      ...lead,
      services: [service],
      answers: { service, notes: notes?.trim() || null },
      consent: data.consent === true,
      consent_text: data.consent === true ? QUOTE_CONSENT_TEXT : null,
      consent_version: data.consent === true ? QUOTE_CONSENT_VERSION : null,
      consented_at: data.consent === true ? new Date().toISOString() : null,
    })
    return { success: true, eventId: result.event_id }
  } catch {
    return { success: false, error: 'Could not save your inquiry. Please retry.' }
  }
}
