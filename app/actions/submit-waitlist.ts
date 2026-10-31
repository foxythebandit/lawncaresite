'use server'

import { type Attribution } from '@/lib/attribution'
import { recordIntake } from '@/lib/intake'
import { websiteLead } from '@/lib/website-intake'

export type WaitlistData = Attribution & {
  submission_id: string
  name: string
  phone: string
  address: string
  email?: string
  sq_ft?: number | null
}

export async function submitWaitlist(data: WaitlistData) {
  if (!data || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 150
    || typeof data.address !== 'string' || !data.address.trim() || data.address.length > 500) {
    return { success: false, error: 'Name and address are required for the waitlist.' }
  }
  try {
    const lead = websiteLead(data, 'waitlist')
    const result = await recordIntake('website-waitlist', data.submission_id, {
      ...lead, services: ['Lawn care'], answers: { waitlist: true },
    })
    return { success: true, eventId: result.event_id }
  } catch {
    return { success: false, error: 'Could not save your waitlist request. Please retry.' }
  }
}
