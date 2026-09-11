import { getBookings } from '../actions'
import DayJobs from '../DayJobs'

export const dynamic = 'force-dynamic'

function dateKey(d: Date) {
  return d.toISOString().split('T')[0]
}

export default async function WeekPage() {
  const all = await getBookings()

  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)
  const todayKey = dateKey(todayDate)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate)
    d.setDate(d.getDate() + i)
    const key = dateKey(d)
    const jobs = all
      .filter(b => b.confirmed_date === key && b.status === 'confirmed')
      .sort((a, b) => (a.confirmed_time ?? '99:99').localeCompare(b.confirmed_time ?? '99:99'))
    return {
      key,
      isToday: key === todayKey,
      label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      jobs,
      revenue: jobs.reduce((s, b) => s + (b.price_per_visit ?? 0), 0),
    }
  })

  const weekJobs    = days.reduce((s, d) => s + d.jobs.length, 0)
  const weekRevenue = days.reduce((s, d) => s + d.revenue, 0)

  return (
    <>
      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{weekJobs}</span>
          <span className="admin-stat-label">Jobs this week</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">${weekRevenue.toLocaleString()}</span>
          <span className="admin-stat-label">Week's revenue</span>
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {days.map(day => (
          <div key={day.key} className={`admin-week-day${day.isToday ? ' admin-week-day-today' : ''}`}>
            <div className="admin-week-day-header">
              <span className="admin-week-day-label">
                {day.isToday && <span className="admin-week-day-today-tag">Today</span>}
                {day.label}
              </span>
              {day.jobs.length > 0 && (
                <span className="admin-week-day-summary">
                  {day.jobs.length} job{day.jobs.length === 1 ? '' : 's'} · ${day.revenue.toLocaleString()}
                </span>
              )}
            </div>
            {day.jobs.length === 0 ? (
              <div className="admin-week-day-empty">No jobs confirmed.</div>
            ) : (
              <DayJobs jobs={day.jobs} />
            )}
          </div>
        ))}
      </div>
    </>
  )
}
