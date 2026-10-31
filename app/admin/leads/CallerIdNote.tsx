import { phoneDisplay } from '@/lib/lead-summary'
import { callerIdFor, connectMode } from '@/lib/phone/flow'
import { staffPeople } from '@/lib/staff-directory'

/**
 * R14 setup warning, shown once on the board instead of on every lead: a staff cell missing from
 * TWILIO_VERIFIED_CALLER_IDS shows the alert line to customers on connected calls.
 */
export default function CallerIdNote() {
  const unverified = connectMode() === 'twilio' ? staffPeople().filter(person => callerIdFor(person.phone) !== person.phone) : []
  if (!unverified.length) return null
  const alertLine = phoneDisplay(process.env.TWILIO_FROM_NUMBER) || 'the alert line'
  const who = unverified.map(person => person.name === person.phone ? phoneDisplay(person.phone) : person.name).join(' · ')
  return <p className="crm-setup-note" role="note">
    <strong>Setup</strong><span>Caller ID not verified · {who}</span><span className="crm-setup-note-detail">Customers see {alertLine}</span>
  </p>
}
