import { getBookings } from '../../actions'
import Link from 'next/link'

function formatDate(s: string) {
  return new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default async function ClientPage({ params }: { params: Promise<{ phone: string }> }) {
  const { phone: raw } = await params
  const phone = decodeURIComponent(raw)
  const all   = await getBookings()

  const visits = all
    .filter(b => b.phone === phone)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  if (visits.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Link href="/admin" className="admin-client-back">← All clients</Link>
        <div className="admin-empty">Client not found.</div>
      </div>
    )
  }

  const client    = visits[0]
  const completed = visits.filter(b => b.status === 'completed')
  const totalSpent = completed.reduce((s, b) => s + (b.amount_charged ?? 0), 0)
  const nextVisit  = visits.find(b => b.status === 'confirmed' && b.confirmed_date)

  return (
    <>
      <div className="admin-client-header">
        <Link href="/admin" className="admin-client-back">← All clients</Link>
        <h1 className="admin-client-name">{client.name}</h1>
        <div className="admin-client-meta">
          <a href={`tel:${client.phone}`} style={{ color: 'var(--green-mid)', textDecoration: 'none' }}>{client.phone}</a>
          {client.email && <> · <a href={`mailto:${client.email}`} style={{ color: 'var(--green-mid)', textDecoration: 'none' }}>{client.email}</a></>}
        </div>
        <div className="admin-client-addr">{client.address} · {client.sq_ft?.toLocaleString()} sq ft · {client.frequency}</div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{visits.length}</span>
          <span className="admin-stat-label">Total visits</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{completed.length}</span>
          <span className="admin-stat-label">Completed</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${totalSpent.toLocaleString()}</span>
          <span className="admin-stat-label">Total spent</span>
        </div>
        {nextVisit?.confirmed_date && (
          <>
            <div className="admin-stat-divider" />
            <div className="admin-stat">
              <span className="admin-stat-val" style={{ fontSize: 15, fontFamily: 'var(--font-body)', fontWeight: 500 }}>
                {formatDate(nextVisit.confirmed_date)}
              </span>
              <span className="admin-stat-label">Next visit</span>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: '16px' }}>
        <div className="admin-revenue-card">
          <div className="admin-revenue-card-title">Visit History</div>
          {visits.map(b => {
            const dateStr = (b.completed_at ?? b.confirmed_date ?? b.preferred_date ?? b.created_at).slice(0, 10)
            return (
              <div key={b.id} className="admin-client-visit">
                <div className="admin-client-visit-date">{formatDate(dateStr)}</div>
                <div className="admin-client-visit-info">
                  <span className={`admin-badge admin-badge-${b.status}`}>{b.status}</span>
                  {b.frequency && <span className="admin-client-visit-freq">{b.frequency}</span>}
                  {b.notes && <span className="admin-client-visit-note" title={b.notes}>📝</span>}
                </div>
                <div className="admin-client-visit-right">
                  {b.amount_charged != null
                    ? <span style={{ fontWeight: 600, color: 'var(--green-mid)' }}>${b.amount_charged.toFixed(2)}</span>
                    : b.price_per_visit != null
                    ? <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>${b.price_per_visit}/visit</span>
                    : null}
                  {b.payment_method && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{b.payment_method}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
