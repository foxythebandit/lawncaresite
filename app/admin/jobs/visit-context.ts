import type { Tables } from '@/supabase/database.types'
import { addDays } from '@/lib/calendar-view'
import { adminDb } from '@/lib/supabase/admin'
import { signMapUrls } from '../signed-maps'
import { tracedShapes } from '../leads/TracingMap'

export async function visitScheduleContext(plan: Tables<'recurring_agreements'> | null, today: string) {
  if (!plan) return { futureJobIds: [], reviewReason: null }
  const db = adminDb()
  const nextUngenerated = plan.generated_through ? addDays(plan.generated_through, 1) : plan.generation_starts_on
  const [future, conflict] = await Promise.all([
    db.from('bookings').select('id').eq('agreement_id', plan.id).in('status', ['pending', 'confirmed'])
      .or(`confirmed_date.gte.${today},and(confirmed_date.is.null,preferred_date.gte.${today}),and(confirmed_date.is.null,preferred_date.is.null,or(occurrence_on.gte.${today},occurrence_on.is.null))`)
      .order('id').throwOnError(),
    plan.status === 'active' && !plan.schedule_review_reason && nextUngenerated
      ? db.rpc('crm_schedule_first_move_conflict', { p_agreement_id: plan.id, p_from: nextUngenerated }).throwOnError()
      : { data: null },
  ])
  return {
    futureJobIds: (future.data ?? []).map(row => row.id),
    reviewReason: plan.schedule_review_reason ?? (conflict.data
      ? `A moved visit conflicts with the schedule on ${conflict.data}. Review that date before editing the schedule.` : null),
  }
}

export async function visitMapContext(booking: Pick<Tables<'bookings'>, 'map_screenshot_url' | 'lead_id'>) {
  const signed = await signMapUrls([booking.map_screenshot_url])
  const mapUrl = signed.get(booking.map_screenshot_url ?? '') ?? null
  const trace = !mapUrl && booking.lead_id
    ? (await adminDb().from('leads').select('lawn_tracing').eq('id', booking.lead_id).maybeSingle()).data?.lawn_tracing : null
  return { mapUrl, shapes: tracedShapes(trace) }
}
