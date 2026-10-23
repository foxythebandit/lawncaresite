import { getAgreements, getBookings, getCustomers, getExtraCharges, getJobPayments } from '../actions'
import CompletedJobRow from './CompletedJobRow'
import RecurringClientRow from './RecurringClientRow'
import ExtraCharges from './ExtraCharges'
import { formatMoney, formatMoneyWhole, jobPrice, mowingForecast } from '@/lib/crm-jobs'

export const dynamic = 'force-dynamic'

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7)
}

function monthLabel(key: string) {
  return new Date(key + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

const MOWS_PER_YEAR = 30

export default async function RevenuePage() {
  const [all, extras, payments, agreements, identities] = await Promise.all([
    getBookings(), getExtraCharges(), getJobPayments(), getAgreements(), getCustomers(),
  ])

  const completed = all.filter(b => b.status === 'completed' && b.completed_at)
  completed.sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))

  const monthMap = new Map<string, number>()
  for (const payment of payments) {
    const k = monthKey(payment.paid_on)
    monthMap.set(k, (monthMap.get(k) ?? 0) + Number(payment.amount))
  }
  const monthly = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const extrasTotal   = extras.reduce((s, c) => s + c.amount, 0)
  const totalPaid     = payments.reduce((s, p) => s + Number(p.amount), 0)
  const legacyRecorded = completed
    .reduce((s, b) => s + Number(b.amount_charged ?? 0), 0) + extrasTotal
  const maxVal        = Math.max(...monthly.map(([, v]) => v), 1)

  const recurringClients = mowingForecast(all, agreements, identities.customers)

  const expectedAnnualTotal = recurringClients.reduce((s, c) => s + c.annual, 0)
  const maxAnnual = Math.max(...recurringClients.map(c => c.annual), 1)

  // Keep same-phone properties distinct for staff review in the legacy charge picker.
  const clientByProperty = new Map<string, { key: string; name: string; phone: string; address: string }>()
  for (const b of all) {
    const key = `${b.phone}:${b.address.trim().toLowerCase()}`
    if (b.phone && !clientByProperty.has(key)) clientByProperty.set(key, {
      key, name: b.name, phone: b.phone, address: b.address,
    })
  }
  const clients = [...clientByProperty.values()].sort((a, b) => a.name.localeCompare(b.name))

  const latestMonth = monthly.length ? monthly[monthly.length - 1][0] : null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const paidThisMonth = payments.filter(p => p.paid_on.slice(0, 7) === today.slice(0, 7)).reduce((sum, p) => sum + Number(p.amount), 0)
  const upcomingBooked = all.filter(b => b.status === 'confirmed' && (b.confirmed_date ?? '') >= today).reduce((sum, b) => sum + jobPrice(b), 0)

  return (
    <div className="crm-page">
      <div className="crm-page-heading">
        <div><h1>Revenue</h1><p className="crm-muted">Recorded payments, scheduled work, and the conservative mowing forecast.</p></div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">{formatMoneyWhole(totalPaid)}</span>
          <span className="admin-stat-label">Paid all time</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">{formatMoneyWhole(paidThisMonth)}</span>
          <span className="admin-stat-label">Paid this month</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">{formatMoneyWhole(upcomingBooked)}</span>
          <span className="admin-stat-label">Upcoming booked</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val">{completed.length}</span>
          <span className="admin-stat-label">Completed jobs</span>
        </div>
      </div>
      {legacyRecorded > 0 && <p className="admin-revenue-sub">Plus {formatMoney(legacyRecorded)} recorded on older jobs and extra charges before dated payments existed. Those amounts aren’t in the totals or chart above.</p>}

      <div className="admin-revenue-stack">
        <section className="admin-revenue-card">
          <div className="admin-revenue-card-title">Monthly job payments recorded by paid date</div>
          {monthly.length === 0 ? (
            <div className="admin-empty">No revenue yet.</div>
          ) : (
            <figure aria-label="Monthly job payments bar chart">
              <div className="admin-chart">
                <div className="admin-chart-grid" aria-hidden="true">
                  {[1, 0.5, 0].map(pct => <span key={pct}><em>{formatMoneyWhole(maxVal * pct)}</em></span>)}
                </div>
                {monthly.map(([key, val]) => (
                  <div key={key} className="admin-chart-col" title={`${monthLabel(key)}: ${formatMoney(val)}`}>
                    {(key === latestMonth || val === maxVal) && <span className="admin-chart-val">{formatMoneyWhole(val)}</span>}
                    <div className="admin-chart-bar" style={{ height: `${Math.max((val / maxVal) * 100, 1.5)}%` }} />
                  </div>
                ))}
              </div>
              <div className="admin-chart-labels" aria-hidden="true">
                {monthly.map(([key]) => <span key={key}>{monthLabel(key)}</span>)}
              </div>
              <table className="sr-only">
                <caption>Monthly job payments</caption>
                <tbody>{monthly.map(([key, val]) => <tr key={key}><th>{monthLabel(key)}</th><td>{formatMoney(val)}</td></tr>)}</tbody>
              </table>
            </figure>
          )}
        </section>

        <section className="admin-revenue-card">
          <div className="admin-revenue-card-title">Conservative annual mowing forecast</div>
          {recurringClients.length === 0 ? (
            <div className="admin-empty">No active recurring customers yet.</div>
          ) : (
            <>
              <div className="admin-expected-total">
                {formatMoneyWhole(expectedAnnualTotal)}
                <span>/ year across {recurringClients.length} mowing relationship{recurringClients.length === 1 ? '' : 's'} · ~{MOWS_PER_YEAR} mows each. Excludes non-mowing agreements.</span>
              </div>
              <div className="admin-expected-bars">
                {recurringClients.map(c => (
                  <RecurringClientRow
                    key={c.id}
                    id={c.id}
                    href={c.href}
                    name={c.name}
                    annual={c.annual}
                    perVisit={c.perVisit}
                    widthPct={(c.annual / maxAnnual) * 100}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <ExtraCharges charges={extras} clients={clients} />

        {completed.length > 0 && (
          <section className="admin-revenue-card">
            <div className="admin-revenue-card-title">Completed jobs <small className="crm-muted" style={{ fontWeight: 400 }}>{completed.length}</small></div>
            <div className="admin-table-wrap">
              <table className="admin-revenue-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Address</th>
                    <th>Price</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map(b => (
                    <CompletedJobRow key={b.id} job={b} payments={payments.filter(p => p.booking_id === b.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
