'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatMoney, jobPrice, jobStatusLabel } from '@/lib/crm-jobs'
import Icon from './icons'

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
  job_total?: number | string | null
  first_visit_price?: number | null
  phone: string
  customer_id: string | null
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

  const shownDate = selected ?? (todayStr.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) ? todayStr : null)
  const shownJobs = shownDate ? (byDate.get(shownDate) ?? []) : []

  return (
    <div className="admin-calendar-layout">
      <div className="admin-calendar">
        <div className="admin-cal-header">
          <span className="admin-cal-month">{monthLabel}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="admin-cal-nav" onClick={prev} aria-label="Previous month"><Icon name="chevronLeft" size={16} /></button>
            <button className="admin-cal-nav" onClick={next} aria-label="Next month"><Icon name="chevronRight" size={16} /></button>
          </div>
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
            const isSelected  = dateStr === shownDate
            const confirmed = jobs.filter(j => j.status === 'confirmed').length
            const pending   = jobs.filter(j => j.status === 'pending').length
            return (
              <button
                key={dateStr}
                className={`admin-cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
                onClick={() => setSelected(isSelected ? null : dateStr)}
                aria-label={`${dateStr}: ${confirmed} scheduled, ${pending} to schedule`}
              >
                <span className="admin-cal-day-num">{day}</span>
                {(confirmed > 0 || pending > 0) && (
                  <span className="admin-cal-dots">
                    {confirmed > 0 && <span className="admin-cal-count confirmed">{confirmed} scheduled</span>}
                    {pending > 0   && <span className="admin-cal-count pending">{pending} to schedule</span>}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="admin-cal-detail">
        <div className="admin-cal-detail-date">
          {shownDate ? new Date(shownDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Select a day'}
        </div>
        {!shownDate ? <div className="admin-cal-detail-empty">Pick a date to see its visits.</div>
          : shownJobs.length === 0 ? (
          <div className="admin-cal-detail-empty">No jobs this day.</div>
        ) : shownJobs.map(b => (
          <div key={b.id} className="admin-cal-job">
            <div className="admin-cal-job-info">
              <div className="admin-cal-job-name">{b.name} <span className={`admin-badge admin-badge-${b.status}`}>{jobStatusLabel(b.status)}</span></div>
              <div className="admin-cal-job-addr">{b.address}</div>
              <Link href={b.customer_id ? `/admin/customers/${b.customer_id}` : `/admin/client/${encodeURIComponent(b.phone)}`} className="admin-cal-job-hist">History →</Link>
            </div>
            <div className="admin-cal-job-right">
              {b.confirmed_time && <div className="admin-cal-job-time">{/^\d{1,2}:\d{2}$/.test(b.confirmed_time) ? formatTime(b.confirmed_time) : b.confirmed_time}</div>}
              {(b.job_total ?? b.first_visit_price ?? b.price_per_visit) != null && <div className="admin-cal-job-price">{formatMoney(jobPrice(b))}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
