import 'server-only'
import { staffRecipients } from './staff-alerts'

export type StaffPerson = { name: string; phone: string; email: string | null }

/**
 * Names and logins for the two alert phones. STAFF_PEOPLE is
 * "Caelan:+19798886158:caelan@example.com,Paxton:+16823528260:paxton@example.com";
 * phones must match TWILIO_STAFF_PHONES. A phone without an entry is shown by its number.
 */
export function staffPeople(): StaffPerson[] {
  const entries = (process.env.STAFF_PEOPLE ?? '').split(',').map(entry => entry.split(':').map(s => s.trim()))
  return staffRecipients().map(phone => {
    const entry = entries.find(([, p]) => p === phone)
    const name = entry?.[0] && /^[\p{L} .'-]{1,40}$/u.test(entry[0]) ? entry[0] : phone
    return { name, phone, email: entry?.[2]?.toLowerCase() || null }
  })
}
export const staffByPhone = (phone: string | null | undefined) => staffPeople().find(p => p.phone === phone) ?? null
export const staffByEmail = (email: string | null | undefined) => staffPeople().find(p => !!email && p.email === email.toLowerCase()) ?? null
export const otherStaff = (phone: string | null | undefined) => staffPeople().filter(p => p.phone !== phone)
