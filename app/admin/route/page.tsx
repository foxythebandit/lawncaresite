import { getBookings } from '../actions'
import DayJobs from '../DayJobs'
import ScheduleTabs from '../ScheduleTabs'
import Icon from '../icons'
import { formatMoneyWhole, jobPrice } from '@/lib/crm-jobs'

export const dynamic = 'force-dynamic'

export default async function RoutePage() {
  const all = await getBookings()
  const today = new Date().toISOString().split('T')[0]

  const jobs = all
    .filter(b => b.confirmed_date === today && b.status === 'confirmed')
    .sort((a, b) => (a.confirmed_time ?? '99:99').localeCompare(b.confirmed_time ?? '99:99'))

  const todayRevenue = jobs.reduce((s, b) => s + jobPrice(b), 0)
  const todayLabel   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Build a multi-stop Google Maps URL for the full route
  const mapsUrl = jobs.length > 1
    ? `https://www.google.com/maps/dir/${jobs.map(b => encodeURIComponent(b.address)).join('/')}`
    : jobs.length === 1
    ? `https://maps.google.com/?q=${encodeURIComponent(jobs[0].address)}`
    : null

  return (
    <div className="crm-page">
      <div className="crm-page-heading">
        <div><h1>Today</h1><p className="crm-muted">{todayLabel}</p></div>
        <div className="crm-head-actions">
          {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="crm-button crm-button-primary admin-route-all-btn"><Icon name="navigation" size={15} />Full route</a>}
        </div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{jobs.length}</span>
          <span className="admin-stat-label">Jobs today</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val">{formatMoneyWhole(todayRevenue)}</span>
          <span className="admin-stat-label">Scheduled job value</span>
        </div>
      </div>

      <div className="admin-schedule-head"><ScheduleTabs current="today" /></div>
      <DayJobs jobs={jobs} emptyLabel="No jobs confirmed for today." />
    </div>
  )
}
