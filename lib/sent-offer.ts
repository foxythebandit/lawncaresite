// lib-ok: staff email and public quote routes share the signed offer reference.
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CreateEmailOptions } from 'resend'
import type { IntroChoice } from './quote-offer'
import type { QuoteDraft } from './quote-draft'
import type { QuoteEmailBreakdown } from './quote-email'
import { adminDb } from './supabase/admin'

export const QUOTE_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type OfferTerms = QuoteEmailBreakdown & {
  draft: QuoteDraft
  address: string | null
  firstName: string | null
  message: string
  mowing: boolean
  introChoice?: IntroChoice | null
}

export type SentOffer = {
  id: string
  lead_id: string
  version: number
  terms: OfferTerms
  message: CreateEmailOptions
  recipient: string
  state: 'sending' | 'unknown' | 'failed' | 'sent' | 'review' | 'closed'
  created_at: string
  sent_at: string | null
  replaced_by: string | null
  accepted_booking_id: string | null
}

export type SentOfferSummary = Pick<SentOffer, 'id' | 'version' | 'recipient' | 'state' | 'created_at' | 'sent_at' | 'accepted_booking_id'> & {
  href: string | null
  subject: string | null
  retryExpired: boolean
  replaced: boolean
  rows: QuoteEmailBreakdown['rows']
  publicUrl: string | null
}

export function signOfferProof(payload: string) {
  return createHmac('sha256', process.env.SUPABASE_SECRET_KEY!).update(payload).digest('hex')
}

export function verifyOfferProof(payload: string, proof: string) {
  return typeof proof === 'string' && /^[0-9a-f]{64}$/.test(proof)
    && timingSafeEqual(Buffer.from(proof), Buffer.from(signOfferProof(payload)))
}

export function offerPath(leadId: string, offerId: string) {
  const payload = `q1.${leadId}.${offerId}`
  return `/quote/${payload}.${signOfferProof(payload)}`
}

export function verifiedOffer(token: string) {
  if (typeof token !== 'string' || token.length !== 141) return null
  const [version, leadId, offerId, proof] = token.split('.')
  if (version !== 'q1' || !ID.test(leadId) || !ID.test(offerId)
    || !verifyOfferProof(`${version}.${leadId}.${offerId}`, proof)) return null
  return { leadId, offerId }
}

export async function readSentOffer(leadId: string, offerId: string): Promise<SentOffer | null> {
  const { data, error } = await adminDb().from('sent_offers')
    .select('id,lead_id,version,terms,message,recipient,state,created_at,sent_at,replaced_by,accepted_booking_id')
    .eq('id', offerId).eq('lead_id', leadId).maybeSingle()
  if (error) throw new Error('Could not read this quote')
  return data as SentOffer | null
}
