'use server'

import { createClient } from '@supabase/supabase-js'
import { createClient as sessionClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/staff'
import { calendarDate } from '@/lib/calendar-view'
import { isStaff, staffReturnTo } from '@/lib/staff-policy'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sendEmail } from '@/lib/email'
import Stripe from 'stripe'
import { providerRetryExpired, saveVisitPaymentLink, type PreparedVisit } from '@/lib/visit-payment-link'
import { centsAmount, commandError, jobPrice, moneyCents, type ActionResult, type JobLine } from '@/lib/crm-jobs'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import type { Database, Json } from '@/supabase/database.types'

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

export async function updateNotes(input: {
  bookingId: string; expectedUpdatedAt: string; operationId: string; note: string
}): Promise<ActionResult> {
  await requireStaff()
  if (![input.bookingId, input.operationId].every(id => UUID_RE.test(id)) || input.note.length > 2000) {
    return { success: false, error: 'Enter a note of up to 2,000 characters.' }
  }
  const { data, error } = await getAdmin().rpc('crm_calendar_save_note', {
    p_booking_id: input.bookingId, p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: input.operationId, p_note: input.note,
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  return { success: true, data: data as Record<string, unknown> }
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
  revalidatePath('/admin/jobs')
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
export async function updateContactDetails(id: string, data: { name: string; phone: string; email: string; expectedUpdatedAt: string }): Promise<ActionResult> {
  await requireStaff()
  if (!UUID_RE.test(id)) return { success: false, error: 'Invalid booking.' }
  const name  = data.name.trim()
  const phone = data.phone.trim()
  const email = data.email.trim()
  if (!name) return { success: false, error: 'Name is required.' }
  if (!phone) return { success: false, error: 'Phone is required.' }
  if (email && !EMAIL_RE.test(email)) return { success: false, error: 'Enter a valid email address.' }
  const { data: saved, error } = await getAdmin().from('bookings').update({ name, phone, email: email || null }).eq('id', id)
    .eq('updated_at', data.expectedUpdatedAt).select('id').maybeSingle()
  if (error) return { success: false, error: commandError(error) }
  if (!saved) return { success: false, error: 'Visit changed since it was opened. Reload and try again.' }
  revalidatePath('/admin/jobs')
  revalidatePath('/admin/revenue')
  revalidatePath('/admin/week')
  revalidatePath('/admin/route')
  return { success: true }
}

export async function sendReminderEmail(id: string): Promise<{ success: boolean; error?: string }> {
  await requireStaff()
  return emailReminder(id)
}

async function emailReminder(id: string, prepared?: PreparedVisit): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(id)) return { success: false, error: 'Invalid booking.' }
  const db = getAdmin()
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).single()
  if (!booking) return { success: false, error: 'Booking not found.' }
  if (!booking.email) return { success: false, error: 'No email on file for this client.' }
  if (!booking.confirmed_date) return { success: false, error: 'No confirmed date to remind about.' }
  if (!process.env.RESEND_API_KEY) return { success: false, error: 'Email not configured.' }

  if (prepared) {
    if (booking.last_reminder_sent_at && Date.parse(booking.last_reminder_sent_at) >= Date.parse(prepared.preparedAt)) return { success: true }
    if (booking.updated_at !== prepared.updatedAt || providerRetryExpired(prepared)) {
      return { success: false, error: 'Reopen the saved visit and review its date before sending a reminder.' }
    }
  }

  const firstName = booking.name.split(' ')[0]
  const scheduledDate = new Date(booking.confirmed_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const scheduledTime = booking.confirmed_time

  const { error } = await sendEmail({
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
  }, prepared ? { idempotencyKey: `visit-reminder/${prepared.operationId}` } : undefined)

  if (error) return { success: false, error: 'Failed to send reminder email.' }

  await db.from('bookings').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/admin/jobs')
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

  revalidatePath('/admin/jobs')
  revalidatePath('/admin/revenue')
  revalidatePath('/admin/week')
  revalidatePath('/admin/route')
  return { success: true, data: result as Record<string, unknown> }
}

export async function getBookings() {
  await requireStaff()
  const db = getAdmin()
  const bookings: Database['public']['Tables']['bookings']['Row'][] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('bookings').select('*')
      .order('created_at', { ascending: false }).order('id')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error('Could not load visits.')
    bookings.push(...data)
    if (data.length < pageSize) return bookings
  }
}

function refreshJobs() {
  for (const path of ['/admin/jobs', '/admin/week', '/admin/route', '/admin/revenue', '/admin/customers']) {
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

export async function confirmFirstVisit(input: {
  bookingId: string; expectedUpdatedAt: string; leadVersion: string | null; operationId: string
  date: string; time: string; email: boolean; customerId: string | null; propertyId: string | null
  name: string; address: string; labelId: string | null; frequency: string; reviewedTerms: boolean
}): Promise<ActionResult> {
  const staff = await requireStaff()
  if (![input.bookingId, input.operationId].every(id => UUID_RE.test(id))
    || [input.customerId, input.propertyId, input.labelId].some(id => id !== null && !UUID_RE.test(id))
    || !calendarDate(input.date) || input.time.length > 80 || input.name.length > 150 || input.address.length > 500) {
    return { success: false, error: 'Review the customer, property, and visit date.' }
  }
  const { data, error } = await getAdmin().rpc('crm_confirm_first_visit', {
    p_booking_id: input.bookingId, p_expected_updated_at: input.expectedUpdatedAt,
    p_lead_version: input.leadVersion, p_operation_id: input.operationId,
    p_request: { date: input.date, arrival: input.time, customer_id: input.customerId, property_id: input.propertyId,
      name: input.name, address: input.address, label_id: input.labelId, frequency: input.frequency,
      reviewed_terms: input.reviewedTerms, staff_user_id: staff.id },
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  revalidatePath('/admin/leads')
  revalidatePath('/admin/customers')
  const result: ActionResult = { success: true, data: data as Record<string, unknown> }
  if (input.email && !result.data?.duplicate) {
    return emailVisitDate(input.bookingId, 'confirm', input.date, input.time, result)
  }
  return result
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
  return emailVisitDate(input.bookingId, input.action, input.date, input.time, result)
}

export type ProjectedVisitEdit =
  | { action: 'reschedule'; date: string; time?: string; email?: boolean }
  | { action: 'complete'; date: string }
  | { action: 'notes'; note: string }
  | { action: 'items'; items: JobLine[] }
  | { action: 'payment'; amount: string; date: string; method: string }
  | { action: 'contact'; name: string; phone: string; email: string }
  | { action: 'skip' | 'cancel' | 'payment_link' | 'reminder' }

export async function editProjectedVisit(input: ProjectedVisitEdit & {
  agreementId: string; revisionId: string; on: string; operationId: string
}): Promise<ActionResult> {
  await requireStaff()
  if (![input.agreementId, input.revisionId, input.operationId].every(id => UUID_RE.test(id)) || !calendarDate(input.on)) {
    return { success: false, error: 'Reopen the calendar and choose a visit.' }
  }
  let payload: Json = {}
  try {
    switch (input.action) {
      case 'reschedule':
        if (!calendarDate(input.date) || (input.time?.length ?? 0) > 80) throw new Error('Review the visit date and arrival window.')
        payload = { date: input.date, time: input.time?.trim() || null }
        break
      case 'complete':
        if (!calendarDate(input.date)) throw new Error('Choose a completion date.')
        payload = { date: input.date }
        break
      case 'notes':
        if (input.note.length > 2000) throw new Error('Enter a note of up to 2,000 characters.')
        payload = { note: input.note }
        break
      case 'items':
        payload = { items: cleanJobLines(input.items) }
        break
      case 'payment': {
        const cents = moneyCents(input.amount)
        if (!calendarDate(input.date) || cents <= 0 || !input.method.trim()) throw new Error('Enter a payment amount, date, and method.')
        payload = { date: input.date, amount: centsAmount(cents), method: input.method.trim() }
        break
      }
      case 'contact':
        if (!input.name.trim() || !input.phone.trim()) throw new Error('Enter a name and phone number.')
        if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) throw new Error('Enter a valid email address.')
        payload = { name: input.name.trim(), phone: input.phone.trim(), email: input.email.trim() }
        break
      case 'payment_link':
        if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured.')
        break
      case 'reminder':
        if (!process.env.RESEND_API_KEY) throw new Error('Email not configured.')
        break
      case 'skip':
      case 'cancel':
        break
      default:
        throw new Error('Choose a visit action.')
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Review the visit details.' }
  }
  const { data, error } = await getAdmin().rpc('crm_calendar_edit_occurrence', {
    p_agreement_id: input.agreementId, p_revision_id: input.revisionId, p_on: input.on,
    p_operation_id: input.operationId, p_action: input.action, p_payload: payload,
  })
  if (error) return { success: false, error: commandError(error) }
  const result = { success: true as const, data: data as Record<string, unknown> }
  const id = result.data.booking_id as string
  if (input.action === 'reschedule' && input.email && !result.data.duplicate) {
    refreshJobs()
    const notified = await emailVisitDate(id, 'reschedule', input.date, input.time, result)
    return notified.success ? { ...notified, data: { ...result.data, ...notified.data } } : notified
  }
  if (input.action === 'payment_link' || input.action === 'reminder') {
    const prepared = { operationId: input.operationId, updatedAt: result.data.updated_at as string, preparedAt: result.data.prepared_at as string }
    if (input.action === 'payment_link') {
      const link = await createBookingPaymentLink(id, prepared)
      if ('error' in link) return { success: false, error: `Visit saved. ${link.error}` }
    } else {
      const reminder = await emailReminder(id, prepared)
      if (!reminder.success) return { success: false, error: `Visit saved. ${reminder.error ?? 'Could not send the reminder.'}` }
    }
  }
  refreshJobs()
  return result
}

/** Customer email after a visit date is set; a send failure leaves the saved date as is. */
async function emailVisitDate(bookingId: string, action: 'confirm' | 'reschedule', date: string, time: string | undefined, result: ActionResult): Promise<ActionResult> {
  const { data: booking } = await getAdmin().from('bookings')
    .select('name,email,address,job_total,first_visit_price,price_per_visit').eq('id', bookingId).single()
  if (!booking?.email || !process.env.RESEND_API_KEY) return result
  const when = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const email = await sendEmail({
    from: 'QuietGreen <hello@quietgreen.co>', to: booking.email,
    subject: action === 'confirm' ? 'Your QuietGreen visit is confirmed' : 'Your QuietGreen visit has a new date',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;color:#1a3a2a"><h1>QuietGreen visit</h1><p>Hi ${h(booking.name.split(' ')[0])}, your visit is scheduled for <strong>${h(when)}${time ? ` · ${h(time)}` : ''}</strong>.</p><p>${h(booking.address)}</p><p>Current job total: $${jobPrice(booking).toFixed(2)}. No payment is due until your service is complete.</p><p>Questions? Reply to this email.</p></div>`,
  }).catch(() => ({ error: { message: 'Email delivery failed' } }))
  if (email.error) return { success: true, data: { warning: 'Visit saved, but the confirmation email could not be sent.' } }
  return { success: true, data: { email_sent: true } }
}

/**
 * Log one visit from the customer page: mark it done (scheduling it on that date first if it was
 * still "To schedule") and, when an amount is given, record the payment.
 * Each step has its own operation ID, so a retry after a dropped connection repeats nothing.
 */
export async function finishVisit(input: {
  bookingId: string; confirmOperationId: string; completeOperationId: string; paymentOperationId: string
  completedOn: string; amount: string; method: string
}): Promise<ActionResult> {
  await requireStaff()
  if (![input.bookingId, input.confirmOperationId, input.completeOperationId, input.paymentOperationId].every(v => UUID_RE.test(v))
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.completedOn)) {
    return { success: false, error: 'Choose the date of the visit.' }
  }
  const db = getAdmin()
  let { data: job } = await db.from('bookings').select('status,updated_at,completion_operation_id,lead_id').eq('id', input.bookingId).single()
  if (!job) return { success: false, error: 'Visit not found.' }
  if (job.status === 'pending') {
    if (job.lead_id) return { success: false, error: 'Open the request and confirm the first visit before marking it done.' }
    const scheduled = await changeJob({ bookingId: input.bookingId, expectedUpdatedAt: job.updated_at,
      operationId: input.confirmOperationId, action: 'confirm', date: input.completedOn })
    if (!scheduled.success) return scheduled
    job = (await db.from('bookings').select('status,updated_at,completion_operation_id,lead_id').eq('id', input.bookingId).single()).data
    if (!job) return { success: false, error: 'Visit not found.' }
  }
  let next: unknown = null
  if (job.status !== 'completed' || job.completion_operation_id === input.completeOperationId) {
    const done = await markComplete(input.bookingId, { completed_at: input.completedOn,
      expected_updated_at: job.updated_at, operation_id: input.completeOperationId })
    if (!done.success) return done
    next = done.data?.next_booking_id ?? null
  }
  if (input.amount.trim() && Number(input.amount) > 0) {
    const paid = await recordManualPayment({ bookingId: input.bookingId, operationId: input.paymentOperationId,
      amount: input.amount.trim(), paidOn: input.completedOn, method: input.method })
    if (!paid.success) return { success: false, error: `Visit marked done, but the payment was not saved: ${paid.error}` }
  }
  refreshJobs()
  return { success: true, data: { next_booking_id: next } }
}

export async function reviewPlanMove(input: {
  agreementId: string; date: string; time: string; email: boolean; operationId?: string; preview?: string
} & ({ bookingId: string; version: string } | { revisionId: string; on: string })): Promise<ActionResult> {
  const staff = await requireStaff()
  if (!UUID_RE.test(input.agreementId) || !calendarDate(input.date) || input.time.length > 80
    || (input.operationId && !UUID_RE.test(input.operationId))
    || ('bookingId' in input ? !UUID_RE.test(input.bookingId) : !UUID_RE.test(input.revisionId) || !calendarDate(input.on))) {
    return { success: false, error: 'Review the visit and choose the new date.' }
  }
  const { data, error } = await getAdmin().rpc('crm_review_schedule_shift', {
    p_agreement_id: input.agreementId, p_staff_user_id: staff.id,
    p_request: { date: input.date, time: input.time, email: input.email,
      ...('bookingId' in input ? { booking_id: input.bookingId, version: input.version }
        : { revision_id: input.revisionId, on: input.on }) },
    p_operation_id: input.operationId ?? null, p_preview: input.preview ?? null,
  })
  if (error) return { success: false, error: commandError(error) }
  const result = { success: true as const, data: data as Record<string, unknown> }
  if (!input.operationId) return result
  refreshJobs()
  if (!input.email || result.data.duplicate || typeof result.data.booking_id !== 'string') return result
  const notified = await emailVisitDate(result.data.booking_id, 'reschedule', input.date, input.time, result)
  return notified.success ? { ...notified, data: { ...result.data, ...notified.data } } : notified
}

/** Fold a recurring visit that is not in a plan (booked from a lead) into the customer's plan at that property. */
export async function addVisitToPlan(input: {
  bookingId: string; expectedUpdatedAt: string; operationId: string; agreementId: string
}): Promise<ActionResult> {
  await requireStaff()
  if (![input.bookingId, input.operationId, input.agreementId].every(v => UUID_RE.test(v))) {
    return { success: false, error: 'Refresh and try again.' }
  }
  const { data, error } = await getAdmin().rpc('crm_attach_to_agreement', {
    p_booking_id: input.bookingId, p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: input.operationId, p_agreement_id: input.agreementId,
  })
  if (error) return { success: false, error: commandError(error) }
  refreshJobs()
  return { success: true, data: data as Record<string, unknown> }
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
  const db = getAdmin()
  const items: Pick<Database['public']['Tables']['job_items']['Row'], 'booking_id' | 'kind' | 'description' | 'amount'>[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('job_items').select('booking_id,kind,description,amount')
      .order('created_at').order('id').range(offset, offset + pageSize - 1)
    if (error) throw new Error(commandError(error))
    items.push(...data)
    if (data.length < pageSize) return items
  }
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

export async function getAgreements(customerId?: string) {
  await requireStaff()
  const query = getAdmin().from('recurring_agreements').select('*,service_labels(id,name,semantic_key,retired_at)')
  const { data, error } = await (customerId ? query.eq('customer_id', customerId) : query)
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
  return createBookingPaymentLink(bookingId)
}

async function createBookingPaymentLink(bookingId: string, prepared?: PreparedVisit): Promise<{ url: string } | { error: string }> {
  if (!UUID_RE.test(bookingId)) return { error: 'Invalid booking ID' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Stripe not configured' }
  return saveVisitPaymentLink(getAdmin(), new Stripe(process.env.STRIPE_SECRET_KEY), bookingId, prepared)
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
