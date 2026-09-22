'use client'

import { useState, useTransition } from 'react'
import { sendReminderEmail } from './actions'

function formatTime(t: string) {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t // "Morning" / "Afternoon" — pass through as-is
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

interface Props {
  bookingId: string
  name: string
  phone: string
  email?: string | null
  confirmedDate?: string | null
  confirmedTime?: string | null
  lastReminderSentAt?: string | null
}

export default function ReminderButtons({ bookingId, name, phone, email, confirmedDate, confirmedTime, lastReminderSentAt }: Props) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null)

  if (!confirmedDate) return null

  const dateLabel = new Date(confirmedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = confirmedTime ? formatTime(confirmedTime) : ''
  const smsBody = `Hi ${name.split(' ')[0]}, just a reminder your QuietGreen visit is ${dateLabel}${timeLabel ? ` (${timeLabel})` : ''}. See you then!`

  return (
    <div className="admin-reminder-row">
      <button
        type="button"
        className="admin-route-call-btn"
        disabled={pending || !email}
        title={email ? undefined : 'No email on file'}
        onClick={() => {
          setResult(null)
          startTransition(async () => {
            const r = await sendReminderEmail(bookingId)
            setResult(r)
          })
        }}
      >
        {pending ? 'Sending…' : 'Email reminder'}
      </button>
      <a href={`sms:${phone}&body=${encodeURIComponent(smsBody)}`} className="admin-route-sms-btn">
        Text reminder
      </a>
      {result?.success && <span className="admin-reminder-status admin-reminder-ok">Sent ✓</span>}
      {result && !result.success && <span className="admin-reminder-status admin-reminder-err">{result.error}</span>}
      {!result && lastReminderSentAt && (
        <span className="admin-reminder-status">Reminder sent {timeAgo(lastReminderSentAt)}</span>
      )}
    </div>
  )
}
