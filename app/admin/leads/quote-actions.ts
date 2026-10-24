'use server'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { dispatchAlert, refreshAlert } from '@/lib/staff-alerts'
import { quoteTotalCents, type QuoteDraft } from '@/lib/quote-draft'
import { centsToAmount, type LeadActivityInput, type LeadWorkflowPatch, type LeadWorkflowResult, type ContactOutcome, type LeadStage, type QuoteStatus, type JobItemInput, type CreateJobResult } from '@/lib/crm-contracts'
import { revalidatePath } from 'next/cache'
import { addInterval } from '@/lib/crm-jobs'
import { changeAgreement, changeJob } from '../actions'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import { leadToken } from '@/lib/intake'
import { frequencyLabel, quoteOffer } from '@/lib/quote-offer'

const uuidPattern = /^[0-9a-f-]{36}$/i
type CommandResult = { success: true; updatedAt: string } | { error: string; conflict?: boolean }

async function updateWorkflow(id: string, expectedUpdatedAt: string, patch: LeadWorkflowPatch & { review_quote?: boolean; name?: string; email?: string }, activity: LeadActivityInput): Promise<CommandResult> {
  const user = await requireStaff(`/admin/leads/${id}`)
  if (!uuidPattern.test(id) || !Number.isFinite(Date.parse(expectedUpdatedAt))) return { error: 'This page is out of date. Refresh and try again.' }
  const { data, error } = await adminDb().rpc('update_lead_workflow', {
    p_lead_id: id, p_expected_updated_at: expectedUpdatedAt, p_patch: patch,
    p_activity: activity, p_actor_email: user.email,
  })
  if (error?.code === 'PT409' || error?.code === '40001') return { error: 'This lead changed since you opened it. Refresh before saving.', conflict: true }
  if (error) return { error: error.code === '23514' || error.code === '22023' ? error.message : 'Could not save this change.' }
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin/leads')
  return { success: true, updatedAt: (data as LeadWorkflowResult).updated_at }
}

export async function saveLeadQuote(id: string, expectedUpdatedAt: string, draft: QuoteDraft, reviewed: boolean): Promise<CommandResult> {
  if (!draft || JSON.stringify(draft).length > 64000 || !Array.isArray(draft.sections) || draft.sections.length > 100 || !['onetime','monthly','biweekly','weekly'].includes(draft.freq)) return { error: 'Invalid draft.' }
  if (draft.sections.some(s => !Number.isFinite(s.sqFt) || s.sqFt < 0 || s.sqFt > 10000000)) return { error: 'Invalid measurement.' }
  if ([draft.calculatedPrice, draft.calculatedFirstVisit, draft.overridePrice ?? 0].some(n => !Number.isFinite(n) || n < 0 || n > 1000000)) return { error: 'Invalid mowing price.' }
  const lines = draft.manualLines ?? []
  if (lines.length > 30 || lines.some(line => !line.id || line.service.trim().length > 120 || !Number.isSafeInteger(line.amountCents) || line.amountCents < 0 || line.amountCents > 100000000 || (line.amountCents > 0 && !line.service.trim()))) return { error: 'Enter a service name and valid price for each priced line.' }
  if (!Number.isSafeInteger(draft.discountCents ?? 0) || (draft.discountCents ?? 0) < 0 || (draft.discountCents ?? 0) > 100000000) return { error: 'Invalid discount.' }
  const totalCents = quoteTotalCents(draft)
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || totalCents > 100000000 || draft.totalCents !== totalCents) return { error: 'Discount exceeds the service total or quote total changed.' }
  if (reviewed && totalCents <= 0) return { error: 'Enter a price before marking this quote reviewed.' }
  await requireStaff(`/admin/leads/${id}`)
  const { data: currentLead, error: addressError } = await adminDb().from('leads').select('address').eq('id', id).single()
  if (addressError || !currentLead) return { error: 'Could not load the current contact address.' }
  if (draft.contactAddressAtReview !== currentLead.address) return { error: 'The contact address changed. Start a quote for the updated address before saving.' }
  const reviewedDraft = draft
  return updateWorkflow(id, expectedUpdatedAt, { quote_draft: reviewedDraft, quote_status: 'draft', review_quote: reviewed, ...(reviewed ? { stage: 'quoted' as const } : {}) },
    { kind: 'quote', outcome: reviewed ? 'reviewed' : 'draft_saved', body: reviewed ? 'Staff reviewed quote.' : 'Saved quote draft.' })
}

export async function recordLeadCall(id: string, expectedUpdatedAt: string, outcome: ContactOutcome, note: string): Promise<CommandResult> {
  if (!['no_answer','reached','wrong_number'].includes(outcome) || note.length > 2000) return { error: 'Choose a valid call outcome.' }
  return updateWorkflow(id, expectedUpdatedAt, { contact_outcome: outcome },
    { kind: 'call', outcome, body: note.trim() || null })
}

export async function setLeadFollowUp(id: string, expectedUpdatedAt: string, followUpAt: string | null): Promise<CommandResult> {
  if (followUpAt && !Number.isFinite(Date.parse(followUpAt))) return { error: 'Choose a valid follow-up time.' }
  return updateWorkflow(id, expectedUpdatedAt, { follow_up_at: followUpAt },
    { kind: 'follow_up', outcome: followUpAt ? 'scheduled' : 'cleared', body: followUpAt })
}

export async function setLeadStage(id: string, expectedUpdatedAt: string, stage: LeadStage): Promise<CommandResult> {
  if (!['new','contacted','quoted','lost'].includes(stage)) return { error: 'Choose a staff stage. Booked is set when a booking is created.' }
  return updateWorkflow(id, expectedUpdatedAt, { stage }, { kind: 'stage', outcome: stage })
}

export async function setLeadQuoteDecision(id: string, expectedUpdatedAt: string, status: QuoteStatus): Promise<CommandResult> {
  if (!['accepted','declined','canceled','draft'].includes(status)) return { error: 'Invalid quote decision.' }
  return updateWorkflow(id, expectedUpdatedAt, { quote_status: status }, { kind: 'quote', outcome: status })
}

export async function addLeadNote(id: string, expectedUpdatedAt: string, note: string): Promise<CommandResult> {
  if (!note.trim() || note.length > 2000) return { error: 'Enter a note up to 2,000 characters.' }
  return updateWorkflow(id, expectedUpdatedAt, {}, { kind: 'note', body: note.trim() })
}
export async function processLeadAlert(leadId: string, alertId: string, eventId: string, mode: string) {
  await requireStaff()
  const db = adminDb()
  const { data: event } = await db.from('intake_events').select('id').eq('id', eventId).eq('lead_id', leadId).single()
  if (!event) return
  const { data: alert } = await db.from('staff_alerts').select('*').eq('id', alertId).eq('event_id', eventId).single()
  if (!alert) return
  if (mode === 'refresh') await refreshAlert(alertId)
  else if (['pending','disabled'].includes(alert.state)) await dispatchAlert(eventId, alertId)
  else if (alert.state === 'failed' && !alert.provider_sid) {
    await db.from('staff_alerts').update({ state: 'pending' }).eq('id', alertId).eq('state', 'failed').is('provider_sid', null)
    await dispatchAlert(eventId, alertId)
  }
  revalidatePath(`/admin/leads/${leadId}`)
}

/** Explicit staff operation. The accepted snapshot is the sole source of job prices. */
export async function requestLeadBooking(id: string, expectedUpdatedAt: string, operationId: string, preferredDate: string) {
  await requireStaff(`/admin/leads/${id}`)
  if (!uuidPattern.test(id) || !uuidPattern.test(operationId) || !Number.isFinite(Date.parse(expectedUpdatedAt))) return { error: 'Refresh this lead and try again.' }
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return { error: 'Choose a valid visit date.' }
  const db = adminDb()
  const { data: lead, error: readError } = await db.from('leads').select('name,address,quote_status,quote_accepted_at,accepted_quote_snapshot').eq('id', id).single()
  if (readError || !lead) return { error: 'Could not load the accepted quote.' }
  if (lead.quote_status !== 'accepted' || !lead.accepted_quote_snapshot) return { error: 'Mark the reviewed quote accepted first.' }
  if (!lead.name || !(lead.accepted_quote_snapshot.address || lead.address)) return { error: 'Add a contact name and property address first.' }
  const draft = lead.accepted_quote_snapshot as QuoteDraft
  const { data: addressChanges, error: addressHistoryError } = await db.from('lead_activities').select('id').eq('lead_id', id).eq('outcome', 'contact_address_changed').gt('occurred_at', lead.quote_accepted_at).limit(1)
  if (addressHistoryError) return { error: 'Could not verify the accepted property. Refresh and retry.' }
  if ((draft.contactAddressAtReview !== undefined && draft.contactAddressAtReview !== lead.address) || addressChanges?.length) return { error: 'The contact address changed after this quote. Review and accept a quote for the current property first.' }
  const items: JobItemInput[] = []
  const mowingCents = draft.includeMowing === false ? 0 : Math.round((draft.overridePrice ?? draft.calculatedPrice) * 100)
  if (mowingCents > 0) items.push({ kind: 'service', description: 'Lawn care', amount: centsToAmount(mowingCents) })
  for (const line of draft.manualLines ?? []) if (line.amountCents > 0) items.push({ kind: 'service', description: line.service, amount: centsToAmount(line.amountCents) })
  if ((draft.discountCents ?? 0) > 0) items.push({ kind: 'discount', description: 'Quote discount', amount: centsToAmount(-(draft.discountCents ?? 0)) })
  if (!items.length || quoteTotalCents(draft) < 0) return { error: 'Accepted quote needs valid service prices.' }
  const { data, error } = await db.rpc('create_job_from_quote', {
    p_lead_id: id, p_expected_updated_at: expectedUpdatedAt, p_operation_id: operationId,
    p_job: { name: lead.name, address: draft.address || lead.address, preferred_date: preferredDate || null, price_per_visit: centsToAmount(quoteTotalCents(draft)) },
    p_items: items,
  })
  if (error?.code === 'PT409' || error?.code === '40001') return { error: 'This lead changed since you opened it. Refresh before creating a booking.', conflict: true }
  if (error) return { error: error.code === '23514' || error.code === '22023' ? error.message : 'Could not create booking request.' }
  const { data: updatedLead } = await db.from('leads').select('updated_at').eq('id', id).single()
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin')
  revalidatePath('/admin/leads')
  return { success: true, bookingId: (data as CreateJobResult).booking_id, duplicate: (data as CreateJobResult).duplicate,
    updatedAt: updatedLead?.updated_at ?? expectedUpdatedAt }
}

export async function updateLeadContact(id: string, form: FormData) {
  const expectedUpdatedAt = String(form.get('updated_at') ?? '')
  const name = String(form.get('name') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const phone = String(form.get('phone') ?? '').trim()
  const address = String(form.get('address') ?? '').trim()
  if (!name || name.length > 150 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: 'Enter a name and valid optional email.' }
  if (!/^[+\d() -]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7 || !address || address.length > 500) return { error: 'Enter a valid phone and property address.' }
  await requireStaff(`/admin/leads/${id}`)
  const { data: currentLead, error } = await adminDb().from('leads').select('address').eq('id', id).single()
  if (error || !currentLead) return { error: 'Could not load contact details.' }
  const addressChanged = currentLead.address !== address
  return updateWorkflow(id, expectedUpdatedAt, { name, email, phone, address }, { kind: 'note', outcome: addressChanged ? 'contact_address_changed' : 'contact_updated', body: addressChanged ? 'Contact address changed; review any previous property quote.' : 'Contact details updated.' })
}

const PLAN_INTERVALS: Record<string, { unit: 'week' | 'month'; count: number }> = {
  weekly: { unit: 'week', count: 1 }, biweekly: { unit: 'week', count: 2 }, monthly: { unit: 'month', count: 1 },
}

/**
 * One staff step for "customer said yes": records acceptance of the quoted price, creates the
 * job, links it to a new or confirmed existing customer, and optionally starts a mowing plan from
 * only the lawn-care price. Each underlying command is idempotent, so a retry resumes safely.
 */
export async function bookLeadVisit(id: string, expectedUpdatedAt: string, input: {
  bookingOperationId: string; linkOperationId: string; planOperationId: string
  date: string; customerId: string | null; startPlan: boolean
}): Promise<{ success: true; bookingId: string; customerId: string | null; planStarted: boolean; updatedAt: string } | { error: string; conflict?: boolean }> {
  await requireStaff(`/admin/leads/${id}`)
  if (![id, input.bookingOperationId, input.linkOperationId, input.planOperationId].every(v => uuidPattern.test(v))
    || (input.customerId && !uuidPattern.test(input.customerId))) return { error: 'Refresh this lead and try again.' }
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: 'Choose a valid visit date.' }
  const db = adminDb()
  const { data: lead } = await db.from('leads').select('name,phone,email,address,quote_status,quote_draft,updated_at').eq('id', id).single()
  if (!lead) return { error: 'Could not load this lead.' }
  const quoted = lead.quote_draft as QuoteDraft | null
  if (quoted?.contactAddressAtReview !== undefined && quoted?.contactAddressAtReview !== lead.address) {
    return { error: 'The contact address changed after this quote. Start a quote for the updated address first.' }
  }
  let version = expectedUpdatedAt
  if (lead.quote_status !== 'accepted') {
    const accepted = await setLeadQuoteDecision(id, version, 'accepted')
    if ('error' in accepted) return accepted
    version = accepted.updatedAt
  }
  const booked = await requestLeadBooking(id, version, input.bookingOperationId, input.date)
  if ('error' in booked) return { error: booked.error ?? 'Could not create the job.' }
  version = booked.updatedAt
  const bookingId = booked.bookingId
  const { data: job } = await db.from('bookings').select('updated_at,customer_id,address').eq('id', bookingId).single()
  if (!job) return { error: 'Job created, but it could not be reloaded. Refresh the page.' }
  let customerId: string | null = job.customer_id
  if (!customerId) {
    let propertyId: string | null = null
    if (input.customerId) {
      const { data: properties } = await db.from('properties').select('id,address').eq('customer_id', input.customerId)
      propertyId = properties?.find(p => p.address.trim().toLowerCase() === job.address.trim().toLowerCase())?.id ?? null
    }
    const { data: linked, error } = await db.rpc('crm_link_job', {
      p_booking_id: bookingId, p_expected_updated_at: job.updated_at, p_operation_id: input.linkOperationId,
      p_customer_id: input.customerId, p_property_id: propertyId,
      p_customer: input.customerId ? null : { name: lead.name, phone: lead.phone, email: lead.email ?? '' },
      p_property: propertyId ? null : { address: job.address },
    })
    if (error) return { error: `Job created, but linking the customer failed: ${error.message}` }
    customerId = (linked as { customer_id: string }).customer_id
  }
  let planStarted = false
  const draft = lead.quote_draft as QuoteDraft | null
  const interval = draft ? PLAN_INTERVALS[draft.freq] : undefined
  const lawnCents = draft && draft.includeMowing !== false ? Math.round((draft.overridePrice ?? draft.calculatedPrice) * 100) : 0
  if (input.startPlan && input.date && interval && lawnCents > 0) {
    const { data: current } = await db.from('bookings').select('updated_at').eq('id', bookingId).single()
    const { error } = await db.rpc('crm_start_agreement', {
      p_booking_id: bookingId, p_expected_updated_at: current?.updated_at, p_operation_id: input.planOperationId,
      p_config: { anchor_on: input.date, next_on: addInterval(input.date, interval.unit, interval.count), end_on: null,
        interval_unit: interval.unit, interval_count: interval.count,
        items_template: [{ kind: 'service', description: 'Lawn care', amount: centsToAmount(lawnCents) }] },
    })
    if (error) return { error: `Visit booked, but the mowing plan was not started: ${error.message}. Start it from the customer page.` }
    planStarted = true
  }
  const { data: finalLead, error: finalLeadError } = await db.from('leads').select('updated_at').eq('id', id).single()
  if (finalLeadError || !finalLead) return { error: 'Visit booked, but the lead could not be reloaded. Refresh before editing it again.' }
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin')
  revalidatePath('/admin/customers')
  return { success: true, bookingId, customerId, planStarted, updatedAt: finalLead.updated_at }
}

type CancellationPreview = {
  bookingId: string; bookingStatus: string; agreementId: string | null; agreementUpdatedAt: string | null
  futureJobs: { id: string; date: string | null }[]
}

export async function previewLeadBookingCancellation(id: string): Promise<{ success: true; preview: CancellationPreview } | { error: string }> {
  await requireStaff(`/admin/leads/${id}`)
  if (!uuidPattern.test(id)) return { error: 'Refresh this lead and try again.' }
  const db = adminDb()
  const { data: jobs, error: jobsError } = await db.from('bookings')
    .select('id,status,agreement_id,created_at,accepted_quote_snapshot,creation_operation_id').eq('lead_id', id)
  if (jobsError) return { error: 'Could not load this lead’s visits.' }
  const booking = latestQuoteBooking(jobs ?? [])
  if (!booking) return { error: 'This lead has no booked first visit.' }
  if (!['pending', 'confirmed'].includes(booking.status)) return { error: 'The quoted visit already happened or was canceled. Review the job history.' }
  let agreementUpdatedAt: string | null = null
  let futureJobs: CancellationPreview['futureJobs'] = []
  if (booking.agreement_id) {
    const { data: plan, error: planError } = await db.from('recurring_agreements').select('status,updated_at').eq('id', booking.agreement_id).single()
    if (planError || !plan) return { error: 'Could not load the mowing plan.' }
    if (['active', 'paused'].includes(plan.status)) {
      agreementUpdatedAt = plan.updated_at
      const { data: upcoming, error: upcomingError } = await db.from('bookings')
        .select('id,status,confirmed_date,preferred_date,occurrence_on').eq('agreement_id', booking.agreement_id).in('status', ['pending', 'confirmed'])
      if (upcomingError) return { error: 'Could not load upcoming visits.' }
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      futureJobs = (upcoming ?? []).filter(job => {
        const on = job.confirmed_date ?? job.preferred_date ?? job.occurrence_on
        return !on || on >= today
      }).map(job => ({ id: job.id, date: job.confirmed_date ?? job.preferred_date ?? job.occurrence_on }))
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id))
    }
  }
  return { success: true, preview: { bookingId: booking.id, bookingStatus: booking.status,
    agreementId: booking.agreement_id, agreementUpdatedAt, futureJobs } }
}

/**
 * "Customer canceled" on a booked lead: ends the mowing plan started from this booking (canceling its
 * upcoming visits), cancels the first visit if it has not happened, and records the quote as canceled.
 * History is kept; each command is idempotent so a retry resumes safely.
 */
export async function cancelLeadBooking(id: string, input: {
  bookingId: string; agreementUpdatedAt: string | null; futureJobIds: string[]
  jobOperationId: string; planOperationId: string
}): Promise<CommandResult> {
  await requireStaff(`/admin/leads/${id}`)
  if (![id, input.bookingId, input.jobOperationId, input.planOperationId, ...input.futureJobIds].every(v => uuidPattern.test(v))) return { error: 'Refresh this lead and try again.' }
  const db = adminDb()
  const { data: jobs, error: jobsError } = await db.from('bookings')
    .select('id,status,agreement_id,created_at,accepted_quote_snapshot,creation_operation_id').eq('lead_id', id)
  if (jobsError) return { error: 'Could not reload this lead’s visits.' }
  const first = latestQuoteBooking(jobs ?? [])
  if (!first) return { error: 'This lead has no booked visit.' }
  if (first.id !== input.bookingId) return { error: 'The quoted visit changed. Review the cancellation again.', conflict: true }
  if (first.status === 'completed') return { error: 'The first visit already happened. Cancel later visits from the job instead.' }
  if (first.agreement_id) {
    const { data: plan, error: planError } = await db.from('recurring_agreements').select('id,status,updated_at').eq('id', first.agreement_id).single()
    if (planError || !plan) return { error: 'Could not reload the mowing plan. Review the cancellation again.' }
    if (plan && ['active', 'paused'].includes(plan.status)) {
      if (plan.updated_at !== input.agreementUpdatedAt) return { error: 'The mowing plan changed. Review the cancellation again.', conflict: true }
      const ended = await changeAgreement({ agreementId: plan.id, expectedUpdatedAt: plan.updated_at, operationId: input.planOperationId, action: 'end', futureJobIds: input.futureJobIds })
      if (!ended.success) return { error: ended.error }
    }
  }
  const { data: current, error: currentError } = await db.from('bookings').select('status,updated_at').eq('id', first.id).single()
  if (currentError || !current) return { error: 'Could not reload the quoted visit. Review the cancellation again.' }
  if (current.status === 'completed') return { error: 'The quoted visit was completed while this cancellation was in progress. Its accepted quote was kept.' }
  if (['pending', 'confirmed'].includes(current.status)) {
    const canceled = await changeJob({ bookingId: first.id, expectedUpdatedAt: current.updated_at, operationId: input.jobOperationId, action: 'cancel' })
    if (!canceled.success) return { error: canceled.error }
  }
  const { data: finalVisit, error: finalVisitError } = await db.from('bookings').select('status').eq('id', first.id).single()
  if (finalVisitError || !finalVisit) return { error: 'Could not verify the quoted visit after cancellation. Refresh and retry.' }
  if (finalVisit.status !== 'canceled') return { error: 'The quoted visit was not canceled, so its quote outcome was kept. Refresh and review it.' }
  const { data: lead } = await db.from('leads').select('updated_at,quote_status').eq('id', id).single()
  if (!lead) return { error: 'Could not reload this lead.' }
  if (lead.quote_status === 'accepted') {
    return updateWorkflow(id, lead.updated_at, { quote_status: 'canceled', stage: 'lost' },
      { kind: 'quote', outcome: 'canceled', body: 'Customer canceled after booking.' })
  }
  return { success: true, updatedAt: lead.updated_at }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Emails the saved quote; the price comes from the stored draft, never the browser. */
export async function emailLeadQuote(id: string, expectedUpdatedAt: string, to: string, message: string): Promise<CommandResult> {
  await requireStaff(`/admin/leads/${id}`)
  const email = to.trim()
  if (!uuidPattern.test(id)) return { error: 'Invalid lead.' }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' }
  if (!message.trim() || message.length > 4000) return { error: 'Write a short message to go with the quote.' }
  if (!process.env.RESEND_API_KEY) return { error: 'Email is not configured.' }
  const { data: lead } = await adminDb().from('leads').select('name,email,address,quote_draft,updated_at').eq('id', id).single()
  if (!lead?.quote_draft) return { error: 'Save the price before emailing it.' }
  if (lead.updated_at !== expectedUpdatedAt) return { error: 'This lead changed since you opened it. Refresh before sending.', conflict: true }
  const draft = lead.quote_draft as QuoteDraft
  const totalCents = quoteTotalCents(draft)
  const total = totalCents % 100 === 0 ? `$${totalCents / 100}` : `$${centsToAmount(totalCents)}`
  const repeats = draft.includeMowing !== false && draft.freq !== 'onetime'
  const sqFt = draft.sections.reduce((sum, s) => sum + (Number(s.sqFt) || 0), 0)
  const offer = quoteOffer(draft)
  const quoted = offer.options.find(o => o.freq === offer.quoted)!
  const planLine = offer.recurring ? `${frequencyLabel(offer.quoted)} mowing` : 'Quote'
  const extras = offer.recurring ? [quoted.firstVisit !== quoted.price ? `First visit: $${quoted.firstVisit} (30% off)` : '',
    ...offer.options.filter(o => o.freq !== offer.quoted && o.freq !== 'onetime').map(o => `${o.label} $${o.price}`)].filter(Boolean).join(' · ') : ''
  // The booking page needs an address to show the measured property.
  const bookUrl = lead.address ? `${new URL(process.env.CRM_BASE_URL ?? 'https://quietgreen.co').origin}/quote/${leadToken(id)}` : null
  const { Resend } = await import('resend')
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'QuietGreen <hello@quietgreen.co>', to: email, replyTo: 'hello@quietgreen.co',
    subject: offer.recurring && quoted.freq !== 'onetime'
      ? `Your ${frequencyLabel(quoted.freq).toLowerCase()} mowing quote: ${total}/visit${quoted.firstVisit !== quoted.price ? `, first visit $${quoted.firstVisit}` : ''}`
      : `Your QuietGreen quote: ${total}`,
    text: `${message.trim()}\n\n${planLine}: ${total}${repeats ? ' per visit' : ''}${extras ? `\n${extras}` : ''}${sqFt ? `\nMeasured lawn: ${sqFt.toLocaleString('en-US')} sq ft` : ''}${bookUrl ? `\n\nReview & book: ${bookUrl}` : ''}\n\nQuietGreen · quietgreen.co`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111c17">
      <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0"><p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">Your quote</p>
      <h1 style="color:#fff;font-size:22px;margin:0">${esc(lead.address || 'QuietGreen lawn care')}</h1></div>
      <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
      <p style="font-size:15px;line-height:1.6;color:#4a5e54;margin:0 0 20px;white-space:pre-line">${esc(message.trim())}</p>
      <div style="background:#fff;border:1px solid #b7e4c7;border-radius:10px;padding:14px 18px">
      <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#4a5e54">${esc(planLine)}</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:600;color:#1a3a2a">${total}${repeats ? ' <span style="font-size:14px;font-weight:400">per visit</span>' : ''}</p>
      ${extras ? `<p style="margin:6px 0 0;font-size:13px;color:#4a5e54">${esc(extras)}</p>` : ''}
      ${sqFt ? `<p style="margin:6px 0 0;font-size:13px;color:#4a5e54">Measured lawn: ${sqFt.toLocaleString('en-US')} sq ft</p>` : ''}</div>
      ${bookUrl ? `<a href="${esc(bookUrl)}" style="display:block;text-align:center;background:#1a3a2a;color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:10px;font-size:16px;margin-top:18px">Review &amp; book &rarr;</a>
      <p style="font-size:13px;color:#4a5e54;margin:14px 0 0">Pick how often and your start date, and see how we measured your lawn. It takes about 30 seconds.</p>` : ''}
      <p style="font-size:13px;color:#4a5e54;margin:14px 0 0">Reply to this email or call us with any questions.</p></div></div>`,
  })
  if (error) return { error: 'The email could not be sent. Check the address and try again.' }
  return updateWorkflow(id, expectedUpdatedAt, email !== lead.email ? { email } : {},
    { kind: 'quote', outcome: 'emailed', body: `Emailed quote ${total}${repeats ? ' per visit' : ''} to ${email}.` })
}
