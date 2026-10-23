import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAgreements, getBookings, getCustomers, getJobPayments, getLeads } from '../../actions'
import { formatMoney, jobPrice, jobStatusLabel } from '@/lib/crm-jobs'
import { requireStaff } from '@/lib/staff'
import Icon from '../../icons'
import CustomerActions from './CustomerActions'

export const dynamic = 'force-dynamic'

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dateText(value: string | null) {
  if (!value) return 'Not scheduled'
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric' })
}

const money = formatMoney

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
  const upcoming = (status: string) => ['pending', 'confirmed'].includes(status) ? 0 : 1
  const jobs = allJobs.filter(row => row.customer_id === id).sort((a, b) => upcoming(a.status) - upcoming(b.status))
  const leads = allLeads.filter(row => row.customer_id === id)
  const jobIds = new Set(jobs.map(row => row.id))
  const payments = allPayments.filter(row => jobIds.has(row.booking_id))
  const historicalAmounts = jobs.filter(row => row.amount_charged != null)
  const agreements = allAgreements.filter(row => row.customer_id === id)
  const addressById = new Map(ownProperties.map(row => [row.id, row.address]))

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
        {customer.email && <a className="crm-button" href={`mailto:${customer.email}`}><Icon name="mail" size={15} />Email</a>}
        {customer.phone && <a className="crm-button" href={`sms:${customer.phone}`}><Icon name="message" size={15} />Text</a>}
        {customer.phone && <a className="crm-button crm-button-primary" href={`tel:${customer.phone}`}><Icon name="phone" size={15} />Call</a>}
      </div>
    </div>
    <CustomerActions customerId={id} properties={ownProperties.map(property => ({ id: property.id, address: property.address,
      hasActivePlan: agreements.some(agreement => agreement.property_id === property.id && ['active', 'paused'].includes(agreement.status)) }))} />
    {agreements.filter(agreement => agreement.status === 'active').map(agreement => <div className="crm-plan-card" key={agreement.id}>
      <div>
        <strong>Mowing plan · every {agreement.interval_count === 1 ? '' : `${agreement.interval_count} `}{agreement.interval_unit}{agreement.interval_count === 1 ? '' : 's'} · {money(agreement.price_per_visit)}/visit</strong>
        <span>{addressById.get(agreement.property_id) || 'Property'} · next visit {dateText(agreement.next_on)}</span>
      </div>
      <Link className="crm-button crm-button-sm" href={`/admin?search=${encodeURIComponent(customer.name ?? '')}`}>Manage visits</Link>
    </div>)}
    <div className="crm-customer-sections">
      <section className="crm-panel crm-customer-wide"><h2>Visits ({jobs.length})</h2>
        {jobs.length ? jobs.map(job => <div className="crm-customer-entry" key={job.id}>
          <div>
            <strong>{job.address}</strong>
            <span>{dateText(job.confirmed_date || job.preferred_date || job.created_at)} · {money(jobPrice(job))} job total
              {job.accepted_quote_snapshot ? ' · Accepted quote preserved' : ''}</span>
            {job.lead_id && <Link href={`/admin/leads/${job.lead_id}`}>Open linked lead →</Link>}
          </div>
          <span className={`admin-badge admin-badge-${job.status}`}>{jobStatusLabel(job.status)}</span>
        </div>) : <p className="crm-muted">No linked visits yet.</p>}
      </section>
      <section className="crm-panel"><h2>Properties ({ownProperties.length})</h2>
        {ownProperties.length ? ownProperties.map(property => <div className="crm-customer-entry" key={property.id}>
          <div>
            <strong>{property.address}</strong>
            <span>{jobs.filter(job => job.property_id === property.id).length} visits{property.measured_at ? ` · Measured ${dateText(property.measured_at)}` : ''}</span>
          </div>
        </div>) : <p className="crm-muted">No property linked yet.</p>}
      </section>
      <section className="crm-panel"><h2>Mowing plans ({agreements.length})</h2>
        {agreements.length ? agreements.map(agreement => <div className="crm-customer-entry" key={agreement.id}>
          <div>
            <strong>{addressById.get(agreement.property_id) || 'Property'}</strong>
            <span>Every {agreement.interval_count} {agreement.interval_unit}{agreement.interval_count === 1 ? '' : 's'} · Next {dateText(agreement.next_on)} · {money(agreement.price_per_visit)} per visit</span>
          </div>
          <span className={`admin-badge admin-badge-${agreement.status === 'active' ? 'confirmed' : agreement.status === 'paused' ? 'pending' : 'canceled'}`}>{agreement.status.charAt(0).toUpperCase() + agreement.status.slice(1)}</span>
        </div>) : <p className="crm-muted">No mowing plan.</p>}
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
