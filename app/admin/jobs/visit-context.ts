import type { Tables } from '@/supabase/database.types'
import { definitionFrom, scheduleLabel } from '@/lib/service-schedules'
import { addDays } from '@/lib/calendar-view'
import { adminDb } from '@/lib/supabase/admin'
import { signMapUrls } from '../signed-maps'
import { tracedShapes } from '../leads/TracingMap'

export async function visitScheduleContext(plan: Tables<'recurring_agreements'> | null, from: string) {
  if (!plan) return { reviewReason: null, scheduleSummary: null, simpleShift: false }
  const db = adminDb()
  const nextUngenerated = plan.generated_through ? addDays(plan.generated_through, 1) : plan.generation_starts_on
  const [revisions, conflict] = await Promise.all([
    db.from('agreement_schedule_revisions').select('definition,starts_on,ends_before,items_template,visit_time')
      .eq('agreement_id', plan.id).or(`ends_before.is.null,ends_before.gt.${from}`).order('starts_on').throwOnError(),
    plan.status === 'active' && !plan.schedule_review_reason && nextUngenerated
      ? db.rpc('crm_schedule_first_move_conflict', { p_agreement_id: plan.id, p_from: nextUngenerated }).throwOnError()
      : { data: null },
  ])
  const future = revisions.data.filter(row => !row.ends_before || row.ends_before > row.starts_on)
  const first = future[0]
  const definition = definitionFrom(first?.definition)
  const simpleShift = future.every(row => {
    const rule = definitionFrom(row.definition)
    return rule && ['legacy', 'weekly', 'biweekly'].includes(rule.base.frequency) && !rule.annual?.length
      && !rule.excluded_on?.length && (rule.temporary ?? []).every(period => period.rule.frequency === 'weekly' && addDays(period.start, 1) === period.end)
      && JSON.stringify(rule.base) === JSON.stringify(definition?.base)
      && JSON.stringify(row.items_template) === JSON.stringify(first.items_template) && row.visit_time === first.visit_time
  })
  return {
    scheduleSummary: scheduleLabel(definition, plan),
    simpleShift,
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
