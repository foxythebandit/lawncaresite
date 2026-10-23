import Link from 'next/link'
import { getLeads, getBookings } from '../actions'
import { formatAttributionLabel } from '@/lib/attribution'
import LeadRow from './LeadRow'

export const dynamic = 'force-dynamic'

function timeAgo(dateStr: string) {
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view ?? 'all'
  const [leads, bookings] = await Promise.all([getLeads(), getBookings()])
  const bookedLeadIds = new Set(bookings.filter(b => ['confirmed', 'completed'].includes(b.status)).map(b => b.lead_id).filter(Boolean))
  // One request timestamp keeps queue ordering and due labels consistent.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const needsAction = (lead: typeof leads[number]) => !['booked','lost'].includes(lead.stage ?? 'new') &&
    (lead.stage === 'new' || (!!lead.follow_up_at && new Date(lead.follow_up_at).getTime() <= now))
  const needsCount = leads.filter(needsAction).length
  const followupCount = leads.filter(lead => lead.follow_up_at && !['booked','lost'].includes(lead.stage ?? 'new')).length
  const visible = leads.filter(lead => view === 'needs' ? needsAction(lead) : view === 'followup' ? !!lead.follow_up_at && !['booked','lost'].includes(lead.stage ?? 'new') : true)
    .sort((a, b) => Number(needsAction(b)) - Number(needsAction(a)) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const totalConverted = leads.filter(lead => bookedLeadIds.has(lead.id)).length

  return <div className="crm-page">
    <div className="crm-page-heading">
      <div><h1>Leads</h1><p className="crm-muted">Call, quote, and follow up from one workspace.</p></div>
    </div>
    <div className="admin-stats">
      <div className="admin-stat"><span className="admin-stat-val">{needsCount}</span><span className="admin-stat-label">Needs action</span></div>
      <div className="admin-stat"><span className="admin-stat-val">{leads.length}</span><span className="admin-stat-label">Total leads</span></div>
      <div className="admin-stat"><span className="admin-stat-val">{totalConverted}</span><span className="admin-stat-label">Confirmed booking conversion</span></div>
      <div className="admin-stat"><span className="admin-stat-val">{leads.length ? Math.round((totalConverted / leads.length) * 100) : 0}%</span><span className="admin-stat-label">Conversion rate</span></div>
    </div>
    <div className="crm-toolbar">
      <div className="crm-filter-row" role="navigation" aria-label="Lead views">
        <Link className="crm-filter" href="/admin/leads" aria-current={view === 'all' ? 'page' : undefined}>All <strong>{leads.length}</strong></Link>
        <Link className="crm-filter" href="/admin/leads?view=needs" aria-current={view === 'needs' ? 'page' : undefined}>Needs action <strong>{needsCount}</strong></Link>
        <Link className="crm-filter" href="/admin/leads?view=followup" aria-current={view === 'followup' ? 'page' : undefined}>Follow-ups <strong>{followupCount}</strong></Link>
      </div>
    </div>
    {visible.length === 0 ? <div className="admin-empty">{view === 'all' ? 'No leads yet.' : 'Nothing in this view.'}</div> : <div className="crm-list">
      {visible.map(lead => <LeadRow key={lead.id} lead={lead} source={formatAttributionLabel(lead)} converted={bookedLeadIds.has(lead.id)} timeAgo={timeAgo(lead.created_at)} needsAction={needsAction(lead)} due={!!lead.follow_up_at && new Date(lead.follow_up_at).getTime() <= now} />)}
    </div>}
  </div>
}
