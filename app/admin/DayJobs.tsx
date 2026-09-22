'use client'

import { useState, useTransition } from 'react'
import { sendReminderEmail } from './actions'

export function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
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
  notes: string | null
  last_reminder_sent_at?: string | null
}

function ReminderControls({ job }: { job: Job }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null)

  const dateLabel = job.confirmed_date
    ? new Date(job.confirmed_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : ''
  const timeLabel = job.confirmed_time ? formatTime(job.confirmed_time) : ''
  const smsBody = `Hi ${job.name.split(' ')[0]}, just a reminder your QuietGreen visit is ${dateLabel}${timeLabel ? ` (${timeLabel})` : ''}. See you then!`

  return (
    <div className="admin-reminder-row">
      <button
        type="button"
        className="admin-route-call-btn"
        disabled={pending || !job.email}
        title={job.email ? undefined : 'No email on file'}
        onClick={() => {
          setResult(null)
          startTransition(async () => {
            const r = await sendReminderEmail(job.id)
            setResult(r)
          })
        }}
      >
        {pending ? 'Sending…' : 'Email reminder'}
      </button>
      <a href={`sms:${job.phone}&body=${encodeURIComponent(smsBody)}`} className="admin-route-sms-btn">
        Text reminder
      </a>
      {result?.success && <span className="admin-reminder-status admin-reminder-ok">Sent ✓</span>}
      {result && !result.success && <span className="admin-reminder-status admin-reminder-err">{result.error}</span>}
      {!result && job.last_reminder_sent_at && (
        <span className="admin-reminder-status">Reminder sent {timeAgo(job.last_reminder_sent_at)}</span>
      )}
    </div>
  )
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
            <ReminderControls job={b} />
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
