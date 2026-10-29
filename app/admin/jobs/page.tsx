import { getAgreements, getBookings, getCustomers, getJobItems, getJobPayments } from '../actions'
import BookingCard from '../BookingCard'
import AdminSearch from '../AdminSearch'
import AdminMap from '../AdminMap'
import CalendarView from '../CalendarView'
import Icon from '../icons'
import { formatMoneyWhole, jobPrice } from '@/lib/crm-jobs'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import { signMapUrls } from '../signed-maps'
import { tracedShapes } from '../leads/TracingMap'
import { adminDb } from '@/lib/supabase/admin'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; search?: string; view?: string }>
}) {
  const { filter = 'all', search = '', view = 'list' } = await searchParams
  const [all, identities, agreements, allItems, allPayments] = await Promise.all([
    getBookings(), getCustomers(), getAgreements(), getJobItems(), getJobPayments(),
  ])
  // The map bucket is private (P7): sign each screenshot on the server; unsigned ones show no image.
  const signedMaps = await signMapUrls(all.map(b => b.map_screenshot_url))
  // Visits without a saved map image show the lead's tracing instead, like the lead page.
  const tracedLeadIds = [...new Set(all.filter(b => b.lead_id && !signedMaps.get(b.map_screenshot_url)).map(b => b.lead_id as string))]
  const { data: tracings } = tracedLeadIds.length ? await adminDb().from('leads').select('id,lawn_tracing').in('id', tracedLeadIds) : { data: [] }
  const shapesByLead = new Map((tracings ?? []).map(row => [row.id as string, tracedShapes(row.lawn_tracing)]))

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


  const chicagoParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const chicagoDate = `${chicagoParts.find(p => p.type === 'year')?.value}-${chicagoParts.find(p => p.type === 'month')?.value}-${chicagoParts.find(p => p.type === 'day')?.value}`
  // Upcoming booked: scheduled visits from today on (past-due ones are not future money).
  const upcomingBooked = all.filter(b => b.status === 'confirmed' && (b.confirmed_date ?? '') >= chicagoDate).reduce((sum, b) => sum + jobPrice(b), 0)

  // Generated mowing visits keep the lead ID, but only a quote booking carries its outcome.
  const quotedVisitByLead = new Map<string, string>()
  for (const leadId of new Set(all.map(b => b.lead_id).filter((id): id is string => !!id))) {
    const quoted = latestQuoteBooking(all.filter(b => b.lead_id === leadId))
    if (quoted) quotedVisitByLead.set(leadId, quoted.id)
  }
  const visitCounts = new Map<string, number>()
  for (const b of all) {
    const key = b.customer_id ?? b.id
    visitCounts.set(key, (visitCounts.get(key) ?? 0) + 1)
  }

  const searchSuffix = q ? `&search=${encodeURIComponent(q)}` : ''

  // Upcoming (soonest first, undated requests on top) and Past (newest first), instead of by status.
  const dateOf = (b: (typeof all)[number]) => (b.confirmed_date ?? b.preferred_date ?? b.occurrence_on ?? null) as string | null
  const isUpcoming = (b: (typeof all)[number]) => { const d = dateOf(b); return d ? d >= chicagoDate : ['pending', 'confirmed'].includes(b.status) }
  const groups = [
    { key: 'upcoming', label: 'Upcoming', rows: filtered.filter(isUpcoming).sort((a, b) => (dateOf(a) ?? '').localeCompare(dateOf(b) ?? '')) },
    { key: 'past', label: 'Past', rows: filtered.filter(b => !isUpcoming(b)).sort((a, b) => (dateOf(b) ?? b.created_at).localeCompare(dateOf(a) ?? a.created_at)) },
  ].filter(group => group.rows.length)

  return (
    <div className="crm-page">
      <div className="crm-page-heading">
        <div><h1>Jobs</h1><p className="crm-muted">Every visit, from request to payment.</p></div>
        <div className="crm-head-actions">
          <div className="admin-view-toggle" role="navigation" aria-label="Job view">
            <a href={`/admin/jobs?filter=${filter}${searchSuffix}`} className={`admin-view-btn${view !== 'calendar' ? ' active' : ''}`}><Icon name="list" size={15} />List</a>
            <a href={`/admin/jobs?view=calendar`} className={`admin-view-btn${view === 'calendar' ? ' active' : ''}`}><Icon name="calendar" size={15} />Calendar</a>
          </div>
        </div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{pendingCount}</span>
          <span className="admin-stat-label">To schedule</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val">{confirmedCount}</span>
          <span className="admin-stat-label">Scheduled</span>
        </div>
        <a href="/admin/week" className="admin-stat admin-stat-link">
          <span className="admin-stat-val">{weekCount}</span>
          <span className="admin-stat-label">This week <Icon name="arrowRight" size={14} /></span>
        </a>
        <a href="/admin/revenue" className="admin-stat admin-stat-link">
          <span className="admin-stat-val">{formatMoneyWhole(upcomingBooked)}</span>
          <span className="admin-stat-label">Upcoming booked <Icon name="arrowRight" size={14} /></span>
        </a>
      </div>

      {view !== 'calendar' && <div className="admin-toolbar">
        <div className="admin-filters" role="navigation" aria-label="Job filters">
          {[
            { key: 'all',       label: 'All'       },
            { key: 'pending',   label: 'To schedule' },
            { key: 'confirmed', label: 'Scheduled' },
            { key: 'week',      label: 'This week' },
          ].map(f => (
            <a key={f.key} href={`/admin/jobs?filter=${f.key}${searchSuffix}`} className={`admin-filter-btn ${filter === f.key ? 'active' : ''}`}>
              {f.label}
            </a>
          ))}
        </div>
        <div className="admin-toolbar-right">
          <label className="admin-search"><Icon name="search" size={15} /><AdminSearch defaultValue={search} filter={filter} /></label>
        </div>
      </div>}

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
        <>
          <div className="admin-list">
            {filtered.length === 0 ? (
              <div className="admin-empty">
                {q ? `No bookings matching "${search}".` : 'No bookings here yet.'}
              </div>
            ) : (
              groups.map(group => <section key={group.key} className="admin-list-group" aria-label={group.label}>
                <h2 className="admin-list-group-head">{group.label} <span>{group.rows.length}</span></h2>
                {group.rows.map(b => (
                <BookingCard key={b.id} shapes={(b.lead_id && shapesByLead.get(b.lead_id)) || []} booking={{ ...b, map_screenshot_url: signedMaps.get(b.map_screenshot_url) ?? null } as any}
                  emailConfigured={Boolean(process.env.RESEND_API_KEY)}
                  historyCount={visitCounts.get(b.customer_id ?? b.id) ?? 1}
                  quotedVisit={!!b.lead_id && quotedVisitByLead.get(b.lead_id) === b.id}
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
                ))}
              </section>)
            )}
          </div>

          <AdminMap bookings={all.map(b => ({
            id: b.id,
            name: b.name,
            address: b.address,
            status: b.status,
            price_per_visit: jobPrice(b),
            confirmed_date: b.confirmed_date ?? null,
            confirmed_time: b.confirmed_time ?? null,
          }))} />
        </>
      )}
    </div>
  )
}
