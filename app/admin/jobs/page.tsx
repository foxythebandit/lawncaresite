import Link from 'next/link'
import { ATTENTION_PAGE_SIZE, austinDay, getCalendarAttention, getCalendarAttentionPage, getCalendarVisits, getVisitSearch } from '@/lib/calendar-data'
import { ATTENTION, CALENDAR_PATH, VIEWS, calendarContext, calendarHref, calendarRange, dateLabel, shiftCalendar, visitHref, visitStatus, visitTime } from '@/lib/calendar-view'
import { customerDisplayName } from '@/lib/lead-labels'
import { formatPhone } from '@/lib/format-phone'
import { formatMoney } from '@/lib/crm-jobs'
import AdminMap from '../AdminMap'
import CalendarAttention from '../CalendarAttention'
import CalendarView from '../CalendarView'
import Icon from '../icons'

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const today = austinDay()
  const query = await searchParams
  const context = calendarContext(query, today)
  const { first, last } = calendarRange(context.view, context.date)
  const page = context.page ?? 1
  const attention = context.attention
  const [visits, attentionPage, search] = await Promise.all([
    attention || context.search ? [] : getCalendarVisits(first, last),
    attention ? getCalendarAttentionPage(today, attention, page) : getCalendarAttention(today).then(counts => ({ counts, rows: [] })),
    context.search && !attention ? getVisitSearch(context.search, page, context.filter, { first, last }) : null,
  ])
  const focus = typeof query.focus === 'string' && /^[a-zA-Z0-9_-]{1,90}$/.test(query.focus) ? query.focus : undefined
  const label = context.view === 'month' ? dateLabel(first, { month: 'long', year: 'numeric' })
    : first === last ? dateLabel(first, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : `${dateLabel(first, { month: 'short', day: 'numeric', ...(first.slice(0, 4) !== last.slice(0, 4) && { year: 'numeric' }) })} – ${dateLabel(last, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const resultsTitle = attention ? ATTENTION[attention] : 'Search results'
  const rows = attention ? attentionPage.rows : (search?.rows ?? []).map(row => ({
    booking_id: row.id, agreement_id: null, revision_id: null, cadence_on: null, customer_id: null,
    name: row.name, address: row.address, phone: row.phone, visit_status: row.status, job_total: row.job_total,
    service_on: row.status === 'pending' ? row.preferred_date : row.confirmed_date,
    visit_time: row.status === 'pending' ? row.preferred_time : row.confirmed_time, reason: null,
  }))
  const more = attention ? page * ATTENTION_PAGE_SIZE < attentionPage.counts[attention] : search?.more
  const visibleVisits = context.filter === 'confirmed' ? visits.filter(visit => visit.visit_status === 'confirmed') : visits

  return <div className="crm-page work-calendar-page">
    <div className="crm-page-heading">
      <div><h1>Calendar</h1><p className="crm-muted">Schedule and manage service visits.</p></div>
      <Link className="crm-button" href="/admin/route"><Icon name="navigation" size={15} />Today’s route</Link>
    </div>
    <CalendarAttention counts={attentionPage.counts} context={context} />
    <section className="work-cal-panel" aria-label="Service calendar">
      <div className="work-cal-toolbar">
        <div className="work-cal-navigation">
          <Link className="crm-button" href={calendarHref({ ...context, date: today, page: undefined })}>Today</Link>
          <Link className="crm-button work-cal-arrow" aria-label={`Previous ${context.view}`} href={calendarHref({ ...context, date: shiftCalendar(context.view, context.date, -1), page: undefined })}><Icon name="chevronLeft" size={17} /></Link>
          <Link className="crm-button work-cal-arrow" aria-label={`Next ${context.view}`} href={calendarHref({ ...context, date: shiftCalendar(context.view, context.date, 1), page: undefined })}><Icon name="chevronRight" size={17} /></Link>
        </div>
        <h2>{label}</h2>
        <div role="navigation" className="admin-view-toggle" aria-label="Calendar view">
          {VIEWS.map(view => <Link key={view} href={calendarHref({ ...context, view, page: undefined })}
            className={`admin-view-btn${context.view === view ? ' active' : ''}`} aria-current={context.view === view ? 'page' : undefined}>
            {view[0].toUpperCase() + view.slice(1)}
          </Link>)}
        </div>
      </div>
      <form className="work-cal-search" action={CALENDAR_PATH}>
        <input type="hidden" name="view" value={context.view} /><input type="hidden" name="date" value={context.date} />
        {context.filter && <input type="hidden" name="filter" value={context.filter} />}
        <label className="admin-search"><Icon name="search" size={16} />
          <input className="admin-search-input" type="search" name="search" aria-label="Search visits" placeholder="Search visits…" key={context.search} defaultValue={context.search} maxLength={160} />
        </label>
        <button type="submit" className="crm-button">Search</button>
        {(context.search || attention || context.filter) && <Link href={calendarHref({ view: context.view, date: context.date, search: '' })} className="crm-button crm-button-ghost">Clear</Link>}
        {visibleVisits.some(visit => visit.booking_id && visit.address) && <AdminMap key={first + last}
          bookings={visibleVisits.filter(visit => visit.booking_id && visit.address).map(visit => ({
            id: visit.booking_id!, name: customerDisplayName(visit), address: visit.address, status: visit.visit_status,
            price_per_visit: visit.job_total, confirmed_date: visit.service_on, confirmed_time: visit.visit_time,
          }))} />}
      </form>
      {attention || search ? <section className="work-cal-results" aria-label={resultsTitle}>
        <h3>{resultsTitle}</h3>
        {!rows.length && <p className="crm-muted">{attention ? 'Nothing here right now.' : `No visits match “${context.search}”.`}</p>}
        {rows.map(row => {
          const name = customerDisplayName(row)
          const when = row.service_on ? dateLabel(row.service_on, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date set'
          const href = row.booking_id || row.revision_id ? visitHref(row, calendarHref(context))
            : `/admin/customers/${row.customer_id}#schedule-${row.agreement_id}`
          return <Link key={row.booking_id ?? `${row.agreement_id}-${row.cadence_on}`} className="work-cal-result" prefetch={false} href={href}>
            <span><strong>{name}</strong>
              <small>{[row.address !== name ? row.address : null, row.phone ? formatPhone(row.phone) : null].filter(Boolean).join(' · ')}</small>
              {row.reason && <small>{row.reason}</small>}</span>
            <span><strong>{row.reason ? 'Review schedule' : visitStatus(row.visit_status ?? '', row.service_on, today)}</strong>
              {!row.reason && <small>{row.visit_status === 'pending' && row.service_on ? 'Requested ' : ''}{when}{row.visit_time ? ` · ${visitTime(row.visit_time)}` : ''}{row.job_total != null ? ` · ${formatMoney(row.job_total)}` : ''}</small>}</span>
            <Icon name="chevronRight" size={16} />
          </Link>
        })}
        {(page > 1 || more) && <div role="navigation" className="work-cal-pagination" aria-label={`${resultsTitle} pages`}>
          {page > 1 && <Link className="crm-button" href={calendarHref({ ...context, page: page - 1 })}>Previous page</Link>}
          {more && <Link className="crm-button" href={calendarHref({ ...context, page: page + 1 })}>Next page</Link>}
        </div>}
      </section> : <CalendarView key={`${context.view}:${first}`} context={context} today={today} visits={visibleVisits} focus={focus} />}
    </section>

  </div>
}
