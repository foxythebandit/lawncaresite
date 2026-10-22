'use server'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { dispatchAlert, refreshAlert } from '@/lib/staff-alerts'
import { quoteTotalCents, type QuoteDraft } from '@/lib/quote-draft'
import { centsToAmount, type LeadActivityInput, type LeadWorkflowPatch, type LeadWorkflowResult, type ContactOutcome, type LeadStage, type QuoteStatus, type JobItemInput, type CreateJobResult } from '@/lib/crm-contracts'
import { revalidatePath } from 'next/cache'

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
  return updateWorkflow(id, expectedUpdatedAt, { quote_draft: draft, quote_status: 'draft', review_quote: reviewed, ...(reviewed ? { stage: 'quoted' as const } : {}) },
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
  const { data: lead, error: readError } = await db.from('leads').select('name,address,quote_status,accepted_quote_snapshot').eq('id', id).single()
  if (readError || !lead) return { error: 'Could not load the accepted quote.' }
  if (lead.quote_status !== 'accepted' || !lead.accepted_quote_snapshot) return { error: 'Mark the reviewed quote accepted first.' }
  if (!lead.name || !(lead.accepted_quote_snapshot.address || lead.address)) return { error: 'Add a contact name and property address first.' }
  const draft = lead.accepted_quote_snapshot as QuoteDraft
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
  if (!name || name.length > 150 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: 'Enter a name and valid optional email.' }
  return updateWorkflow(id, expectedUpdatedAt, { name, email }, { kind: 'note', outcome: 'contact_updated', body: 'Contact details updated.' })
}
