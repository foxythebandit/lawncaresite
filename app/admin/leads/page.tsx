import { getLeads, getBookings } from '../actions'
import { formatAttributionLabel } from '@/lib/attribution'
import LeadRow from './LeadRow'

function normalizePhone(p: string) {
  return p.replace(/\D/g, '').slice(-10)
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default async function LeadsPage() {
  const [leads, bookings] = await Promise.all([getLeads(), getBookings()])

  const bookedPhones = new Set(bookings.map(b => normalizePhone(b.phone ?? '')))

  const bySource = new Map<string, { total: number; converted: number }>()
  for (const lead of leads) {
    const label = formatAttributionLabel(lead) ?? 'Direct / unknown'
    const entry = bySource.get(label) ?? { total: 0, converted: 0 }
    entry.total += 1
    if (bookedPhones.has(normalizePhone(lead.phone ?? ''))) entry.converted += 1
    bySource.set(label, entry)
  }
  const sourceRows = [...bySource.entries()].sort((a, b) => b[1].total - a[1].total)

  const totalConverted = leads.filter(l => bookedPhones.has(normalizePhone(l.phone ?? ''))).length

  return (
    <>
      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{leads.length}</span>
          <span className="admin-stat-label">Total leads</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{totalConverted}</span>
          <span className="admin-stat-label">Converted to booking</span>
        </div>
        <div className="admin-stat-divider" />
        <div className="admin-stat">
          <span className="admin-stat-val">{leads.length ? Math.round((totalConverted / leads.length) * 100) : 0}%</span>
          <span className="admin-stat-label">Conversion rate</span>
        </div>
      </div>

      {sourceRows.length > 0 && (
        <div className="admin-card" style={{ marginBottom: 16, padding: '16px 18px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 12 }}>
            By source
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sourceRows.map(([label, stats]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5 }}>
                <span style={{ color: 'var(--ink)' }}>{label}</span>
                <span style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                  {stats.total} lead{stats.total !== 1 ? 's' : ''} · {stats.converted} booked
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {leads.length === 0 ? (
        <div className="admin-empty">No leads yet.</div>
      ) : (
        <div className="admin-list">
          {leads.map(lead => (
            <LeadRow
              key={lead.id}
              lead={lead}
              source={formatAttributionLabel(lead)}
              converted={bookedPhones.has(normalizePhone(lead.phone ?? ''))}
              timeAgo={timeAgo(lead.created_at)}
            />
          ))}
        </div>
      )}
    </>
  )
}
