import { getBookings } from './actions'
import BookingCard from './BookingCard'
import AdminSearch from './AdminSearch'
import AdminMap from './AdminMap'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; search?: string }>
}) {
  const { filter = 'all', search = '' } = await searchParams
  const all = await getBookings()

  const now = new Date()
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7)

  const q = search.toLowerCase().trim()
  const searched = q
    ? all.filter(b =>
        b.name?.toLowerCase().includes(q) ||
        b.address?.toLowerCase().includes(q) ||
        b.phone?.toLowerCase().includes(q) ||
        b.email?.toLowerCase().includes(q)
      )
    : all

  const filtered = searched.filter(b => {
    if (filter === 'pending')   return b.status === 'pending'
    if (filter === 'confirmed') return b.status === 'confirmed'
    if (filter === 'week') {
      if (!b.preferred_date) return false
      const d = new Date(b.preferred_date + 'T12:00:00')
      return d >= now && d <= weekEnd
    }
    return true
  })

  const pendingCount   = all.filter(b => b.status === 'pending').length
  const confirmedCount = all.filter(b => b.status === 'confirmed').length
  const weekCount      = all.filter(b => {
    if (!b.preferred_date) return false
    const d = new Date(b.preferred_date + 'T12:00:00')
    return d >= now && d <= weekEnd
  }).length

  const confirmedBookings = all.filter(b => b.status === 'confirmed')
  const totalFirstVisit   = confirmedBookings.reduce((s, b) => s + (b.first_visit_price ?? 0), 0)
  const monthlyRecurring  = confirmedBookings.reduce((s, b) => s + (b.price_per_visit ?? 0), 0)

  return (
    <>
      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{pendingCount}</span>
          <span className="admin-stat-label">Pending</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{confirmedCount}</span>
          <span className="admin-stat-label">Confirmed</span>
        </div>
        <div className="admin-stat-divider" />
        <a href="/admin/route" className="admin-stat admin-stat-link">
          <span className="admin-stat-val">{weekCount}</span>
          <span className="admin-stat-label">This week ↗</span>
        </a>
        <div className="admin-stat-divider" />
        <a href="/admin/revenue" className="admin-stat admin-stat-link">
          <span className="admin-stat-val admin-stat-money">${totalFirstVisit.toLocaleString()}</span>
          <span className="admin-stat-label">First-visit rev ↗</span>
        </a>
        <div className="admin-stat-divider" />
        <a href="/admin/revenue" className="admin-stat admin-stat-link">
          <span className="admin-stat-val admin-stat-money">${monthlyRecurring.toLocaleString()}</span>
          <span className="admin-stat-label">Monthly rate ↗</span>
        </a>
      </div>

      <div className="admin-toolbar">
        <div className="admin-filters">
          {[
            { key: 'all',       label: 'All'       },
            { key: 'pending',   label: 'Pending'   },
            { key: 'confirmed', label: 'Confirmed' },
            { key: 'week',      label: 'This week' },
          ].map(f => (
            <a key={f.key} href={`/admin?filter=${f.key}${q ? `&search=${encodeURIComponent(q)}` : ''}`} className={`admin-filter-btn ${filter === f.key ? 'active' : ''}`}>
              {f.label}
            </a>
          ))}
        </div>
        <AdminSearch defaultValue={search} filter={filter} />
      </div>

      <div className="admin-body" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '12px', padding: '12px 16px 24px', alignItems: 'start' }}>
        <div className="admin-list">
          {filtered.length === 0 ? (
            <div className="admin-empty">
              {q ? `No bookings matching "${search}".` : 'No bookings here yet.'}
            </div>
          ) : (
            filtered.map(b => <BookingCard key={b.id} booking={b as any} />)
          )}
        </div>

        <AdminMap bookings={all.map(b => ({
          id: b.id,
          name: b.name,
          address: b.address,
          status: b.status,
          price_per_visit: b.price_per_visit ?? null,
        }))} />
      </div>
    </>
  )
}
