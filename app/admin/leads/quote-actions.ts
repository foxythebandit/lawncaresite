'use server'
import { randomUUID } from 'node:crypto'
import type { CreateEmailOptions } from 'resend'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { dispatchAlert, refreshAlert } from '@/lib/staff-alerts'
import { quoteTotalCents, type QuoteDraft } from '@/lib/quote-draft'
import { isPropertyConfirmed, isPropertyPoint } from '@/lib/property-location'
import { type LeadActivityInput, type LeadWorkflowPatch, type LeadWorkflowResult, type ContactOutcome, type LeadStage, type QuoteStatus } from '@/lib/crm-contracts'
import { revalidatePath } from 'next/cache'
import { commandError } from '@/lib/crm-jobs'
import { changeAgreement, changeJob } from '../actions'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import { offerPath, readSentOffer, signOfferProof, verifyOfferProof, type OfferTerms, type SentOffer } from '@/lib/sent-offer'
import { MAP_CID, quoteEmailBreakdown, quoteEmailContent, validateQuoteEmailOptions, type QuoteEmailOptions } from '@/lib/quote-email'

const uuidPattern = /^[0-9a-f-]{36}$/i
type CommandResult = { success: true; updatedAt: string; warning?: string } | { error: string; conflict?: boolean }

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
  if (draft.jobLatLng != null && !isPropertyPoint(draft.jobLatLng)) return { error: 'Invalid property location.' }
  await requireStaff(`/admin/leads/${id}`)
  const { data: currentLead, error: addressError } = await adminDb().from('leads').select('address,answers').eq('id', id).single()
  if (addressError || !currentLead) return { error: 'Could not load the current contact address.' }
  if (draft.contactAddressAtReview !== currentLead.address) return { error: 'The contact address changed. Start a quote for the updated address before saving.' }
  const propertyConfirmed = isPropertyConfirmed(draft.propertyConfirmation, draft.address, currentLead.address, draft.jobLatLng)
  if (draft.propertyConfirmation != null && !propertyConfirmed) return { error: 'The property location changed. Confirm the current property before saving.' }
  const needsAddressReview = currentLead.answers && typeof currentLead.answers === 'object'
    && !Array.isArray(currentLead.answers) && currentLead.answers.address_needs_review === true
  if (reviewed && needsAddressReview && (draft.sections.length > 0 || draft.jobLatLng != null) && !propertyConfirmed) {
    return { error: 'Confirm the matching property on the map before marking this quote reviewed.' }
  }
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

/** Preserve the agreed price as a pending request, then review its first visit. */
export async function requestStaffQuoteVisit(id: string, expectedUpdatedAt: string, operationId: string, offerId: string | null) {
  const user = await requireStaff(`/admin/leads/${id}`)
  if (![id, operationId].every(value => uuidPattern.test(value)) || (offerId && !uuidPattern.test(offerId))) {
    return { error: 'Refresh the lead and review the quote.' }
  }
  const db = adminDb()
  const { data: lead } = await db.from('leads')
    .select('address,quote_draft,quote_confirmed_at,quote_status,quote_accepted_at,accepted_quote_snapshot').eq('id', id).single()
  if (!lead) return { error: 'Could not load this quote.' }
  let terms: Record<string, unknown>
  if (offerId) {
    terms = { offer_id: offerId }
  } else {
    const draft = (lead.quote_status === 'accepted' ? lead.accepted_quote_snapshot : lead.quote_draft) as QuoteDraft | null
    if (!draft?.sections || (!lead.quote_confirmed_at && lead.quote_status !== 'accepted')) {
      return { error: 'Review and save the agreed price first.' }
    }
    if (draft.contactAddressAtReview !== undefined && draft.contactAddressAtReview !== lead.address) {
      return { error: 'Review a quote for the current property first.' }
    }
    if (lead.quote_accepted_at) {
      const { data: changed, error } = await db.from('lead_activities').select('id').eq('lead_id', id)
        .eq('outcome', 'contact_address_changed').gt('occurred_at', lead.quote_accepted_at).limit(1)
      if (error || changed?.length) return { error: 'Review the accepted property before booking.' }
    }
    const breakdown = quoteEmailBreakdown(draft, { when: '', addOns: [] }, false)
    const row = breakdown.rows[0]
    terms = { source: 'staff_agreed_quote', items: row.firstItems, regular_items: row.regularItems,
      frequency: row.freq, mowing: breakdown.mowing, quote_draft: draft }
  }
  const { data, error } = await db.rpc('crm_staff_quote_request', {
    p_lead_id: id, p_expected_updated_at: expectedUpdatedAt, p_operation_id: operationId,
    p_terms: terms, p_actor_email: user.email,
  })
  if (error) return { error: commandError(error) }
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin/leads')
  revalidatePath('/admin/jobs')
  return { success: true as const, bookingId: data.booking_id as string }
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

/** Inline JPEG, kept within the Server Action body limit. */
const MAX_MAP_IMAGE = 900_000
type EmailQuoteInput = { to: string; options: QuoteEmailOptions; image: string | null }

async function buildEmailQuote(id: string, version: string, offerId: string, input: EmailQuoteInput) {
  if (![id, offerId].every(v => uuidPattern.test(v))) return { error: 'Invalid quote.' } as const
  const email = input.to.trim()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' } as const
  const invalid = validateQuoteEmailOptions(input.options)
  if (invalid) return { error: invalid } as const
  const image = input.image
  if (image !== null && (typeof image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > MAX_MAP_IMAGE)) {
    return { error: 'The map picture is invalid. Preview again.' } as const
  }
  const db = adminDb()
  const [{ data: lead }, { data: prior, error: priorError }] = await Promise.all([
    db.from('leads').select('name,address,quote_draft,quote_status,updated_at,customer_id').eq('id', id).maybeSingle(),
    db.from('sent_offers').select('id,accepted_booking_id').eq('lead_id', id).eq('state', 'sent').is('replaced_by', null).order('version', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (priorError || !lead?.quote_draft) return { error: 'Could not load the saved quote.' } as const
  if (lead.updated_at !== version) return { error: 'This lead changed. Review the quote again.' } as const
  const draft = lead.quote_draft as QuoteDraft
  if (draft.contactAddressAtReview !== undefined && draft.contactAddressAtReview !== lead.address) {
    return { error: 'The property changed. Save a quote for the current property first.' } as const
  }
  let introEligible = true
  if (lead.customer_id) {
    const { data: eligible, error } = await db.rpc('crm_intro_customer_eligible', { p_customer_id: lead.customer_id })
    if (error) return { error: 'Could not check the customer’s mowing history.' } as const
    introEligible = eligible === true
  }
  const revision: 'replaces' | 'proposal' | undefined = lead.quote_status === 'accepted' || prior?.accepted_booking_id ? 'proposal' : prior ? 'replaces' : undefined
  const bookUrl = lead.address
    ? new URL(offerPath(id, offerId), process.env.CRM_BASE_URL ?? 'https://quietgreen.co').href : null
  const emailContent = quoteEmailContent({ draft, address: lead.address, options: input.options, bookUrl, hasMap: !!image, introEligible, revision })
  if (emailContent.breakdown.rows.some(row => row.perVisitCents <= 0)) return { error: 'Enter a quote price first.' } as const
  const terms: OfferTerms = { ...emailContent.breakdown, draft, address: lead.address,
    firstName: lead.name?.trim().split(/\s+/)[0] || null, message: input.options.message.trim(),
    mowing: emailContent.breakdown.mowing }
  const message = {
    from: 'QuietGreen <hello@quietgreen.co>', to: email, replyTo: 'hello@quietgreen.co',
    subject: emailContent.subject, text: emailContent.text, html: emailContent.html,
    ...(image ? { attachments: [{ filename: 'your-lawn.jpg', content: image.split(',')[1], contentType: 'image/jpeg', contentId: MAP_CID }] } : {}),
  } satisfies CreateEmailOptions
  const replaces = prior?.id ?? null
  const proofInput = JSON.stringify(['preview', id, version, offerId, replaces, terms, message])
  return { terms, message, proofInput, replaces, revision }
}

export async function previewLeadQuote(id: string, version: string, input: EmailQuoteInput) {
  await requireStaff(`/admin/leads/${id}`)
  const offerId = randomUUID()
  const candidate = await buildEmailQuote(id, version, offerId, input)
  if ('error' in candidate) return { error: candidate.error ?? 'Could not load the saved quote.' }
  return { offerId, proof: signOfferProof(candidate.proofInput), subject: candidate.message.subject,
    html: candidate.message.html, revision: candidate.revision }
}

export async function emailLeadQuote(id: string, version: string, offerId: string, proof: string, input: EmailQuoteInput): Promise<CommandResult> {
  const actor = await requireStaff(`/admin/leads/${id}`)
  if (!process.env.RESEND_API_KEY) return { error: 'Email is not configured.' }
  const candidate = await buildEmailQuote(id, version, offerId, input)
  if ('error' in candidate) return { error: candidate.error ?? 'Could not load the saved quote.' }
  if (!verifyOfferProof(candidate.proofInput, proof)) return { error: 'The quote changed after the preview. Review it again.', conflict: true }
  const { data, error } = await adminDb().rpc('crm_prepare_sent_offer', {
    p_lead_id: id, p_version: version, p_offer_id: offerId, p_replaces: candidate.replaces,
    p_terms: candidate.terms, p_message: candidate.message, p_recipient: input.to.trim(),
  })
  if (error) return { error: error.code === 'PT409' ? error.message : 'Could not prepare the quote email.' }
  return deliverQuote(data as SentOffer, actor.email ?? 'Staff', data.new_attempt === true)
}

export async function retryLeadQuote(id: string, offerId: string): Promise<CommandResult> {
  const actor = await requireStaff(`/admin/leads/${id}`)
  if (![id, offerId].every(v => uuidPattern.test(v))) return { error: 'Invalid quote.' }
  if (!process.env.RESEND_API_KEY) return { error: 'Email is not configured.' }
  const offer = await readSentOffer(id, offerId)
  if (!offer) return { error: 'Quote attempt unavailable.' }
  return deliverQuote(offer, actor.email ?? 'Staff')
}

async function deliverQuote(offer: SentOffer, actor: string, firstAttempt = false): Promise<CommandResult> {
  if (offer.state === 'failed') return { error: 'The provider rejected this email. Review the address and prepare a new send.' }
  if (!offer.sent_at && Date.now() - Date.parse(offer.created_at) >= 23 * 60 * 60 * 1000) {
    return { error: 'This attempt is outside the safe retry window. Check the provider’s email history before sending again.' }
  }
  let providerId: string | null = null
  let state = 'unknown'
  if (!offer.sent_at) {
    try {
      const { sendEmail } = await import('@/lib/email')
      const { data, error } = await sendEmail(offer.message, { idempotencyKey: `quote/${offer.id}` })
      if (data?.id) { state = 'sent'; providerId = data.id }
      else if (firstAttempt && [400, 401, 403, 422].includes(error?.statusCode ?? 0)) state = 'failed'
    } catch {
      // A transport error does not establish whether Resend accepted the message.
    }
  }
  const { data, error } = await adminDb().rpc('crm_finish_sent_offer', {
    p_lead_id: offer.lead_id, p_offer_id: offer.id, p_state: state, p_provider_id: providerId, p_actor_email: actor,
  })
  revalidatePath(`/admin/leads/${offer.lead_id}`)
  if (error || data.state === 'unknown') return { error: 'Email delivery is unconfirmed. Check or retry this same attempt from Sent quotes.' }
  if (data.state === 'failed') return { error: 'The provider rejected the email. Check the address and try again.' }
  if (data.state === 'review') return { success: true, updatedAt: data.updated_at, warning: 'Proposal emailed. Staff review is needed because a visit or quote was already accepted.' }
  return { success: true, updatedAt: data.updated_at }
}
