import type { Tables } from '@/supabase/database.types'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { austinDay, getCalendarEntries } from '@/lib/calendar-data'
import { calendarDate, calendarReturnTo, visitHref, visitReturnHref } from '@/lib/calendar-view'
import type { JobLine } from '@/lib/crm-jobs'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import Icon from '../../../icons'
import VisitDetails from '../../VisitDetails'
import { visitMapContext, visitScheduleContext } from '../../visit-context'

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function ScheduleChanged({ back }: { back: string }) {
  return <div className="crm-page work-visit-page">
    <Link href={back} className="crm-back"><Icon name="arrowLeft" size={16} />Back to calendar</Link>
    <div className="work-visit-card"><h1>Schedule changed</h1><p className="crm-muted">Reopen the calendar to see the current visit dates.</p></div>
  </div>
}

export default async function OccurrencePage({ params, searchParams }: {
  params: Promise<{ key: string }>; searchParams: Promise<{ returnTo?: string }>
}) {
  const { key } = await params
  const requestedBack = (await searchParams).returnTo
  const returnTo = visitReturnHref(`/admin/jobs/occurrence/${key}`, typeof requestedBack === 'string' ? requestedBack : undefined)
  await requireStaff(returnTo)
  const parts = key.split('_')
  const [agreementId, revisionId, on] = parts
  if (parts.length !== 3 || !UUID.test(agreementId) || !UUID.test(revisionId) || !calendarDate(on)) notFound()
  const today = austinDay()
  const back = calendarReturnTo(requestedBack, today)
  const visit = (await getCalendarEntries(on, on, returnTo)).find(row =>
    row.agreement_id === agreementId && row.revision_id === revisionId && row.cadence_on === on)
  const db = adminDb()
  if (visit?.booking_id) {
    const { data: valid } = await db.rpc('crm_schedule_slots', { p_agreement_id: agreementId, p_from: on, p_through: on })
      .eq('revision_id', revisionId).limit(1).throwOnError()
    if (valid?.length) redirect(visitHref(visit, back))
  }
  if (!visit || visit.booking_id) return <ScheduleChanged back={back} />

  const [agreement, revision] = await Promise.all([
    db.from('recurring_agreements').select('*').eq('id', agreementId).maybeSingle().throwOnError(),
    db.from('agreement_schedule_revisions').select('items_template,service_labels(name)').eq('id', revisionId).eq('agreement_id', agreementId)
      .maybeSingle().overrideTypes<{ items_template: Tables<'agreement_schedule_revisions'>['items_template']; service_labels: { name: string } | null }, { merge: false }>().throwOnError(),
  ])
  const plan = agreement.data
  if (!plan?.schedule_source_booking_id || !Array.isArray(revision.data?.items_template)) return <ScheduleChanged back={back} />
  const { data: source } = await db.from('bookings').select('*').eq('id', plan.schedule_source_booking_id).maybeSingle().throwOnError()
  if (!source || source.status === 'pending' || source.agreement_id !== plan.id || source.customer_id !== plan.customer_id ||
    source.property_id !== plan.property_id) return <ScheduleChanged back={back} />

  const [map, schedule] = await Promise.all([visitMapContext(source), visitScheduleContext(plan, on)])
  const items = revision.data.items_template.flatMap((item): JobLine[] =>
    item && typeof item === 'object' && !Array.isArray(item) &&
    (item.kind === 'service' || item.kind === 'discount') && typeof item.description === 'string' &&
    (typeof item.amount === 'number' || typeof item.amount === 'string')
      ? [{ kind: item.kind, description: item.description, amount: String(item.amount) }] : [])
  const { id: sourceId, ...sourceFields } = source
  const booking = {
    ...sourceFields,
    status: 'confirmed',
    occurrence_on: on,
    confirmed_date: on,
    preferred_date: on,
    confirmed_time: visit.visit_time,
    job_total: visit.job_total,
    price_per_visit: null,
    first_visit_price: null,
    overgrowth_fee: null,
    completed_at: null,
    notes: null,
    amount_charged: null,
    payment_method: null,
    payment_link: null,
    last_reminder_sent_at: null,
    accepted_quote_snapshot: null,
    addon_interest: null,
    one_time: false,
  }
  return <VisitDetails key={`${key}/${sourceId}`} occurrence={{ agreementId, revisionId, on }} booking={booking} today={today} back={back}
    agreement={plan} {...schedule} serviceLabel={revision.data.service_labels?.name} customers={[]} properties={[]} candidates={[]} items={items} payments={[]}
    quotedVisit={false} {...map} emailConfigured={Boolean(process.env.RESEND_API_KEY)} />
}
