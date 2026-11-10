import Link from 'next/link'
import { notFound } from 'next/navigation'
import { austinDay, calendarDate } from '@/lib/calendar-view'
import { jobPrice, type JobLine } from '@/lib/crm-jobs'
import { customerDisplayName } from '@/lib/lead-labels'
import { definitionFrom, serviceEditorHref, serviceEditorOrigin, UUID, type IntroContinuation, type ServiceEditorSource } from '@/lib/service-schedules'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import Icon from '../../../icons'
import ScheduleEditor from '../../../jobs/ScheduleEditor'

export default async function CustomerServicePage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ schedule?: string; visit?: string; from?: string; extra?: string; origin?: string }>
}) {
  const { id } = await params
  const { schedule, visit, from, extra: extraParam, origin } = await searchParams
  const extra = extraParam === '1'
  await requireStaff(serviceEditorHref(id, { schedule, visit, from, extra, origin }))
  if (!UUID.test(id) || (schedule && !UUID.test(schedule)) || (visit && !UUID.test(visit)) || (extra && !schedule)) notFound()
  const db = adminDb()
  let sourceQuery = db.from('bookings').select('id,property_id,service_label_id,confirmed_date,completed_at,updated_at,job_total,first_visit_price,price_per_visit,confirmed_time,job_items(kind,description)')
    .eq('customer_id', id).is('agreement_id', null).in('status', ['confirmed', 'completed']).not('property_id', 'is', null)
  if (visit) sourceQuery = sourceQuery.eq('id', visit)
  const [customer, properties, plan, labels, sources, intro, grant] = await Promise.all([
    db.from('customers').select('id,name').eq('id', id).maybeSingle().throwOnError(),
    db.from('properties').select('id,address').eq('customer_id', id).order('address').throwOnError(),
    schedule ? db.from('recurring_agreements').select('*').eq('id', schedule).eq('customer_id', id).maybeSingle().throwOnError() : { data: null },
    db.from('service_labels').select('id,name,retired_at,updated_at,semantic_key').order('name').throwOnError(),
    !schedule ? sourceQuery.order('confirmed_date', { ascending: false, nullsFirst: false }).limit(50).throwOnError() : { data: [] },
    !schedule && !visit ? db.rpc('crm_intro_continuation', { p_customer_id: id }).maybeSingle().throwOnError() : { data: null },
    !schedule ? db.from('crm_intro_grants').select('allocated_booking_id,standard_items').eq('customer_id', id).maybeSingle().throwOnError() : { data: null },
  ])
  if (!customer.data || (schedule && !plan.data) || (extra && (!plan.data?.service_label_id || plan.data.status === 'ended'))) notFound()
  const today = austinDay()
  const effective = calendarDate(from) && from >= today ? from : today
  const revisions = plan.data ? await db.from('agreement_schedule_revisions').select('id,definition,starts_on,ends_before,visit_time')
    .eq('agreement_id', plan.data.id).order('starts_on', { ascending: false }).order('created_at', { ascending: false }).throwOnError() : { data: [] }
  const meaningful = (revisions.data ?? []).filter(row => !row.ends_before || row.ends_before > row.starts_on)
  const revision = meaningful.find(row => row.starts_on <= effective && (!row.ends_before || row.ends_before > effective)) ?? meaningful[0]
  const selectedLabel = labels.data.find(label => label.id === plan.data?.service_label_id)
  const savedGrant = grant.data
  const choices: ServiceEditorSource[] = sources.data.flatMap(row => {
    const date = row.confirmed_date ?? (row.completed_at ? austinDay(new Date(row.completed_at)) : null)
    return row.property_id && date ? [{ id: row.id, propertyId: row.property_id, labelId: row.service_label_id,
      date, version: row.updated_at, price: jobPrice(row), arrival: row.confirmed_time,
      regularPrice: savedGrant && savedGrant.allocated_booking_id === row.id && Array.isArray(savedGrant.standard_items)
        ? (savedGrant.standard_items as JobLine[]).reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100 : undefined,
      service: row.job_items.find(item => item.kind === 'service')?.description ?? 'Saved visit' }] : []
  })
  if (visit && !choices.some(choice => choice.id === visit)) notFound()

  const visitOrigin = serviceEditorOrigin(origin)
  const originBookingId = visitOrigin?.split('?')[0].split('/')[3]
  const { data: visitItems } = plan.data && originBookingId && UUID.test(originBookingId)
    ? await db.from('bookings').select('job_items(kind,description,amount)').eq('id', originBookingId)
      .eq('agreement_id', plan.data.id).maybeSingle().throwOnError() : { data: null }
  const itemsFromVisit: JobLine[] = (visitItems?.job_items ?? []).map(item => ({
    kind: item.kind === 'discount' ? 'discount' : 'service', description: item.description, amount: String(item.amount),
  }))
  const back = visitOrigin ?? (visit ? `/admin/jobs/${visit}` : `/admin/customers/${id}${schedule ? `#schedule-${schedule}` : ''}`)
  const backLabel = visitOrigin || visit ? 'Back to visit' : 'Back to customer'
  const awaitingFirst = plan.data?.status === 'active' && !plan.data.generation_starts_on && !plan.data.schedule_review_reason
  const { data: pendingFirst } = awaitingFirst && plan.data
    ? await db.from('bookings').select('id').eq('agreement_id', plan.data.id)
      .eq('occurrence_on', plan.data.anchor_on).eq('status', 'pending').maybeSingle().throwOnError()
    : { data: null }
  const firstPath = pendingFirst ? `/admin/jobs/${pendingFirst.id}` : null
  const firstHref = pendingFirst && originBookingId === pendingFirst.id ? visitOrigin : firstPath
  const title = extra ? 'Add extra visit' : plan.data ? 'Edit service schedule' : 'Add service'
  const property = properties.data.find(p => p.id === plan.data?.property_id)
  return <main className="crm-page work-visit-page">
    <Link href={back} className="crm-back"><Icon name="arrowLeft" size={16} />{backLabel}</Link>
    <section className="work-visit-card service-editor-card">
      <div className="work-visit-heading">
        <div>
          <h1>{title}</h1>
          <p>{customerDisplayName({ name: customer.data.name, address: property?.address })}{property && ` · ${property.address}`}</p>
          {selectedLabel && <p className="crm-muted">{selectedLabel.name}</p>}
        </div>
      </div>
      {plan.data?.status === 'ended' ? <p>This service schedule has ended. Its saved visits stay in customer history.</p>
        : awaitingFirst ? <>
          <p>Confirm the first visit before editing this schedule.</p>
          {firstHref && <div className="work-visit-actions">
            <Link href={firstHref} className="crm-button crm-button-primary">Confirm first visit</Link>
          </div>}
        </> : <ScheduleEditor customerId={id} properties={properties.data} labels={labels.data} sources={choices}
          initialSource={visit} plan={plan.data} definition={definitionFrom(revision?.definition)}
          intro={intro.data as IntroContinuation | null} mowingLabelId={labels.data.find(label => label.semantic_key === 'mowing' && !label.retired_at)?.id}
          itemsFromVisit={itemsFromVisit} initialArrival={revision?.visit_time ?? null} today={today} from={effective} extra={extra} back={back} backLabel={backLabel} />}
    </section>
  </main>
}
