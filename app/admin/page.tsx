import { getAgreements, getBookings, getCustomers, getJobItems, getJobPayments } from './actions'
import BookingCard from './BookingCard'
import AdminSearch from './AdminSearch'
import AdminMap from './AdminMap'
import CalendarView from './CalendarView'
import { jobPrice } from '@/lib/crm-jobs'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; search?: string; view?: string }>
}) {
  const { filter = 'all', search = '', view = 'list' } = await searchParams
  const [all, identities, agreements, allItems, allPayments] = await Promise.all([
    getBookings(), getCustomers(), getAgreements(), getJobItems(), getJobPayments(),
  ])

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
  const totalFirstVisit   = confirmedBookings.reduce((s, b) => s + jobPrice(b), 0)
  const monthlyRecurring  = confirmedBookings.filter(b => b.agreement_id).reduce((s, b) => s + jobPrice(b), 0)

  const visitCounts = new Map<string, number>()
  for (const b of all) {
    const key = b.customer_id ?? b.id
    visitCounts.set(key, (visitCounts.get(key) ?? 0) + 1)
  }
  const chicagoParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const chicagoDate = `${chicagoParts.find(p => p.type === 'year')?.value}-${chicagoParts.find(p => p.type === 'month')?.value}-${chicagoParts.find(p => p.type === 'day')?.value}`

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
        <a href="/admin/week" className="admin-stat admin-stat-link">
          <span className="admin-stat-val">{weekCount}</span>
          <span className="admin-stat-label">This week ↗</span>
        </a>
        <div className="admin-stat-divider" />
        <a href="/admin/revenue" className="admin-stat admin-stat-link">
          <span className="admin-stat-val admin-stat-money">${totalFirstVisit.toLocaleString()}</span>
          <span className="admin-stat-label">Scheduled estimate ↗</span>
        </a>
        <div className="admin-stat-divider" />
        <a href="/admin/revenue" className="admin-stat admin-stat-link">
          <span className="admin-stat-val admin-stat-money">${monthlyRecurring.toLocaleString()}</span>
          <span className="admin-stat-label">Scheduled visit rate ↗</span>
        </a>
      </div>

      <div className="admin-toolbar">
        {view !== 'calendar' && (
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
        )}
        {view === 'calendar' && <div />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {view !== 'calendar' && <AdminSearch defaultValue={search} filter={filter} />}
          <div className="admin-view-toggle">
            <a href={`/admin?filter=${filter}${q ? `&search=${encodeURIComponent(q)}` : ''}`} className={`admin-view-btn${view !== 'calendar' ? ' active' : ''}`}>List</a>
            <a href={`/admin?view=calendar`} className={`admin-view-btn${view === 'calendar' ? ' active' : ''}`}>Calendar</a>
          </div>
        </div>
      </div>

      {view === 'calendar' ? (
        <CalendarView bookings={all.map(b => ({
          id: b.id,
          name: b.name,
          address: b.address,
          confirmed_date: b.confirmed_date ?? null,
          preferred_date: b.preferred_date ?? null,
          confirmed_time: b.confirmed_time ?? null,
          status: b.status,
          price_per_visit: jobPrice(b),
          customer_id: b.customer_id ?? null,
          phone: b.phone,
        }))} />
      ) : (
        <div className="admin-body" style={{ padding: '12px 16px 90px' }}>
          <div className="admin-list">
            {filtered.length === 0 ? (
              <div className="admin-empty">
                {q ? `No bookings matching "${search}".` : 'No bookings here yet.'}
              </div>
            ) : (
              filtered.map(b => (
                <BookingCard key={b.id} booking={b as any}
                  emailConfigured={Boolean(process.env.RESEND_API_KEY)}
                  historyCount={visitCounts.get(b.customer_id ?? b.id) ?? 1}
                  customers={identities.customers} properties={identities.properties}
                  agreement={agreements.find(a => a.id === b.agreement_id) as any}
                  futureJobIds={all.filter(row => row.agreement_id === b.agreement_id
                    && Boolean(b.agreement_id) && ['pending','confirmed'].includes(row.status)
                    && (!((row.confirmed_date ?? row.preferred_date ?? row.occurrence_on) as string | null)
                      || (row.confirmed_date ?? row.preferred_date ?? row.occurrence_on) >= chicagoDate))
                    .map(row => row.id).sort()}
                  items={allItems.filter(item => item.booking_id === b.id).map(item => ({
                    kind: item.kind as 'service' | 'discount', description: item.description,
                    amount: String(item.amount),
                  }))}
                  payments={allPayments.filter(payment => payment.booking_id === b.id)} />
              ))
            )}
          </div>

          <AdminMap bookings={all.map(b => ({
            id: b.id,
            name: b.name,
            address: b.address,
            status: b.status,
            price_per_visit: jobPrice(b),
          }))} />
        </div>
      )}
    </>
  )
}
