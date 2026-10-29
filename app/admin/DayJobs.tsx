import ReminderButtons from './ReminderButtons'
import { formatMoney, jobPrice } from '@/lib/crm-jobs'
import Icon from './icons'
import { FREQUENCY_LABEL, normalizeFrequency } from '@/lib/lead-board'

export function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

interface Job {
  id: string
  name: string
  phone: string
  email?: string | null
  address: string
  confirmed_date?: string | null
  confirmed_time: string | null
  sq_ft: number | null
  frequency: string | null
  price_per_visit: number | null
  job_total?: number | string | null
  notes: string | null
  last_reminder_sent_at?: string | null
}

export default function DayJobs({ jobs, emptyLabel = 'No jobs confirmed.' }: { jobs: Job[]; emptyLabel?: string }) {
  if (jobs.length === 0) {
    return <div className="admin-empty">{emptyLabel}</div>
  }

  return (
    <div className="admin-route-list">
      {jobs.map((b, i) => (
        <div key={b.id} className="admin-route-card">
          <div className="admin-route-stop">
            <strong>{b.confirmed_time ? (/^\d{1,2}:\d{2}$/.test(b.confirmed_time) ? formatTime(b.confirmed_time) : b.confirmed_time) : '—'}</strong>
            <span>Stop {i + 1}</span>
          </div>
          <div className="admin-route-info">
            <div className="admin-route-name">{b.name}</div>
            <div className="admin-route-addr">{b.address}</div>
            <div className="admin-route-meta">
              {jobPrice(b) > 0 && <strong>{formatMoney(jobPrice(b))} job value</strong>}
              {b.sq_ft        && <span>{b.sq_ft.toLocaleString()} sq ft</span>}
              {b.frequency    && <span>{normalizeFrequency(b.frequency) ? FREQUENCY_LABEL[normalizeFrequency(b.frequency)!] : b.frequency}</span>}
            </div>
            {b.notes && <div className="admin-route-notes">{b.notes}</div>}
            <ReminderButtons
              bookingId={b.id}
              name={b.name}
              phone={b.phone}
              email={b.email}
              confirmedDate={b.confirmed_date}
              confirmedTime={b.confirmed_time}
              lastReminderSentAt={b.last_reminder_sent_at}
            />
          </div>
          <div className="admin-route-actions">
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(b.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="crm-button crm-button-primary"
            >
              <Icon name="navigation" size={15} />Navigate
            </a>
            <a href={`tel:${b.phone}`} className="crm-button"><Icon name="phone" size={15} />Call</a>
            <a href={`sms:${b.phone}`} className="crm-button"><Icon name="message" size={15} />Text</a>
          </div>
        </div>
      ))}
    </div>
  )
}
