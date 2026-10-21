'use server'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { dispatchAlert, refreshAlert } from '@/lib/staff-alerts'
import { type QuoteDraft } from '@/lib/quote-draft'
import { revalidatePath } from 'next/cache'

export async function saveLeadQuote(id: string, draft: QuoteDraft, confirmed: boolean) {
  await requireStaff(`/admin/leads/${id}`)
  if (!/^[0-9a-f-]{36}$/i.test(id) || !draft || JSON.stringify(draft).length > 64000 || !Array.isArray(draft.sections) || draft.sections.length > 100 || !['onetime','monthly','biweekly','weekly'].includes(draft.freq)) return { error: 'Invalid draft.' }
  if (draft.sections.some(s => !Number.isFinite(s.sqFt) || s.sqFt < 0 || s.sqFt > 10000000)) return { error: 'Invalid measurement.' }
  if ([draft.calculatedPrice, draft.calculatedFirstVisit, draft.overridePrice ?? 0].some(n => !Number.isFinite(n) || n < 0 || n > 1000000)) return { error: 'Invalid price.' }
  if (confirmed && !draft.sections.length) return { error: 'Measure the property before confirming a quote.' }
  const { error } = await adminDb().from('leads').update({ quote_draft: draft, quote_saved_at: new Date().toISOString(), quote_confirmed_at: confirmed ? new Date().toISOString() : null }).eq('id', id).select('id').single()
  if (error) return { error: 'Could not save quote.' }
  revalidatePath(`/admin/leads/${id}`)
  return { success: true }
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

/** Explicit staff operation; quote saves never create bookings. */
export async function requestLeadBooking(id: string, formData: FormData) {
  await requireStaff(`/admin/leads/${id}`)
  const db = adminDb()
  const { data: lead } = await db.from('leads').select('*').eq('id', id).single()
  if (!lead?.quote_confirmed_at || !lead.quote_draft || !lead.name || !(lead.quote_draft.address || lead.address)) throw new Error('Confirm a quote with name and address first.')
  const date = String(formData.get('preferred_date') ?? '')
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date')
  const { recordIntake, leadToken } = await import('@/lib/intake')
  const draft = lead.quote_draft as QuoteDraft
  await recordIntake('staff-booking', id, {}, {
    name: lead.name, phone: lead.phone, email: lead.email, address: draft.address || lead.address,
    sq_ft: Math.round(draft.sections.reduce((n, s) => n + s.sqFt, 0)),
    frequency: { onetime: 'One-time', monthly: 'Monthly', biweekly: 'Bi-weekly', weekly: 'Weekly' }[draft.freq],
    price_per_visit: Math.round(draft.overridePrice ?? draft.calculatedPrice),
    first_visit_price: Math.round(draft.overridePrice ?? draft.calculatedFirstVisit),
    one_time: draft.freq === 'onetime', preferred_date: date || null, notes: draft.notes,
    addon_interest: draft.addonInterest ?? null, last_mow: draft.lastMow, overgrowth_fee: draft.overgrowthFee ?? 0,
    gclid: lead.gclid, utm_source: lead.utm_source, utm_medium: lead.utm_medium, utm_campaign: lead.utm_campaign,
    utm_term: lead.utm_term, utm_content: lead.utm_content,
  }, leadToken(id))
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin')
}

export async function updateLeadContact(id: string, form: FormData) {
  await requireStaff(`/admin/leads/${id}`)
  const name = String(form.get('name') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  if (!name || name.length > 150 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a name and valid optional email.')
  const { error } = await adminDb().from('leads').update({ name, email: email || null }).eq('id', id).select('id').single()
  if (error) throw new Error('Could not save contact details.')
  revalidatePath(`/admin/leads/${id}`)
}
