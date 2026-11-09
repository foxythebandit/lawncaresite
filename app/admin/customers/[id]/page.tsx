import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAgreements, getBookings, getCustomers, getJobPayments, getLeads } from '../../actions'
import { formatMoney, jobPrice, jobStatusLabel } from '@/lib/crm-jobs'
import { adminDb } from '@/lib/supabase/admin'
import { definitionFrom, scheduleLabel, serviceEditorHref } from '@/lib/service-schedules'
import { visitService } from '@/lib/calendar-data'
import { requireStaff } from '@/lib/staff'
import Icon from '../../icons'
import CustomerActions from './CustomerActions'
import UpcomingVisits, { type UpcomingVisit } from './UpcomingVisits'

export const dynamic = 'force-dynamic'

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dateText(value: string | null) {
  if (!value) return 'Not scheduled'
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric' })
}

const money = formatMoney
const visitCount = (n: number) => `${n} visit${n === 1 ? '' : 's'}`

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireStaff(`/admin/customers/${id}`)
  if (!validId.test(id)) notFound()
  const [{ customers, properties }, allJobs, allLeads, allPayments, allAgreements] = await Promise.all([
    getCustomers(), getBookings(), getLeads(), getJobPayments(), getAgreements(id),
  ])
  const customer = customers.find(row => row.id === id)
  if (!customer) notFound()
  const ownProperties = properties.filter(row => row.customer_id === id)
  const jobs = allJobs.filter(row => row.customer_id === id)
  const leads = allLeads.filter(row => row.customer_id === id)
  const jobIds = new Set(jobs.map(row => row.id))
  const payments = allPayments.filter(row => jobIds.has(row.booking_id))
  const historicalAmounts = jobs.filter(row => row.amount_charged != null)
  const agreements = allAgreements
  const addressById = new Map(ownProperties.map(row => [row.id, row.address]))

  // Open visits first, soonest (and overdue) on top; everything else is history, newest first.
  const visitDate = (job: (typeof jobs)[number]) => (job.confirmed_date ?? job.preferred_date ?? null) as string | null
  const isOpen = (job: (typeof jobs)[number]) => ['pending', 'confirmed'].includes(job.status)
  const openJobs = jobs.filter(isOpen).sort((a, b) => (visitDate(a) ?? '').localeCompare(visitDate(b) ?? ''))
  const pastJobs = jobs.filter(job => !isOpen(job))
    .sort((a, b) => (visitDate(b) ?? b.created_at).localeCompare(visitDate(a) ?? a.created_at))
  const revisions = agreements.length ? await adminDb().from('agreement_schedule_revisions')
    .select('agreement_id,definition').in('agreement_id', agreements.map(row => row.id)).is('ends_before', null).throwOnError() : { data: [] }
  const definitions = new Map((revisions.data ?? []).map(revision => [revision.agreement_id, definitionFrom(revision.definition)]))
  const labels = new Map(agreements.map(agreement => [agreement.id, agreement.service_labels?.name]))
  const serviceIds = jobs.map(job => job.service_label_id).filter((id): id is string => Boolean(id))
  const { data: namedLabels } = serviceIds.length ? await adminDb().from('service_labels').select('id,name')
    .in('id', [...new Set(serviceIds)]).throwOnError() : { data: [] }
  const namesByLabel = new Map((namedLabels ?? []).map(label => [label.id, label.name]))
  const byVisit = new Map<string, string>()
  for (let i = 0; i < openJobs.length; i += 100) {
    const { data } = await adminDb().from('bookings').select('id,job_items(kind,description)')
      .in('id', openJobs.slice(i, i + 100).map(job => job.id)).throwOnError()
    for (const visit of data) {
      const description = visitService(visit.job_items)
      if (description) byVisit.set(visit.id, description)
    }
  }
  const needsPlan = (job: (typeof jobs)[number]) => !job.agreement_id && !job.one_time
    && !!job.frequency?.trim() && !/^(one[ -]?time|single|once)$/i.test(job.frequency.trim())
  const upcomingVisits: UpcomingVisit[] = openJobs.map(job => ({
    id: job.id, updatedAt: job.updated_at, status: job.status, date: visitDate(job), time: job.confirmed_time ?? null,
    address: job.address, price: jobPrice(job), inPlan: Boolean(job.agreement_id),
    service: namesByLabel.get(job.service_label_id ?? '') ?? byVisit.get(job.id) ?? labels.get(job.agreement_id ?? '') ?? 'Service visit',
    needsPlan: needsPlan(job),
  }))
  const nextPlanVisit = (agreementId: string) => openJobs.find(job => job.agreement_id === agreementId)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())

  const nameParts: string[] = String(customer.name ?? '').trim().split(/\s+/).filter(Boolean)
  const initials = nameParts.map(part => part[0]).filter((_, i) => i === 0 || i === nameParts.length - 1).join('').toUpperCase() || '?'

  return <main className="crm-page crm-customer-detail">
    <Link className="crm-back" href="/admin/customers"><Icon name="arrowLeft" size={15} />Customers</Link>
    <div className="crm-page-heading">
      <div className="crm-identity">
        <span className="crm-avatar crm-avatar-lg" aria-hidden="true">{initials}</span>
        <div><h1>{customer.name || 'Unnamed customer'}</h1>
          <p className="crm-muted">{formatPhone(customer.phone) || 'No phone'}{customer.email ? ` · ${customer.email}` : ''}</p></div>
      </div>
      <div className="crm-head-actions">
        {customer.phone && <a className="crm-button crm-button-primary" href={`tel:${customer.phone}`}><Icon name="phone" size={15} />Call</a>}
        {customer.phone && <a className="crm-button" href={`sms:${customer.phone}`}><Icon name="message" size={15} />Text</a>}
        {customer.email && <a className="crm-button" href={`mailto:${customer.email}`}><Icon name="mail" size={15} />Email</a>}
      </div>
    </div>
    <CustomerActions customerId={id} properties={ownProperties.map(property => ({ id: property.id, address: property.address }))} />
    <section className="crm-panel service-customer-schedules" aria-label="Service schedules">
      <h2>Service schedules ({agreements.length})</h2>
      {agreements.length ? agreements.map(agreement => {
        const next = nextPlanVisit(agreement.id)
        const description = agreement.service_labels?.name ?? visitService(
          Array.isArray(agreement.items_template) ? agreement.items_template as { kind?: unknown; description?: unknown }[] : []
        ) ?? 'Service schedule'
        return <div className="crm-customer-entry service-customer-row" key={agreement.id} id={`schedule-${agreement.id}`}>
          <div>
            <strong>{description} · {money(agreement.price_per_visit)} per visit</strong>
            <span>{addressById.get(agreement.property_id) ?? 'Property'} · {scheduleLabel(definitions.get(agreement.id) ?? null, agreement)}</span>
            <span>{agreement.schedule_review_reason ?? (agreement.status === 'paused' ? 'Paused' : agreement.status === 'ended' ? 'Ended'
              : next ? `Next ${dateText(visitDate(next))}${visitDate(next)! < today ? ' · Overdue' : ''}` : 'No visits in the current window')}</span>
          </div>
          {agreement.status !== 'ended' && <div className="work-visit-actions">
            <Link className="crm-button crm-button-sm" href={serviceEditorHref(id, { schedule: agreement.id })}>
              {agreement.schedule_review_reason ? 'Review schedule' : 'Edit schedule'}</Link>
            {agreement.service_label_id && <Link className="crm-button crm-button-sm" href={serviceEditorHref(id, { schedule: agreement.id, extra: true })}>Add extra visit</Link>}
          </div>}
        </div>
      }) : <p className="crm-muted">No repeating services yet.</p>}
    </section>
    <UpcomingVisits visits={upcomingVisits} />
    <div className="crm-customer-sections">
      <section className="crm-panel crm-customer-wide"><h2>Past visits ({pastJobs.length})</h2>
        {pastJobs.length ? pastJobs.map(job => <div className="crm-customer-entry" key={job.id}>
          <div>
            <Link href={`/admin/jobs/${job.id}`}>{job.address || "Open visit"}</Link>
            <span>{dateText(job.confirmed_date || job.preferred_date || job.created_at)} · {money(jobPrice(job))} job total
              {job.accepted_quote_snapshot ? ' · Accepted quote preserved' : ''}</span>
            {job.lead_id && <Link href={`/admin/leads/${job.lead_id}`}>Open linked lead →</Link>}
          </div>
          <span className={`admin-badge admin-badge-${job.status}`}>{jobStatusLabel(job.status)}</span>
        </div>) : <p className="crm-muted">No finished visits yet.</p>}
      </section>
      <section className="crm-panel"><h2>Properties ({ownProperties.length})</h2>
        {ownProperties.length ? ownProperties.map(property => <div className="crm-customer-entry" key={property.id}>
          <div>
            <strong>{property.address}</strong>
            <span>{visitCount(jobs.filter(job => job.property_id === property.id).length)}{property.measured_at ? ` · Measured ${dateText(property.measured_at)}` : ''}</span>
          </div>
        </div>) : <p className="crm-muted">No property linked yet.</p>}
      </section>
      <section className="crm-panel"><h2>Payments ({payments.length + historicalAmounts.length})</h2>
        {payments.length ? payments.map(payment => <div className="crm-customer-entry" key={payment.id}>
          <div>
            <strong>{money(payment.amount)} · {payment.method}</strong>
            <span>{dateText(payment.paid_on)} · {payment.provenance === 'manual' ? 'Staff recorded' : 'Processor verified'}</span>
          </div>
        </div>) : null}
        {historicalAmounts.length > 0 && <><h3>Historical recorded amounts</h3><p className="crm-muted">Kept separately from dated payments; these records have not been reconciled.</p>
          {historicalAmounts.map(job => <div className="crm-customer-entry" key={job.id}>
            <div>
              <strong>{money(job.amount_charged)} · {job.payment_method || 'Method unknown'}</strong>
              <span>{job.address} · Paid date unverified{job.payment_recorded_at ? ` · Recorded ${dateText(job.payment_recorded_at)}` : ''}</span>
            </div>
          </div>)}</>}
        {payments.length === 0 && historicalAmounts.length === 0 && <p className="crm-muted">No payments recorded for linked visits.</p>}
      </section>
      <section className="crm-panel"><h2>Leads ({leads.length})</h2>
        {leads.length ? leads.map(lead => <div className="crm-customer-entry" key={lead.id}>
          <div>
            <Link href={`/admin/leads/${lead.id}`}><strong>{lead.address || 'Address pending'} →</strong></Link>
            <span>{dateText(lead.created_at)} · {lead.stage}</span>
          </div>
        </div>) : <p className="crm-muted">No lead linked to this customer.</p>}
      </section>
    </div>
  </main>
}
