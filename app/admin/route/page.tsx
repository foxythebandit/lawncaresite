import { getBookings } from '../actions'
import DayJobs from '../DayJobs'
import ScheduleTabs from '../ScheduleTabs'
import Icon from '../icons'
import { formatMoneyWhole, jobPrice } from '@/lib/crm-jobs'
import { adminDb } from '@/lib/supabase/admin'
import { dayLabel } from '@/lib/lead-summary'

export const dynamic = 'force-dynamic'

export default async function RoutePage() {
  const all = await getBookings()
  // Today in Austin, not UTC (after 7 pm the UTC date is already tomorrow).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

  const jobs = all
    .filter(b => b.confirmed_date === today && b.status === 'confirmed')
    .sort((a, b) => (a.confirmed_time ?? '99:99').localeCompare(b.confirmed_time ?? '99:99'))

  const todayRevenue = jobs.reduce((s, b) => s + jobPrice(b), 0)
  const todayLabel   = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' })

  // No jobs today (UX audit Q11): the next scheduled visit and the leads to call back today.
  const next = jobs.length ? null : all.filter(b => b.status === 'confirmed' && (b.confirmed_date ?? '') > today)
    .sort((a, b) => `${a.confirmed_date}${a.confirmed_time ?? ''}`.localeCompare(`${b.confirmed_date}${b.confirmed_time ?? ''}`))[0] ?? null
  const { data: checkBacks } = jobs.length ? { data: [] } : await adminDb().from('leads').select('id,name,phone,check_back_on')
    .in('board_column', ['in_talks', 'quoted', 'booking_request']).lte('check_back_on', today).order('check_back_on').limit(20)

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
      {!jobs.length && <div className="admin-today-next">
        <section className="crm-block">
          <h2 className="crm-block-head"><span>Next visit</span></h2>
          {next ? <a className="admin-today-row" href={`/admin/jobs?search=${encodeURIComponent(next.name)}`}>
            <strong>{dayLabel(next.confirmed_date, true)}{next.confirmed_time ? ` · ${next.confirmed_time}` : ''}</strong>
            <span>{next.name} · {next.address}</span>
          </a> : <p className="crm-muted">None scheduled</p>}
        </section>
        <section className="crm-block">
          <h2 className="crm-block-head"><span>Call back today</span><span className="crm-block-aside">{checkBacks?.length || ''}</span></h2>
          {checkBacks?.length ? checkBacks.map(lead => <a key={lead.id} className="admin-today-row" href={`/admin/leads/${lead.id}`}>
            <strong>{lead.name || lead.phone}</strong>
            <span className={`crm-pill crm-pill-${lead.check_back_on < today ? 'bad' : 'warn'}`}>Check back {dayLabel(lead.check_back_on)}</span>
          </a>) : <p className="crm-muted">None due</p>}
        </section>
      </div>}
    </div>
  )
}
