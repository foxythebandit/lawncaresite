export function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

interface Job {
  id: string
  name: string
  phone: string
  address: string
  confirmed_time: string | null
  sq_ft: number | null
  frequency: string | null
  price_per_visit: number | null
  notes: string | null
}

export default function DayJobs({ jobs, emptyLabel = 'No jobs confirmed.' }: { jobs: Job[]; emptyLabel?: string }) {
  if (jobs.length === 0) {
    return <div className="admin-empty">{emptyLabel}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {jobs.map((b, i) => (
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
      ))}
    </div>
  )
}
