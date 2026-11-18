import { austinDay, getCalendarAttention, getScheduledVisits } from '@/lib/calendar-data'
import DayJobs from '../DayJobs'
import ScheduleTabs from '../ScheduleTabs'
import CalendarAttention from '../CalendarAttention'
import { calendarContext } from '@/lib/calendar-view'
import { formatMoney, formatMoneyWhole, jobPrice } from '@/lib/crm-jobs'

export const dynamic = 'force-dynamic'

function dateKey(d: Date) {
  return d.toISOString().split('T')[0]
}

export default async function WeekPage() {
  const todayKey = austinDay()
  const todayDate = new Date(`${todayKey}T12:00:00Z`)
  const lastDate = new Date(todayDate)
  lastDate.setUTCDate(lastDate.getUTCDate() + 6)
  const [all, counts] = await Promise.all([getScheduledVisits(todayKey, dateKey(lastDate)), getCalendarAttention(todayKey)])

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate)
    d.setUTCDate(d.getUTCDate() + i)
    const key = dateKey(d)
    const jobs = all.filter(b => b.confirmed_date === key)
    return {
      key,
      isToday: key === todayKey,
      label: d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' }),
      jobs,
      revenue: jobs.reduce((s, b) => s + jobPrice(b), 0),
    }
  })

  const weekJobs    = days.reduce((s, d) => s + d.jobs.length, 0)
  const weekRevenue = days.reduce((s, d) => s + d.revenue, 0)

  return (
    <div className="crm-page">
      <div className="crm-page-heading">
        <div><h1>Next 7 days</h1><p className="crm-muted">Confirmed visits, day by day.</p></div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{weekJobs}</span>
          <span className="admin-stat-label">Visits next 7 days</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val">{formatMoneyWhole(weekRevenue)}</span>
          <span className="admin-stat-label">Scheduled visit value</span>
        </div>
      </div>

      <CalendarAttention counts={counts} context={calendarContext({}, todayKey)} />
      <div className="admin-schedule-head"><ScheduleTabs current="week" /></div>
      <div className="admin-week">
        {days.map(day => (
          <div key={day.key} className={`admin-week-day${day.isToday ? ' admin-week-day-today' : ''}`}>
            <div className="admin-week-day-header">
              <span className="admin-week-day-label">
                {day.label}
                {day.isToday && <span className="admin-week-day-today-tag">Today</span>}
              </span>
              <span className="admin-week-day-summary">
                {day.jobs.length > 0 ? `${day.jobs.length} visit${day.jobs.length === 1 ? '' : 's'} · ${formatMoney(day.revenue)}` : 'No visits'}
              </span>
            </div>
            {day.jobs.length > 0 && <DayJobs jobs={day.jobs} />}
          </div>
        ))}
      </div>
    </div>
  )
}
