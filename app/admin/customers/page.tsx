import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import { getBookings, getCustomers } from '../actions'
import { requireStaff } from '@/lib/staff'
import Icon from '../icons'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  await requireStaff('/admin/customers')
  const [{ customers, properties }, jobs] = await Promise.all([getCustomers(), getBookings()])
  const propertyCount = new Map<string, number>()
  const jobCount = new Map<string, number>()
  for (const property of properties) propertyCount.set(property.customer_id, (propertyCount.get(property.customer_id) ?? 0) + 1)
  for (const job of jobs) if (job.customer_id) jobCount.set(job.customer_id, (jobCount.get(job.customer_id) ?? 0) + 1)

  return <main className="crm-page crm-customers-page">
    <div className="crm-page-heading">
      <div><h1>Customers</h1>
        <p className="crm-muted">Linked customers, properties, and visit history.</p></div>
    </div>
    <details className="crm-customer-help"><summary>How customers get here</summary>A customer appears here after a staff member reviews and links a visit. Matching phone numbers alone do not combine records.</details>
    {customers.length === 0 ? <div className="admin-empty">No linked customers yet. Open a job to review and link its customer and property.</div>
      : <div className="crm-list">{customers.map(customer => <Link key={customer.id} className="crm-customer-card" href={`/admin/customers/${customer.id}`}>
        <span className="crm-avatar" aria-hidden="true">{initials(customer.name)}</span>
        <span className="crm-customer-card-name">{customer.name || 'Unnamed customer'}</span>
        <span className="crm-customer-card-contact">{formatPhone(customer.phone) || customer.email || 'No contact details'}</span>
        <span className="crm-customer-card-counts">{plural(propertyCount.get(customer.id) ?? 0, 'property', 'properties')} · {plural(jobCount.get(customer.id) ?? 0, 'visit', 'visits')}</span>
        <Icon name="chevronRight" size={16} />
      </Link>)}</div>}
  </main>
}

function initials(name: string | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?'
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}
