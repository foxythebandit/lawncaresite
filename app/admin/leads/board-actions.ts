'use server'
import { createHash } from 'node:crypto'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { isCallOutcome, isClosedReason, isColumn, isQuotedReason, FREQUENCIES, type BoardColumn, type CallOutcome, type Frequency } from '@/lib/lead-board'
import { notifyCallLogged } from '@/lib/phone/notify'
import { addInterval, callVisitItems } from '@/lib/crm-jobs'
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
export async function logCall(leadId: string, operationId: string, outcome: string, detail: CallDetail): Promise<BoardResult & { activityId?: string; warning?: string }> {
  const user = await requireStaff(`/admin/leads/${leadId}`)
  if (!UUID.test(leadId) || !UUID.test(operationId) || !isCallOutcome(outcome)) return { ok: false, error: 'Refresh and try again' }
  const clean = cleanDetail(outcome, detail)
  if (typeof clean === 'string') return { ok: false, error: clean }
  const { data, error } = await adminDb().rpc('crm_log_call', {
    p_lead_id: leadId, p_operation_id: operationId, p_outcome: outcome, p_detail: clean, p_actor_email: user.email,
  })
  if (error) {
    return { ok: false, error: error.code === '23514' ? 'Missing details' : error.code === '23505' ? 'Already saved differently · refresh' : error.code === 'P0002' ? 'Lead not found' : 'Not saved' }
  }
  const result = data as { board_column: BoardColumn; activity_id: string; duplicate: boolean }
  // Every step is idempotent, so a retry of the same Log call resumes scheduling where it stopped.
  const warning = outcome === 'booked' ? await scheduleCallVisit(leadId, operationId, clean) : null
  // The other person's text must never hold up or fail the save (notify contract: never throws).
  if (!result.duplicate && user.email) after(() => notifyCallLogged(leadId, result.activity_id, user.email!).catch(() => {}))
  refresh(leadId)
  return { ok: true, column: result.board_column, activityId: result.activity_id, ...(warning ? { warning } : {}) }
}

/** Stable sub-operation IDs derived from the Log call operation. */
function subOperation(operationId: string, step: string) {
  const hex = createHash('sha256').update(`${operationId}:${step}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const PLAN_INTERVALS: Partial<Record<Frequency, { unit: 'week' | 'month'; count: number }>> = {
  weekly: { unit: 'week', count: 1 }, biweekly: { unit: 'week', count: 2 }, monthly: { unit: 'month', count: 1 },
}

/**
 * Booked by phone: confirmed first visit on Jobs at the phone price, linked to a new customer and,
 * for recurring mowing, a plan. A same-phone customer is never linked automatically (staff confirm
 * from the job). Returns a short warning when a step needs staff, or null.
 */
async function scheduleCallVisit(leadId: string, operationId: string, detail: Record<string, string | number>): Promise<string | null> {
  const db = adminDb()
  const cents = Number(detail.price_cents), freq = detail.frequency as Frequency, date = String(detail.first_visit_on)
  const { data: lead } = await db.from('leads').select('name,phone,email,services').eq('id', leadId).single()
  if (!lead) return 'Call saved · visit not scheduled'
  const description = freq === 'onetime' ? serviceLabels(lead.services).join(', ').slice(0, 100) || 'Service' : 'Lawn care'
  // The first visit is charged 30% off (plan price + discount line); later plan visits use `plan`.
  const { items, plan, firstVisitPrice } = callVisitItems(cents, freq, description)
  const job: Record<string, string | number> = { first_visit_on: date, frequency: freq, price_per_visit: cents / 100 }
  if (firstVisitPrice != null) job.first_visit_price = firstVisitPrice
  const { data: created, error } = await db.rpc('crm_create_call_job', {
    p_lead_id: leadId, p_operation_id: subOperation(operationId, 'job'), p_job: job, p_items: items,
  })
  if (error) return 'Call saved · visit not scheduled'
  revalidatePath('/admin/jobs')
  const bookingId = (created as { booking_id: string }).booking_id
  const { data: visit } = await db.from('bookings').select('updated_at,customer_id,property_id,address,agreement_id').eq('id', bookingId).single()
  if (!visit) return 'Visit scheduled · refresh to link the customer'
  if (!visit.customer_id) {
    if (!visit.address?.trim()) return 'Visit scheduled · add an address, then link the customer'
    const digits = String(lead.phone ?? '').replace(/\D/g, '').slice(-10)
    const { data: customers } = await db.from('customers').select('phone')
    if (digits.length === 10 && customers?.some(c => String(c.phone ?? '').replace(/\D/g, '').slice(-10) === digits)) {
      return 'Visit scheduled · same phone as a customer, link from the job'
    }
    const { error: linkError } = await db.rpc('crm_link_job', {
      p_booking_id: bookingId, p_expected_updated_at: visit.updated_at, p_operation_id: subOperation(operationId, 'link'),
      p_customer_id: null, p_property_id: null,
      p_customer: { name: lead.name?.trim() || lead.phone, phone: lead.phone, email: lead.email ?? '' }, p_property: { address: visit.address },
    })
    if (linkError) return 'Visit scheduled · customer not linked'
    revalidatePath('/admin/customers')
  }
  const interval = PLAN_INTERVALS[freq]
  if (interval && !visit.agreement_id) {
    const { data: current } = await db.from('bookings').select('updated_at').eq('id', bookingId).single()
    const { error: planError } = await db.rpc('crm_start_agreement', {
      p_booking_id: bookingId, p_expected_updated_at: current?.updated_at, p_operation_id: subOperation(operationId, 'plan'),
      p_config: { anchor_on: date, next_on: addInterval(date, interval.unit, interval.count), end_on: null,
        interval_unit: interval.unit, interval_count: interval.count, items_template: plan },
    })
    if (planError) return 'Visit scheduled · start the plan from the customer page'
  }
  return null
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
