import { getAgreements, getBookings, getCustomers, getExtraCharges, getJobPayments } from '../actions'
import CompletedJobRow from './CompletedJobRow'
import RecurringClientRow from './RecurringClientRow'
import ExtraCharges from './ExtraCharges'
import { jobPrice, mowingForecast } from '@/lib/crm-jobs'

export const dynamic = 'force-dynamic'

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7)
}

function monthLabel(key: string) {
  return new Date(key + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function formatDate(dateStr: string) {
  return new Date(dateStr.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
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
  const legacyRecorded = completed.filter(b => !payments.some(p => p.booking_id === b.id))
    .reduce((s, b) => s + Number(b.amount_charged ?? 0), 0) + extrasTotal
  const avgPerMonth   = monthly.length ? totalPaid / monthly.length : 0
  const maxVal        = Math.max(...monthly.map(([, v]) => v), 1)

  const confirmedMRR = all.filter(b => b.status === 'confirmed')
    .reduce((s, b) => s + jobPrice(b), 0)

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

  // SVG chart dimensions
  const chartW = 560
  const chartH = 180
  const barCount = monthly.length || 1
  const colW = chartW / barCount
  const barW = Math.min(36, colW - 12)

  return (
    <>
      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${totalPaid.toLocaleString()}</span>
          <span className="admin-stat-label">Job payments recorded</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${Math.round(avgPerMonth).toLocaleString()}</span>
          <span className="admin-stat-label">Avg payment month</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${confirmedMRR.toLocaleString()}</span>
          <span className="admin-stat-label">Scheduled work value</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${legacyRecorded.toLocaleString()}</span>
          <span className="admin-stat-label">Legacy amount records</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{completed.length}</span>
          <span className="admin-stat-label">Jobs completed</span>
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        <div className="admin-revenue-card">
          <div className="admin-revenue-card-title">Monthly job payments recorded by paid date</div>
          {monthly.length === 0 ? (
            <div className="admin-empty" style={{ padding: '40px 20px' }}>No revenue yet.</div>
          ) : (
            <svg
              viewBox={`0 0 ${chartW} ${chartH + 36}`}
              className="admin-revenue-svg"
              aria-label="Monthly revenue bar chart"
            >
              {/* Gridlines */}
              {[0.25, 0.5, 0.75, 1].map(pct => {
                const y = chartH - pct * chartH
                return (
                  <g key={pct}>
                    <line x1={0} y1={y} x2={chartW} y2={y} stroke="var(--rule)" strokeWidth={1} />
                    <text x={2} y={y - 3} fontSize={9} fill="var(--ink-soft)">
                      ${Math.round(maxVal * pct).toLocaleString()}
                    </text>
                  </g>
                )
              })}

              {/* Bars */}
              {monthly.map(([key, val], i) => {
                const barH = Math.max((val / maxVal) * chartH, 2)
                const cx = i * colW + colW / 2
                const x = cx - barW / 2
                const y = chartH - barH
                return (
                  <g key={key}>
                    <rect x={x} y={y} width={barW} height={barH} rx={4} fill="var(--green-bright)" />
                    <text x={cx} y={chartH + 14} textAnchor="middle" fontSize={10} fill="var(--ink-soft)">
                      {monthLabel(key)}
                    </text>
                    <text x={cx} y={y - 5} textAnchor="middle" fontSize={10} fill="var(--green-mid)" fontWeight={600}>
                      ${Math.round(val).toLocaleString()}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        <div className="admin-revenue-card" style={{ marginTop: 12 }}>
          <div className="admin-revenue-card-title">Conservative Annual Mowing Forecast</div>
          {recurringClients.length === 0 ? (
            <div className="admin-empty" style={{ padding: '40px 20px' }}>No active recurring customers yet.</div>
          ) : (
            <>
              <div className="admin-expected-total">
                ${expectedAnnualTotal.toLocaleString()}
                <span> / year across {recurringClients.length} mowing relationship{recurringClients.length === 1 ? '' : 's'} · ~{MOWS_PER_YEAR} mows each. Excludes non-mowing agreements.</span>
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
        </div>

        <ExtraCharges charges={extras} clients={clients} />

        {completed.length > 0 && (
          <div className="admin-revenue-card" style={{ marginTop: 12 }}>
            <div className="admin-revenue-card-title">Completed Jobs</div>
            <table className="admin-revenue-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Address</th>
                  <th>Method</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {completed.map(b => (
                  <CompletedJobRow key={b.id} job={b} payments={payments.filter(p => p.booking_id === b.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
