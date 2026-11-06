import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAgreements, getBookings, getCustomers, getJobPayments, getLeads } from '../../actions'
import { cadenceText, formatMoney, isMowingPlan, jobPrice, jobStatusLabel, planName, type JobLine } from '@/lib/crm-jobs'
import { requireStaff } from '@/lib/staff'
import Icon from '../../icons'
import CustomerActions from './CustomerActions'
import type { EditablePlan } from './PlanEditor'
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
    getCustomers(), getBookings(), getLeads(), getJobPayments(), getAgreements(),
  ])
  const customer = customers.find(row => row.id === id)
  if (!customer) notFound()
  const ownProperties = properties.filter(row => row.customer_id === id)
  const jobs = allJobs.filter(row => row.customer_id === id)
  const leads = allLeads.filter(row => row.customer_id === id)
  const jobIds = new Set(jobs.map(row => row.id))
  const payments = allPayments.filter(row => jobIds.has(row.booking_id))
  const historicalAmounts = jobs.filter(row => row.amount_charged != null)
  const agreements = allAgreements.filter(row => row.customer_id === id)
    .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
  const addressById = new Map(ownProperties.map(row => [row.id, row.address]))

  // Open visits first, soonest (and overdue) on top; everything else is history, newest first.
  const visitDate = (job: (typeof jobs)[number]) => (job.confirmed_date ?? job.preferred_date ?? null) as string | null
  const isOpen = (job: (typeof jobs)[number]) => ['pending', 'confirmed'].includes(job.status)
  const openJobs = jobs.filter(isOpen).sort((a, b) => (visitDate(a) ?? '').localeCompare(visitDate(b) ?? ''))
  const pastJobs = jobs.filter(job => !isOpen(job))
    .sort((a, b) => (visitDate(b) ?? b.created_at).localeCompare(visitDate(a) ?? a.created_at))
  const activePlans = agreements.filter(agreement => agreement.status === 'active')
  const nameOf = (agreementId: string | null) => {
    const agreement = agreements.find(row => row.id === agreementId)
    return agreement ? planName(agreement.items_template) : null
  }
  // A lead's recurring booking is mowing, so it joins the mowing plan when the property has several.
  const joinPlanFor = (propertyId: string | null) => {
    const here = activePlans.filter(plan => plan.property_id === propertyId)
    return here.find(plan => isMowingPlan(plan.items_template)) ?? here[0] ?? null
  }
  const needsPlan = (job: (typeof jobs)[number]) => !job.agreement_id && !job.one_time
    && Boolean(job.frequency?.trim()) && !/^(one[ -]?time|single|once)$/i.test(job.frequency.trim())
  const upcomingVisits: UpcomingVisit[] = openJobs.map(job => ({
    id: job.id, updatedAt: job.updated_at, status: job.status, date: visitDate(job), time: job.confirmed_time ?? null,
    address: job.address, price: jobPrice(job), inPlan: Boolean(job.agreement_id), planName: nameOf(job.agreement_id),
    joinPlanId: needsPlan(job) ? joinPlanFor(job.property_id)?.id ?? null : null,
    joinPlanName: needsPlan(job) ? nameOf(joinPlanFor(job.property_id)?.id ?? null) : null,
    needsPlan: needsPlan(job),
  }))
  const nextPlanVisit = (agreementId: string) => openJobs.find(job => job.agreement_id === agreementId)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  // Plans staff can still change (ended plans are history). The pause/end preview matches the
  // server's: unfinished plan visits dated today or later, or with no date.
  const editablePlans: EditablePlan[] = agreements.filter(agreement => agreement.status !== 'ended').map(agreement => {
    const next = nextPlanVisit(agreement.id)
    const items = (Array.isArray(agreement.items_template) ? agreement.items_template : []) as JobLine[]
    return {
      id: agreement.id, updatedAt: agreement.updated_at, status: agreement.status, name: planName(items),
      address: addressById.get(agreement.property_id) || 'Property', items, price: Number(agreement.price_per_visit ?? 0),
      intervalUnit: agreement.interval_unit, intervalCount: agreement.interval_count,
      next: next ? { id: next.id, updatedAt: next.updated_at, date: visitDate(next), occurrenceOn: next.occurrence_on ?? visitDate(next),
        time: next.confirmed_time ?? null, price: jobPrice(next) } : null,
      futureVisits: openJobs.filter(job => job.agreement_id === agreement.id && (!visitDate(job) || visitDate(job)! >= today))
        .map(job => ({ id: job.id, date: visitDate(job) })),
    }
  })

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
    <CustomerActions customerId={id} plans={editablePlans} firstName={String(customer.name ?? '').trim().split(/\s+/)[0] || 'the customer'}
      canEmail={Boolean(customer.email) && Boolean(process.env.RESEND_API_KEY)}
      properties={ownProperties.map(property => ({ id: property.id, address: property.address,
      plans: editablePlans.filter(plan => agreements.find(a => a.id === plan.id)?.property_id === property.id).map(plan => plan.name),
      // A recurring visit already booked here (from a lead) can be the plan's first visit instead of a duplicate.
      openVisits: openJobs.filter(job => job.property_id === property.id && !job.agreement_id)
        .map(job => ({ id: job.id, date: visitDate(job), price: Number(job.price_per_visit ?? jobPrice(job)), recurring: needsPlan(job) })) }))} />
    {editablePlans.map(plan => {
      const nextDate = plan.next?.date ?? null
      return <div className="crm-plan-card" key={plan.id}>
        <div>
          <strong>{plan.name} · {cadenceText(plan.intervalUnit, plan.intervalCount)} · {money(plan.price)}/visit{plan.status === 'paused' ? ' · Paused' : ''}</strong>
          <span>{plan.address} · {plan.status === 'paused' ? 'no visits until it resumes (Edit plan → Resume)' : plan.next
            ? `next visit ${dateText(nextDate)}${nextDate && nextDate < today ? ' (overdue — mark it done or move it)' : ''}`
            : 'no visit booked (Edit plan → Book the next visit)'}</span>
        </div>
      </div>
    })}
    <UpcomingVisits visits={upcomingVisits} firstName={String(customer.name ?? '').trim().split(/\s+/)[0] || 'the customer'}
      hasEmail={Boolean(customer.email)} emailConfigured={Boolean(process.env.RESEND_API_KEY)} />
    <div className="crm-customer-sections">
      <section className="crm-panel crm-customer-wide"><h2>Past visits ({pastJobs.length})</h2>
        {pastJobs.length ? pastJobs.map(job => <div className="crm-customer-entry" key={job.id}>
          <div>
            <strong>{job.address}</strong>
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
      <section className="crm-panel"><h2>Plans ({agreements.length})</h2>
        {agreements.length ? agreements.map(agreement => <div className="crm-customer-entry" key={agreement.id}>
          <div>
            <strong>{planName(agreement.items_template)} · {addressById.get(agreement.property_id) || 'Property'}</strong>
            <span>{cadenceText(agreement.interval_unit, agreement.interval_count).replace(/^e/, 'E')} · {agreement.status === 'active' ? `Next ${nextPlanVisit(agreement.id) ? dateText(visitDate(nextPlanVisit(agreement.id)!)) : 'not booked'} · ` : ''}{money(agreement.price_per_visit)} per visit</span>
          </div>
          <span className={`admin-badge admin-badge-${agreement.status === 'active' ? 'confirmed' : agreement.status === 'paused' ? 'pending' : 'canceled'}`}>{agreement.status.charAt(0).toUpperCase() + agreement.status.slice(1)}</span>
        </div>) : <p className="crm-muted">No plan yet.</p>}
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
