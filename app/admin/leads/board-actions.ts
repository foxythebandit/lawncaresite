'use server'
import type { OfferTerms } from '@/lib/sent-offer'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { isCallOutcome, isClosedReason, isColumn, isQuotedReason, FREQUENCIES, type BoardColumn, type CallOutcome, type Frequency } from '@/lib/lead-board'
import { notifyCallLogged } from '@/lib/phone/notify'
import { callVisitItems } from '@/lib/crm-jobs'
import { serviceLabels } from '@/lib/lead-labels'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const validDay = (value: unknown): value is string => typeof value === 'string' && DAY.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`))

export type BoardResult = { ok: true; column: BoardColumn } | { ok: false; error: string }

function refresh(leadId: string) {
  revalidatePath('/admin/leads')
  revalidatePath(`/admin/leads/${leadId}`)
}

/** Drag/menu move on the board (PLAN.md 3.2). Closed needs a reason; Quoted takes an optional reason and check-back date. */
export async function moveLead(leadId: string, column: string, detail: { closed_reason?: string; quoted_reason?: string; check_back_on?: string | null } = {}): Promise<BoardResult> {
  const user = await requireStaff('/admin/leads')
  if (!UUID.test(leadId) || !isColumn(column)) return { ok: false, error: 'Refresh and try again' }
  const clean: Record<string, string | null> = {}
  if (column === 'closed') {
    if (!isClosedReason(detail.closed_reason)) return { ok: false, error: 'Pick a reason' }
    clean.closed_reason = detail.closed_reason
  }
  if (column === 'quoted') {
    if (detail.quoted_reason != null) {
      if (!isQuotedReason(detail.quoted_reason)) return { ok: false, error: 'Pick a reason' }
      clean.quoted_reason = detail.quoted_reason
    }
    if (detail.check_back_on != null) {
      if (!validDay(detail.check_back_on)) return { ok: false, error: 'Pick a valid date' }
      clean.check_back_on = detail.check_back_on
    }
  }
  const { data, error } = await adminDb().rpc('crm_move_lead', { p_lead_id: leadId, p_column: column, p_detail: clean, p_actor_email: user.email })
  if (error) return { ok: false, error: error.code === 'P0002' ? 'Lead not found' : error.code === '23514' ? 'Pick a reason' : 'Not saved' }
  refresh(leadId)
  return { ok: true, column: (data as { board_column: BoardColumn }).board_column }
}

export type CallDetail = { price_cents?: number; frequency?: Frequency; first_visit_on?: string; check_back_on?: string; reason?: string; note?: string }

/**
 * Log call sheet v2 (PLAN.md 3.2, S11). The client generates `operationId` once per attempt, so a
 * retry after a lost response returns the first result instead of logging twice.
 */
export async function logCall(leadId: string, operationId: string, outcome: string, detail: CallDetail): Promise<BoardResult & {
  activityId?: string; bookingId?: string; requestPending?: boolean
}> {
  const user = await requireStaff(`/admin/leads/${leadId}`)
  if (!UUID.test(leadId) || !UUID.test(operationId) || !isCallOutcome(outcome)) return { ok: false, error: 'Refresh and try again' }
  const clean = cleanDetail(outcome, detail)
  if (typeof clean === 'string') return { ok: false, error: clean }
  const db = adminDb()
  const actor = user.email ?? 'Staff'
  const args = { p_lead_id: leadId, p_operation_id: operationId, p_detail: clean, p_actor_email: actor }
  let result
  if (outcome === 'booked') {
    const [{ data: lead }, { data: sent, error: sentError }] = await Promise.all([
      db.from('leads').select('services,customer_id').eq('id', leadId).maybeSingle(),
      db.from('sent_offers').select('id,terms').eq('lead_id', leadId).eq('state', 'sent').is('replaced_by', null)
        .order('version', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (!lead || sentError) return { ok: false, error: 'Could not verify the agreed service' }
    const freq = clean.frequency as Frequency
    const services = serviceLabels(lead.services)
    const mowing = services.length === 1 && services[0] === 'Mowing'
    let introEligible = mowing
    if (mowing && lead.customer_id) {
      const { data: eligible, error } = await db.rpc('crm_intro_customer_eligible', { p_customer_id: lead.customer_id })
      if (error) return { ok: false, error: 'Could not verify the first-mow price' }
      introEligible = eligible === true
    }
    const description = mowing ? 'Lawn care' : services.join(', ').slice(0, 100) || 'Service'
    const { items, plan } = callVisitItems(Number(clean.price_cents), freq, description, introEligible)
    const quoted = sent ? (sent.terms as OfferTerms).rows : null
    const terms = sent && quoted?.length === 1 && quoted[0].freq === freq && quoted[0].perVisitCents === clean.price_cents
      ? { offer_id: sent.id } : { source: 'phone_call', frequency: freq, mowing, items, regular_items: plan }
    result = await db.rpc('crm_record_booked_call', { ...args, p_terms: terms })
  } else {
    result = await db.rpc('crm_log_call', { ...args, p_outcome: outcome })
  }
  if (result.error) {
    const error = result.error
    return { ok: false, error: ['23514', '22023', 'PT409'].includes(error.code) ? error.message
      : error.code === '23505' ? 'Already saved differently · refresh' : error.code === 'P0002' ? 'Lead not found' : 'Not saved' }
  }
  const saved = result.data as { board_column: BoardColumn; activity_id: string; duplicate: boolean; booking_id?: string; request_pending?: boolean }
  if (!saved.duplicate && user.email) after(() => notifyCallLogged(leadId, saved.activity_id, user.email!).catch(() => {}))
  refresh(leadId)
  if (saved.booking_id) revalidatePath('/admin/jobs')
  return { ok: true, column: saved.board_column, activityId: saved.activity_id, bookingId: saved.booking_id, requestPending: saved.request_pending }
}

/** The detail keys crm_log_call accepts for this outcome, or a short error. */
function cleanDetail(outcome: CallOutcome, detail: CallDetail): Record<string, string | number> | string {
  const out: Record<string, string | number> = {}
  const talked = ['booked', 'yes_tbd', 'not_now', 'no'].includes(outcome)
  if (detail.price_cents != null && talked) {
    if (!Number.isSafeInteger(detail.price_cents) || detail.price_cents <= 0 || detail.price_cents > 10000000) return 'Enter a price'
    out.price_cents = detail.price_cents
  } else if (['booked', 'yes_tbd', 'not_now'].includes(outcome)) return 'Enter a price'
  if (outcome === 'booked' || outcome === 'yes_tbd' || (outcome === 'not_now' && detail.frequency) || (outcome === 'no' && detail.frequency && out.price_cents)) {
    if (!FREQUENCIES.includes(detail.frequency as Frequency)) return 'Pick how often'
    out.frequency = detail.frequency!
  }
  if (outcome === 'booked') {
    if (!validDay(detail.first_visit_on)) return 'Pick the first visit date'
    out.first_visit_on = detail.first_visit_on
  }
  if (outcome === 'not_now' || (outcome === 'yes_tbd' && detail.check_back_on)) {
    if (!validDay(detail.check_back_on)) return 'Pick a check-back date'
    out.check_back_on = detail.check_back_on
  }
  if (outcome === 'not_now') {
    if (!isQuotedReason(detail.reason)) return 'Pick a reason'
    out.reason = detail.reason
  }
  if (outcome === 'no') {
    if (!isClosedReason(detail.reason)) return 'Pick a reason'
    out.reason = detail.reason
  }
  const note = typeof detail.note === 'string' ? detail.note.trim() : ''
  if (note.length > 2000) return 'Note is too long'
  if (note) out.note = note
  return out
}

/**
 * A lead that phoned or texted in, typed in by staff. Saved straight to the lead table: no intake
 * event, so no staff alert calls or texts, and nothing is sent to the customer.
 */
export async function addStaffLead(form: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireStaff('/admin/leads')
  const text = (key: string, max: number) => String(form.get(key) ?? '').trim().slice(0, max)
  const name = text('name', 150), phone = text('phone', 30), email = text('email', 254), address = text('address', 500), notes = text('notes', 2000)
  const frequency = text('frequency', 20)
  if (!/^[\d\s()+.-]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 10) return { ok: false, error: 'Enter a 10-digit phone number' }
  if (!address) return { ok: false, error: 'Enter the property address' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email or leave it blank' }
  if (frequency && !(FREQUENCIES as readonly string[]).includes(frequency)) return { ok: false, error: 'Pick a frequency' }
  const db = adminDb()
  const { data, error } = await db.from('leads').insert({ name: name || null, phone, email: email || null, address, source: 'staff',
    services: ['mowing'], frequency: frequency || null, answers: notes ? { notes } : {} }).select('id').single()
  if (error || !data) return { ok: false, error: 'Could not save the lead' }
  await db.from('lead_activities').insert({ lead_id: data.id, kind: 'note', outcome: 'staff_added', actor_email: user.email,
    body: 'Added by staff (phoned or texted in).' })
  revalidatePath('/admin/leads')
  return { ok: true, id: data.id }
}
