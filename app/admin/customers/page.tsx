import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import { getBookings, getCustomers } from '../actions'
import { requireStaff } from '@/lib/staff'

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
      <div><span className="crm-eyebrow">QuietGreen · Customer history</span><h1>Customers</h1>
        <p className="crm-muted">Linked customers, properties, and visit history.</p></div>
      <Link className="crm-button" href="/admin">View jobs →</Link>
    </div>
    <p className="crm-customer-help">A customer appears here after a staff member reviews and links a visit. Matching phone numbers alone do not combine records.</p>
    {customers.length === 0 ? <div className="admin-empty">No linked customers yet. Open a job to review and link its customer and property.</div>
      : <div className="crm-list">{customers.map(customer => <Link key={customer.id} className="crm-customer-card" href={`/admin/customers/${customer.id}`}>
        <span className="crm-customer-card-name">{customer.name || 'Unnamed customer'}</span>
        <span className="crm-customer-card-contact">{formatPhone(customer.phone) || customer.email || 'No contact details'}</span>
        <span className="crm-customer-card-counts">{propertyCount.get(customer.id) ?? 0} properties · {jobCount.get(customer.id) ?? 0} visits <span aria-hidden="true">→</span></span>
      </Link>)}</div>}
  </main>
}
