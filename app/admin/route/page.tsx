import { getBookings } from '../actions'
import DayJobs from '../DayJobs'

export const dynamic = 'force-dynamic'

export default async function RoutePage() {
  const all = await getBookings()
  const today = new Date().toISOString().split('T')[0]

  const jobs = all
    .filter(b => b.confirmed_date === today && b.status === 'confirmed')
    .sort((a, b) => (a.confirmed_time ?? '99:99').localeCompare(b.confirmed_time ?? '99:99'))

  const todayRevenue = jobs.reduce((s, b) => s + (b.price_per_visit ?? 0), 0)
  const todayLabel   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Build a multi-stop Google Maps URL for the full route
  const mapsUrl = jobs.length > 1
    ? `https://www.google.com/maps/dir/${jobs.map(b => encodeURIComponent(b.address)).join('/')}`
    : jobs.length === 1
    ? `https://maps.google.com/?q=${encodeURIComponent(jobs[0].address)}`
    : null

  return (
    <>
      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{jobs.length}</span>
          <span className="admin-stat-label">Jobs today</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${todayRevenue.toLocaleString()}</span>
          <span className="admin-stat-label">Today's revenue</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat" style={{ flex: 1, textAlign: 'left', paddingLeft: 20 }}>
          <span className="admin-stat-val" style={{ fontSize: 16, fontFamily: 'var(--font-body)', fontWeight: 500 }}>{todayLabel}</span>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="admin-route-all-btn">
              Full route ↗
            </a>
          )}
        </div>
      </div>

      <div style={{ padding: '12px 16px' }}>
        <DayJobs jobs={jobs} emptyLabel="No jobs confirmed for today." />
      </div>
    </>
  )
}
