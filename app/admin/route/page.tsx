import { getBookings } from '../actions'

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

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

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {jobs.length === 0 ? (
          <div className="admin-empty">No jobs confirmed for today.</div>
        ) : (
          jobs.map((b, i) => (
            <div key={b.id} className="admin-route-card">
              <div className="admin-route-stop">{i + 1}</div>
              <div className="admin-route-info">
                <div className="admin-route-name">{b.name}</div>
                <div className="admin-route-addr">{b.address}</div>
                <div className="admin-route-meta">
                  {b.confirmed_time && <span>{formatTime(b.confirmed_time)}</span>}
                  {b.sq_ft        && <span>{b.sq_ft.toLocaleString()} sq ft</span>}
                  {b.frequency    && <span>{b.frequency}</span>}
                  {b.price_per_visit && <span style={{ fontWeight: 600, color: 'var(--green-mid)' }}>${b.price_per_visit}/visit</span>}
                </div>
                {b.notes && <div className="admin-route-notes">{b.notes}</div>}
              </div>
              <div className="admin-route-actions">
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(b.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-route-nav-btn"
                >
                  Navigate
                </a>
                <a href={`tel:${b.phone}`} className="admin-route-call-btn">Call</a>
                <a href={`sms:${b.phone}`} className="admin-route-sms-btn">Text</a>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
