'use client'

import { useState } from 'react'
import Link from 'next/link'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

interface Booking {
  id: string
  name: string
  address: string
  confirmed_date: string | null
  preferred_date: string | null
  confirmed_time: string | null
  status: string
  price_per_visit: number | null
  phone: string
}

export default function CalendarView({ bookings }: { bookings: Booking[] }) {
  const today = new Date()
  const [year, setYear]     = useState(today.getFullYear())
  const [month, setMonth]   = useState(today.getMonth())
  const [selected, setSelected] = useState<string | null>(null)

  const byDate = new Map<string, Booking[]>()
  for (const b of bookings) {
    const date = b.confirmed_date ?? b.preferred_date
    if (!date) continue
    const key = date.slice(0, 10)
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(b)
  }

  const firstDow   = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function prev() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
    setSelected(null)
  }
  function next() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
    setSelected(null)
  }

  const todayStr   = today.toISOString().split('T')[0]
  const monthLabel = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const selectedJobs = selected ? (byDate.get(selected) ?? []) : []

  return (
    <div style={{ padding: '12px 16px 24px' }}>
      <div className="admin-calendar">
        <div className="admin-cal-header">
          <button className="admin-cal-nav" onClick={prev}>‹</button>
          <span className="admin-cal-month">{monthLabel}</span>
          <button className="admin-cal-nav" onClick={next}>›</button>
        </div>
        <div className="admin-cal-grid">
          {DAYS.map(d => (
            <div key={d} className="admin-cal-dow">{d}</div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`e${i}`} className="admin-cal-empty" />
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const jobs        = byDate.get(dateStr) ?? []
            const isToday     = dateStr === todayStr
            const isSelected  = dateStr === selected
            const hasConfirmed = jobs.some(j => j.status === 'confirmed')
            const hasPending   = jobs.some(j => j.status === 'pending')
            return (
              <button
                key={dateStr}
                className={`admin-cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
                onClick={() => setSelected(isSelected ? null : dateStr)}
              >
                <span className="admin-cal-day-num">{day}</span>
                {(hasConfirmed || hasPending) && (
                  <span className="admin-cal-dots">
                    {hasConfirmed && <span className="admin-cal-dot confirmed" />}
                    {hasPending   && <span className="admin-cal-dot pending"   />}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selected && (
        <div className="admin-cal-detail">
          <div className="admin-cal-detail-date">
            {new Date(selected + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          {selectedJobs.length === 0 ? (
            <div style={{ color: 'var(--ink-soft)', fontSize: 13, padding: '4px 0' }}>No jobs this day.</div>
          ) : selectedJobs.map(b => (
            <div key={b.id} className="admin-cal-job">
              <span className={`admin-badge admin-badge-${b.status}`}>{b.status}</span>
              <div className="admin-cal-job-info">
                <div className="admin-cal-job-name">{b.name}</div>
                <div className="admin-cal-job-addr">{b.address}</div>
              </div>
              <div className="admin-cal-job-right">
                {b.confirmed_time && <div className="admin-cal-job-time">{formatTime(b.confirmed_time)}</div>}
                {b.price_per_visit && <div className="admin-cal-job-price">${b.price_per_visit}</div>}
                <Link href={`/admin/client/${encodeURIComponent(b.phone)}`} className="admin-cal-job-hist">History →</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
