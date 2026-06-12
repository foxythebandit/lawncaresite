import { getBookings } from '../actions'

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

export default async function RevenuePage() {
  const all = await getBookings()

  const completed = all.filter(b => b.status === 'completed' && b.completed_at && b.amount_charged)
  completed.sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))

  const monthMap = new Map<string, number>()
  for (const b of completed) {
    const k = monthKey(b.completed_at!)
    monthMap.set(k, (monthMap.get(k) ?? 0) + (b.amount_charged ?? 0))
  }
  const monthly = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const totalEarned   = completed.reduce((s, b) => s + (b.amount_charged ?? 0), 0)
  const avgPerMonth   = monthly.length ? totalEarned / monthly.length : 0
  const maxVal        = Math.max(...monthly.map(([, v]) => v), 1)

  const confirmedMRR = all
    .filter(b => b.status === 'confirmed' && b.price_per_visit)
    .reduce((s, b) => s + (b.price_per_visit ?? 0), 0)

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
          <span className="admin-stat-val admin-stat-money">${totalEarned.toLocaleString()}</span>
          <span className="admin-stat-label">Total earned</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${Math.round(avgPerMonth).toLocaleString()}</span>
          <span className="admin-stat-label">Avg / month</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${confirmedMRR.toLocaleString()}</span>
          <span className="admin-stat-label">Recurring / visit</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{completed.length}</span>
          <span className="admin-stat-label">Jobs completed</span>
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        <div className="admin-revenue-card">
          <div className="admin-revenue-card-title">Monthly Revenue</div>
          {monthly.length === 0 ? (
            <div className="admin-empty" style={{ padding: '40px 20px' }}>No completed jobs yet.</div>
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
                      ${val.toLocaleString()}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

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
                  <tr key={b.id}>
                    <td>{formatDate(b.completed_at!)}</td>
                    <td style={{ fontWeight: 500 }}>{b.name}</td>
                    <td style={{ color: 'var(--ink-soft)' }}>{b.address}</td>
                    <td>{b.payment_method ?? '—'}</td>
                    <td style={{ fontWeight: 600, color: 'var(--green-mid)' }}>${(b.amount_charged ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
