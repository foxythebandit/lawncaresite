import { getBookings, logout } from './actions'
import BookingCard from './BookingCard'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const { filter = 'all' } = await searchParams
  const all = await getBookings()

  const now = new Date()
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7)

  const filtered = all.filter(b => {
    if (filter === 'pending')   return b.status === 'pending'
    if (filter === 'confirmed') return b.status === 'confirmed'
    if (filter === 'week') {
      if (!b.preferred_date) return false
      const d = new Date(b.preferred_date + 'T12:00:00')
      return d >= now && d <= weekEnd
    }
    return true
  })

  const pendingCount = all.filter(b => b.status === 'pending').length
  const weekCount    = all.filter(b => {
    if (!b.preferred_date) return false
    const d = new Date(b.preferred_date + 'T12:00:00')
    return d >= now && d <= weekEnd
  }).length

  return (
    <div className="admin-wrap">
      <header className="admin-header">
        <div className="admin-header-logo">
          <span className="logo-dot" style={{ background: 'var(--green-bright)', width: 9, height: 9, borderRadius: '50%', display: 'inline-block' }} />
          <span>QuietGreen</span>
        </div>
        <form action={logout}>
          <button type="submit" className="admin-logout">Sign out</button>
        </form>
      </header>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{pendingCount}</span>
          <span className="admin-stat-label">Pending</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{weekCount}</span>
          <span className="admin-stat-label">This week</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{all.length}</span>
          <span className="admin-stat-label">Total</span>
        </div>
      </div>

      <div className="admin-filters">
        {[
          { key: 'all',       label: 'All'       },
          { key: 'pending',   label: 'Pending'   },
          { key: 'confirmed', label: 'Confirmed' },
          { key: 'week',      label: 'This week' },
        ].map(f => (
          <a key={f.key} href={`/admin?filter=${f.key}`} className={`admin-filter-btn ${filter === f.key ? 'active' : ''}`}>
            {f.label}
          </a>
        ))}
      </div>

      <div className="admin-list">
        {filtered.length === 0 ? (
          <div className="admin-empty">No bookings here yet.</div>
        ) : (
          filtered.map(b => <BookingCard key={b.id} booking={b as any} />)
        )}
      </div>
    </div>
  )
}
