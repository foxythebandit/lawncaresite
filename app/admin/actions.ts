'use server'

import { createClient } from '@supabase/supabase-js'
import { createClient as sessionClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/staff'
import { isStaff, staffReturnTo } from '@/lib/staff-policy'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'
import Stripe from 'stripe'
import { addInterval, centsAmount, commandError, jobPrice, moneyCents, type ActionResult, type JobLine } from '@/lib/crm-jobs'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function h(s: string | null | undefined) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatTimeLabel(t: string) {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t // "Morning" / "Afternoon" — pass through as-is
  const [hr, m] = t.split(':').map(Number)
  return `${hr % 12 || 12}:${String(m).padStart(2, '0')} ${hr >= 12 ? 'PM' : 'AM'}`
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

export async function login(_: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!(process.env.STAFF_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).includes(email)) {
    return { error: 'Staff sign-in unavailable or credentials invalid.' }
  }
  const client = await sessionClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !isStaff(data.user)) {
    await client.auth.signOut()
    return { error: 'Staff sign-in unavailable or credentials invalid.' }
  }
  redirect(staffReturnTo(formData.get('next')))
}

export async function logout() {
  const client = await sessionClient()
  await client.auth.signOut()
  redirect('/admin/login')
}

export async function updateNotes(id: string, notes: string) {
  await requireStaff()
  if (!UUID_RE.test(id)) return
  await getAdmin().from('bookings').update({ notes: notes.slice(0, 2000) }).eq('id', id)
  revalidatePath('/admin')
}

export async function deleteBooking(id: string): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(id)) return { success: false, error: 'Invalid job.' }
  const db = getAdmin()
  const { data: booking, error: readError } = await db.from('bookings')
    .select('updated_at,status').eq('id', id).single()
  if (readError || !booking) return { success: false, error: 'Job not found.' }
  if (booking.status === 'completed') return { success: false, error: 'Completed work stays in history.' }
  const { error } = await db.rpc('crm_job_command', {
    p_booking_id: id, p_expected_updated_at: booking.updated_at,
    p_operation_id: crypto.randomUUID(), p_action: 'cancel', p_payload: {},
  })
  if (error) return { success: false, error: commandError(error) }
  revalidatePath('/admin')
  revalidatePath('/admin/revenue')
  revalidatePath('/admin/week')
  revalidatePath('/admin/route')
  return { success: true }
}

// Lets a booking's point-of-contact be swapped out (e.g. a renter at the
// same address/contract hands off to a new tenant) without touching the
// address, price, or frequency. Changing the phone deliberately splits the
// booking off from the old tenant's history — the old tenant's past visits
// stay under their number, future ones follow the new contact.
export async function updateContactDetails(id: string, data: { name: string; phone: string; email: string }) {
  await requireStaff()
  if (!UUID_RE.test(id)) return { success: false, error: 'Invalid booking.' }
  const name  = data.name.trim()
  const phone = data.phone.trim()
  const email = data.email.trim()
  if (!name) return { success: false, error: 'Name is required.' }
  if (!phone) return { success: false, error: 'Phone is required.' }
  if (email && !EMAIL_RE.test(email)) return { success: false, error: 'Enter a valid email address.' }
  await getAdmin().from('bookings').update({ name, phone, email: email || null }).eq('id', id)
  revalidatePath('/admin')
  revalidatePath('/admin/revenue')
  revalidatePath('/admin/week')
  revalidatePath('/admin/route')
  return { success: true }
}

export async function sendReminderEmail(id: string): Promise<{ success: boolean; error?: string }> {
  await requireStaff()
  if (!UUID_RE.test(id)) return { success: false, error: 'Invalid booking.' }
  const db = getAdmin()
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).single()
  if (!booking) return { success: false, error: 'Booking not found.' }
  if (!booking.email) return { success: false, error: 'No email on file for this client.' }
  if (!booking.confirmed_date) return { success: false, error: 'No confirmed date to remind about.' }
  if (!process.env.RESEND_API_KEY) return { success: false, error: 'Email not configured.' }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const firstName = booking.name.split(' ')[0]
  const scheduledDate = new Date(booking.confirmed_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const scheduledTime = booking.confirmed_time

  const { error } = await resend.emails.send({
    from: 'QuietGreen <hello@quietgreen.co>',
    to: booking.email,
    subject: `Reminder: your QuietGreen visit is ${scheduledDate}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111c17">
        <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0">
          <p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">Upcoming Visit</p>
          <h1 style="color:#fff;font-size:22px;margin:0">See you soon, ${h(firstName)}.</h1>
        </div>
        <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
          <p style="font-size:15px;line-height:1.6;color:#4a5e54;margin:0 0 20px">
            Just a heads up — your QuietGreen visit is coming up.
          </p>
          <div style="background:#fff;border:1px solid #b7e4c7;border-radius:10px;padding:14px 18px;margin-bottom:20px">
            <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#4a5e54">Scheduled for</p>
            <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#1a3a2a">${h(scheduledDate)}${scheduledTime ? ` · ${h(formatTimeLabel(scheduledTime))}` : ''}</p>
          </div>
          <div style="background:#fff;border:1px solid #e0ede6;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#4a5e54">
            <p style="margin:0">${h(booking.address)}</p>
          </div>
          <p style="font-size:13px;color:#4a5e54;margin:0">Questions or need to reschedule? Just reply to this email.</p>
        </div>
      </div>
    `,
  })

  if (error) return { success: false, error: 'Failed to send reminder email.' }

  await db.from('bookings').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/admin')
  revalidatePath('/admin/week')
  revalidatePath('/admin/route')

  return { success: true }
}

export async function markComplete(
  id: string,
  data: { completed_at: string; expected_updated_at: string; operation_id: string }
): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(id) || !UUID_RE.test(data.operation_id) || !/^\d{4}-\d{2}-\d{2}$/.test(data.completed_at)) {
    return { success: false, error: 'Choose a valid completion date.' }
  }
  const db = getAdmin()
  const { data: result, error } = await db.rpc('complete_job', {
    p_booking_id: id, p_expected_updated_at: data.expected_updated_at,
    p_operation_id: data.operation_id, p_completed_on: data.completed_at,
  })
  if (error) return { success: false, error: commandError(error) }

  revalidatePath('/admin')
  revalidatePath('/admin/revenue')
  revalidatePath('/admin/week')
  revalidatePath('/admin/route')
  return { success: true, data: result as Record<string, unknown> }
}

export async function getBookings() {
  await requireStaff()
  const { data } = await getAdmin()
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}

function refreshJobs() {
  for (const path of ['/admin', '/admin/week', '/admin/route', '/admin/revenue', '/admin/customers']) {
    revalidatePath(path)
  }
}

function cleanJobLines(lines: JobLine[]): JobLine[] {
  if (!lines.length) throw new Error('Add at least one priced service.')
  return lines.map(item => {
    if (!['service', 'discount'].includes(item.kind) || !item.description.trim()) {
      throw new Error('Each item needs a description and type.')
    }
    if (item.kind === 'service' && item.amount.startsWith('-')) {
      throw new Error('Service prices cannot be negative.')
    }
    return { kind: item.kind, description: item.description.trim(),
      amount: `${item.kind === 'discount' ? '-' : ''}${centsAmount(moneyCents(item.amount.replace(/^-/, '')))}` }
  })
}

export async function linkJobIdentity(input: {
  bookingId: string; expectedUpdatedAt: string; operationId: string
  customerId?: string | null; propertyId?: string | null
  customer?: { name: string; phone?: string; email?: string } | null
  property?: { address: string } | null
}): Promise<ActionResult> {
  await requireStaff()
  if (![input.bookingId, input.operationId, input.customerId, input.propertyId]
    .filter(Boolean).every(v => UUID_RE.test(v!))) return { success: false, error: 'Invalid customer or job.' }
  const { data, error } = await getAdmin().rpc('crm_link_job', {
    p_booking_id: input.bookingId, p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: input.operationId, p_customer_id: input.customerId || null,
    p_property_id: input.propertyId || null,
    p_customer: input.customer || null, p_property: input.property || null,
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  return { success: true, data: data as Record<string, unknown> }
}

export async function saveJobItems(input: {
  bookingId: string; expectedUpdatedAt: string; operationId: string; items: JobLine[]
}): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(input.bookingId) || !UUID_RE.test(input.operationId) || !input.items.length) {
    return { success: false, error: 'Add at least one priced service.' }
  }
  let items: JobLine[]
  try {
    items = cleanJobLines(input.items)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid price.' }
  }
  const { data, error } = await getAdmin().rpc('crm_replace_job_items', {
    p_booking_id: input.bookingId, p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: input.operationId, p_items: items,
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  return { success: true, data: data as Record<string, unknown> }
}

export async function recordManualPayment(input: {
  bookingId: string; operationId: string; amount: string; paidOn: string; method: string
}): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(input.bookingId) || !UUID_RE.test(input.operationId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) || !input.method.trim()) {
    return { success: false, error: 'Enter a payment amount, date, and method.' }
  }
  let amount: string
  try {
    const cents = moneyCents(input.amount)
    if (cents <= 0) throw new Error('Payment must be greater than zero.')
    amount = centsAmount(cents)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid amount.' }
  }
  const { data, error } = await getAdmin().rpc('record_job_payment', {
    p_booking_id: input.bookingId, p_operation_id: input.operationId,
    p_amount: amount, p_paid_on: input.paidOn, p_method: input.method.trim(),
    p_provenance: 'manual',
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  return { success: true, data: { payment_id: data } }
}

export async function startJobAgreement(input: {
  bookingId: string; expectedUpdatedAt: string; operationId: string
  anchorOn: string; nextOn: string; endOn?: string | null
  intervalUnit: 'week' | 'month'; intervalCount: number; itemsTemplate: JobLine[]
}): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(input.bookingId) || !UUID_RE.test(input.operationId)) {
    return { success: false, error: 'Invalid job.' }
  }
  let template: JobLine[]
  try { template = cleanJobLines(input.itemsTemplate) }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Invalid price.' } }
  const { data, error } = await getAdmin().rpc('crm_start_agreement', {
    p_booking_id: input.bookingId, p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: input.operationId,
    p_config: { anchor_on: input.anchorOn, next_on: input.nextOn,
      end_on: input.endOn || null, interval_unit: input.intervalUnit,
      interval_count: input.intervalCount, items_template: template },
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  return { success: true, data: data as Record<string, unknown> }
}

function revalidateCustomer(customerId: string) {
  refreshJobs()
  revalidatePath(`/admin/customers/${customerId}`)
}

/** New one-off job for an existing customer (upsells, extra work). Price is staff-entered and saved with the job. */
export async function addCustomerJob(input: {
  operationId: string; customerId: string; propertyId: string | null; newAddress: string | null
  date: string; notes: string; items: JobLine[]
}): Promise<ActionResult> {
  await requireStaff(`/admin/customers/${input.customerId}`)
  if (![input.operationId, input.customerId].every(v => UUID_RE.test(v)) || (input.propertyId && !UUID_RE.test(input.propertyId))) {
    return { success: false, error: 'Refresh this customer and try again.' }
  }
  if (!input.propertyId && !input.newAddress?.trim()) return { success: false, error: 'Choose a property or enter an address.' }
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { success: false, error: 'Choose a valid visit date.' }
  let items: JobLine[]
  try { items = cleanJobLines(input.items.filter(item => item.description.trim() || Number(item.amount))) }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Invalid price.' } }
  const { data, error } = await getAdmin().rpc('crm_create_customer_job', {
    p_operation_id: input.operationId, p_customer_id: input.customerId, p_property_id: input.propertyId,
    p_property: input.propertyId ? null : { address: input.newAddress!.trim() },
    p_job: { preferred_date: input.date || null, notes: input.notes.slice(0, 2000), one_time: true }, p_items: items,
  })
  if (error) return { success: false, error: commandError(error) }
  revalidateCustomer(input.customerId)
  return { success: true, data: data as Record<string, unknown> }
}

/** Start a mowing plan for an existing customer: creates the first visit, then the recurring plan from it. */
export async function startCustomerPlan(input: {
  jobOperationId: string; planOperationId: string; customerId: string; propertyId: string | null; newAddress: string | null
  firstDate: string; intervalUnit: 'week' | 'month'; intervalCount: number; pricePerVisit: string
}): Promise<ActionResult> {
  await requireStaff(`/admin/customers/${input.customerId}`)
  if (![input.jobOperationId, input.planOperationId, input.customerId].every(v => UUID_RE.test(v)) || (input.propertyId && !UUID_RE.test(input.propertyId))) {
    return { success: false, error: 'Refresh this customer and try again.' }
  }
  if (!input.propertyId && !input.newAddress?.trim()) return { success: false, error: 'Choose a property or enter an address.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.firstDate)) return { success: false, error: 'Choose the first visit date.' }
  if (!['week', 'month'].includes(input.intervalUnit) || !Number.isInteger(input.intervalCount) || input.intervalCount < 1 || input.intervalCount > 52) {
    return { success: false, error: 'Choose how often to visit.' }
  }
  let items: JobLine[]
  try { items = cleanJobLines([{ kind: 'service', description: 'Lawn care', amount: input.pricePerVisit }]) }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Invalid price.' } }
  if (moneyCents(items[0].amount) <= 0) return { success: false, error: 'Enter the price per visit.' }
  const label = input.intervalUnit === 'week'
    ? (input.intervalCount === 1 ? 'Weekly' : input.intervalCount === 2 ? 'Bi-weekly' : `Every ${input.intervalCount} weeks`)
    : (input.intervalCount === 1 ? 'Monthly' : `Every ${input.intervalCount} months`)
  const db = getAdmin()
  const created = await db.rpc('crm_create_customer_job', {
    p_operation_id: input.jobOperationId, p_customer_id: input.customerId, p_property_id: input.propertyId,
    p_property: input.propertyId ? null : { address: input.newAddress!.trim() },
    p_job: { preferred_date: input.firstDate, notes: '', one_time: false, frequency: label }, p_items: items,
  })
  if (created.error) return { success: false, error: commandError(created.error) }
  const bookingId = (created.data as { booking_id: string }).booking_id
  const { data: job } = await db.from('bookings').select('updated_at').eq('id', bookingId).single()
  const { data, error } = await db.rpc('crm_start_agreement', {
    p_booking_id: bookingId, p_expected_updated_at: job?.updated_at, p_operation_id: input.planOperationId,
    p_config: { anchor_on: input.firstDate, next_on: addInterval(input.firstDate, input.intervalUnit, input.intervalCount),
      end_on: null, interval_unit: input.intervalUnit, interval_count: input.intervalCount, items_template: items },
  })
  if (error) return { success: false, error: commandError(error) }
  revalidateCustomer(input.customerId)
  return { success: true, data: { ...(data as Record<string, unknown>), booking_id: bookingId } }
}

/** Quote outcome: a lead's booked visit (its latest quote booking) canceled before it happens counts as a canceled quote. */
async function cancelQuoteForFirstVisit(bookingId: string): Promise<{ success: true } | { success: false; error: string }> {
  const db = getAdmin()
  const { data: job, error: jobError } = await db.from('bookings').select('id,lead_id,agreement_id').eq('id', bookingId).single()
  if (jobError) return { success: false, error: 'Visit canceled, but the quote outcome could not be checked. Retry this cancellation.' }
  if (!job?.lead_id || job.agreement_id) return { success: true }
  const { data: jobs, error: jobsError } = await db.from('bookings').select('id,created_at,accepted_quote_snapshot,creation_operation_id').eq('lead_id', job.lead_id)
  if (jobsError) return { success: false, error: 'Visit canceled, but the quote outcome could not be checked. Retry this cancellation.' }
  if (latestQuoteBooking(jobs ?? [])?.id !== job.id) return { success: true }
  const { data: lead, error: leadError } = await db.from('leads').select('updated_at,quote_status').eq('id', job.lead_id).single()
  if (leadError || !lead) return { success: false, error: 'Visit canceled, but the quote outcome could not be loaded. Retry this cancellation.' }
  if (lead.quote_status !== 'accepted') return { success: true }
  const user = await requireStaff()
  const { error } = await db.rpc('update_lead_workflow', {
    p_lead_id: job.lead_id, p_expected_updated_at: lead.updated_at, p_patch: { quote_status: 'canceled', stage: 'lost' },
    p_activity: { kind: 'quote', outcome: 'canceled', body: 'Customer canceled the booked first visit.' }, p_actor_email: user.email,
  })
  if (error) return { success: false, error: `Visit canceled, but the quote outcome was not saved: ${commandError(error)}. Retry this cancellation.` }
  revalidatePath(`/admin/leads/${job.lead_id}`)
  revalidatePath('/admin/leads')
  return { success: true }
}

export async function changeJob(input: {
  bookingId: string; expectedUpdatedAt: string; operationId: string
  action: 'confirm' | 'reschedule' | 'skip' | 'cancel' | 'mark_one_time'
  date?: string; time?: string
}): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(input.bookingId) || !UUID_RE.test(input.operationId)) {
    return { success: false, error: 'Invalid job.' }
  }
  const { data, error } = await getAdmin().rpc('crm_job_command', {
    p_booking_id: input.bookingId, p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: input.operationId, p_action: input.action,
    p_payload: input.action === 'confirm' || input.action === 'reschedule'
      ? { date: input.date, time: input.time || null } : {},
  })
  if (error) return { success: false, error: commandError(error) }
  if (input.action === 'cancel') {
    const outcome = await cancelQuoteForFirstVisit(input.bookingId)
    if (!outcome.success) { refreshJobs(); return outcome }
  }
  refreshJobs()
  return { success: true, data: data as Record<string, unknown> }
}

export async function scheduleJobAndEmail(input: {
  bookingId: string; expectedUpdatedAt: string; operationId: string
  action: 'confirm' | 'reschedule'; date: string; time?: string
}): Promise<ActionResult> {
  const result = await changeJob(input)
  if (!result.success) return result
  if (result.data?.duplicate) {
    return { success: true, data: { warning: 'Visit was already saved. Check the customer email before sending again.' } }
  }
  const { data: booking } = await getAdmin().from('bookings')
    .select('name,email,address,job_total,first_visit_price,price_per_visit').eq('id', input.bookingId).single()
  if (!booking?.email || !process.env.RESEND_API_KEY) return result
  const when = new Date(input.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const email = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'QuietGreen <hello@quietgreen.co>', to: booking.email,
    subject: input.action === 'confirm' ? 'Your QuietGreen visit is confirmed' : 'Your QuietGreen visit has a new date',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;color:#1a3a2a"><h1>QuietGreen visit</h1><p>Hi ${h(booking.name.split(' ')[0])}, your visit is scheduled for <strong>${h(when)}${input.time ? ` · ${h(input.time)}` : ''}</strong>.</p><p>${h(booking.address)}</p><p>Current job total: $${jobPrice(booking).toFixed(2)}. No payment is due until your service is complete.</p><p>Questions? Reply to this email.</p></div>`,
  }).catch(() => ({ error: { message: 'Email delivery failed' } }))
  if (email.error) return { success: true, data: { warning: 'Visit saved, but the confirmation email could not be sent.' } }
  return { success: true, data: { email_sent: true } }
}

export async function changeAgreement(input: {
  agreementId: string; expectedUpdatedAt: string; operationId: string
  action: 'price_template' | 'pause' | 'end' | 'resume'
  futureJobIds?: string[]; nextOn?: string; itemsTemplate?: JobLine[]
}): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(input.agreementId) || !UUID_RE.test(input.operationId)) {
    return { success: false, error: 'Invalid agreement.' }
  }
  let template: JobLine[] | undefined
  if (input.action === 'price_template') {
    try { template = cleanJobLines(input.itemsTemplate ?? []) }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Invalid price.' } }
  }
  const payload = input.action === 'pause' || input.action === 'end'
    ? { future_job_ids: [...(input.futureJobIds ?? [])].sort() }
    : input.action === 'resume' ? { next_on: input.nextOn }
    : { items_template: template }
  const { data, error } = await getAdmin().rpc('crm_agreement_command', {
    p_agreement_id: input.agreementId, p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: input.operationId, p_action: input.action, p_payload: payload,
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  return { success: true, data: data as Record<string, unknown> }
}

export async function getJobPayments() {
  await requireStaff()
  const { data, error } = await getAdmin().from('job_payments').select('*').order('paid_on', { ascending: false })
  if (error) throw new Error(commandError(error))
  return data ?? []
}

export async function getJobItems() {
  await requireStaff()
  const { data, error } = await getAdmin().from('job_items')
    .select('booking_id,kind,description,amount').order('created_at', { ascending: true })
  if (error) throw new Error(commandError(error))
  return data ?? []
}

export async function getCustomers() {
  await requireStaff()
  const db = getAdmin()
  const [customers, properties] = await Promise.all([
    db.from('customers').select('*').order('created_at', { ascending: false }),
    db.from('properties').select('*').order('created_at', { ascending: false }),
  ])
  if (customers.error || properties.error) throw new Error('Could not load customer records.')
  return { customers: customers.data ?? [], properties: properties.data ?? [] }
}

export async function getAgreements() {
  await requireStaff()
  const { data, error } = await getAdmin().from('recurring_agreements').select('*')
  if (error) throw new Error(commandError(error))
  return data ?? []
}

export async function getLeads() {
  await requireStaff()
  const { data } = await getAdmin()
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function deleteLead(id: string) {
  await requireStaff()
  return { error: UUID_RE.test(id) ? 'Inquiry history is retained. Mark it lost in the lead workspace.' : 'Invalid lead.' }
}

export async function createPaymentLink(
  bookingId: string,
  _amountDollars: number,
  _customerName: string,
  _address: string,
): Promise<{ url: string } | { error: string }> {
  await requireStaff()
  if (!UUID_RE.test(bookingId)) return { error: 'Invalid booking ID' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Stripe not configured' }
  const db = getAdmin()
  const { data: booking, error: readError } = await db.from('bookings')
    .select('id,name,address,job_total,first_visit_price,price_per_visit,status,updated_at').eq('id', bookingId).single()
  if (readError || !booking) return { error: 'Job not found.' }
  if (!['confirmed','completed'].includes(booking.status)) return { error: 'Confirm the visit first.' }
  const amountCents = moneyCents(jobPrice(booking).toFixed(2))
  if (amountCents <= 0) return { error: 'Set a positive job total first.' }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: amountCents,
      product_data: {
        name: `QuietGreen service — ${booking.address}`,
      },
    })

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: bookingId, customer_name: booking.name },
    })

    const { data: saved, error: saveError } = await db.from('bookings')
      .update({ payment_link: link.url }).eq('id', bookingId)
      .eq('updated_at', booking.updated_at).select('id').maybeSingle()
    if (saveError || !saved) return { error: 'Job changed while creating the link. Refresh and review its current total.' }

    return { url: link.url }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return { error: msg }
  }
}

// ── Extra charges: one-off work billed outside a booking (bed cleanups, trims…) ──

export type ExtraCharge = {
  id: string
  charged_on: string
  client_name: string
  phone: string | null
  description: string
  amount: number
  payment_method: string | null
}

export async function getExtraCharges(): Promise<ExtraCharge[]> {
  await requireStaff()
  const { data } = await getAdmin()
    .from('extra_charges')
    .select('id, charged_on, client_name, phone, description, amount, payment_method')
    .order('charged_on', { ascending: false })
  return (data ?? []).map(c => ({ ...c, amount: Number(c.amount) }))
}

function cleanCharge(data: { charged_on: string; client_name: string; phone?: string | null; description: string; amount: number; payment_method?: string | null }) {
  const client_name = data.client_name.trim().slice(0, 120)
  const description = data.description.trim().slice(0, 300)
  if (!client_name || !description) return null
  if (!Number.isFinite(data.amount) || data.amount < 0) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.charged_on)) return null
  return {
    charged_on: data.charged_on,
    client_name,
    phone: data.phone?.trim() || null,
    description,
    amount: Math.round(data.amount * 100) / 100,
    payment_method: data.payment_method?.trim() || null,
  }
}

export async function addExtraCharge(data: { charged_on: string; client_name: string; phone?: string | null; description: string; amount: number; payment_method?: string | null }) {
  await requireStaff()
  const row = cleanCharge(data)
  if (!row) return { error: 'Client, description, date and amount are required.' }
  const { error } = await getAdmin().from('extra_charges').insert(row)
  if (error) return { error: error.message }
  revalidatePath('/admin/revenue')
  return { success: true }
}

export async function updateExtraCharge(id: string, data: { charged_on: string; client_name: string; phone?: string | null; description: string; amount: number; payment_method?: string | null }) {
  await requireStaff()
  if (!UUID_RE.test(id)) return
  const row = cleanCharge(data)
  if (!row) return
  await getAdmin().from('extra_charges').update(row).eq('id', id)
  revalidatePath('/admin/revenue')
}
