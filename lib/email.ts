// lib-ok: every email the app sends goes through this one place, so local dev can't reach real customers.
import 'server-only'
import { Resend, type CreateEmailOptions } from 'resend'

/**
 * Sends through Resend. When EMAIL_DEV_RECIPIENT is set (local only, never in Vercel), the email goes
 * to that address instead, with the original recipient in the subject.
 */
export function sendEmail(message: CreateEmailOptions) {
  const devRecipient = process.env.EMAIL_DEV_RECIPIENT
  const resend = new Resend(process.env.RESEND_API_KEY)
  if (!devRecipient) return resend.emails.send(message)
  return resend.emails.send({ ...message, to: devRecipient, cc: undefined, bcc: undefined, subject: `[to ${[message.to].flat().join(', ')}] ${message.subject}` })
}
