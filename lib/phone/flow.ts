import 'server-only'
import { dial, gather, hangup, publicUrl, redirect, say, twiml, UUID } from './twilio'

/** Decisions and TwiML for the press-1 flow (PLAN.md 7.2, 7.2b, 7.7b). Pure apart from env reads. */

export type LegRef = { call: string; lead: string; event: string }
export function legUrls(leg: LegRef) {
  const query = { lead: leg.lead, event: leg.event, call: leg.call }
  return {
    answer: publicUrl('/api/twilio/alert', query),
    press: publicUrl('/api/twilio/press', query),
    status: publicUrl('/api/twilio/status', query),
    dialResult: publicUrl('/api/twilio/dial-result', query),
    recording: publicUrl('/api/twilio/recording', query),
  }
}

/** The leg a webhook is for, from the IDs we put in its (signed) URL. */
export function legRef(requestUrl: string): LegRef | null {
  const query = new URL(requestUrl).searchParams
  const leg = { call: query.get('call') ?? '', lead: query.get('lead') ?? '', event: query.get('event') ?? '' }
  return Object.values(leg).every(id => UUID.test(id)) ? leg : null
}

/** P0 / E16: Twilio connects by default; `CONNECT_MODE=dial-yourself` only claims. */
export const connectMode = (): 'twilio' | 'dial-yourself' => process.env.CONNECT_MODE === 'dial-yourself' ? 'dial-yourself' : 'twilio'

/** R14: show the claimer's own cell only when it is verified in Twilio; otherwise the alert line. */
export function callerIdFor(staffPhone: string): string {
  const verified = (process.env.TWILIO_VERIFIED_CALLER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return verified.includes(staffPhone) ? staffPhone : process.env.TWILIO_FROM_NUMBER!
}

/** Alert leg answered: R3 check first, then the prompt twice, then hang up. */
export function answerTwiml(input: { takenBy: string | null; mine: boolean; prompt: string; pressUrl: string }): string {
  if (input.takenBy && !input.mine) return twiml(say(`${input.takenBy} has it.`), hangup())
  const ask = gather(input.pressUrl, say(input.prompt))
  return twiml(ask, ask, hangup())
}

export type Claim = { won: boolean; dial: boolean; taken_by: string | null }

/** Reply to a keypress. `claim` is the crm_alert_press result for digit 1. */
export function pressTwiml(input: {
  digit: string; claim?: Claim; mode: 'twilio' | 'dial-yourself'; customer: string | null; callerId: string
  urls: ReturnType<typeof legUrls>
}): string {
  const { claim } = input
  if (input.digit === '2') return twiml(hangup())
  if (input.digit !== '1' || !claim) return twiml(redirect(input.urls.answer))
  if (!claim.won) return twiml(say(`${claim.taken_by ?? 'Someone else'} has it.`), hangup())
  if (input.mode === 'dial-yourself') return twiml(say('It\'s yours. Call them from your phone.'), hangup())
  if (!claim.dial) return twiml(say('You already have this lead.'), hangup())
  if (!input.customer) return twiml(say('It\'s yours, but there is no valid phone number. Check the text.'), hangup())
  return twiml(say('Connecting you.'), dial(input.customer, {
    callerId: input.callerId, action: input.urls.dialResult, recordingStatusCallback: input.urls.recording,
  }))
}

export type CustomerLegResult = 'talked' | 'no_answer' | 'busy' | 'failed' | 'hung_up_early'

/** DialCallStatus of the bridged customer leg (7.2, E4, R11). */
export function dialOutcome(status: string | undefined, duration: string | number | undefined): CustomerLegResult | null {
  const seconds = Number(duration) || 0
  switch (status) {
    case 'completed': case 'answered': return seconds > 0 ? 'talked' : 'no_answer'
    case 'no-answer': return 'no_answer'
    case 'busy': return 'busy'
    case 'failed': return 'failed'
    case 'canceled': return 'hung_up_early'
    default: return null
  }
}

export const TERMINAL_CALL_STATUS = ['completed', 'busy', 'no-answer', 'failed', 'canceled']
