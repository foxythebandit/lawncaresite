'use client'

import { useTransition } from 'react'
import { updateStatus } from './actions'

interface Booking {
  id: string
  name: string
  phone: string
  email: string | null
  address: string
  preferred_date: string | null
  sq_ft: number | null
  frequency: string | null
  price_per_visit: number | null
  first_visit_price: number | null
  overgrowth_fee: number | null
  last_mow: string | null
  status: string
  created_at: string
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'admin-badge-pending'   },
  confirmed: { label: 'Confirmed', className: 'admin-badge-confirmed' },
  declined:  { label: 'Declined',  className: 'admin-badge-declined'  },
}

export default function BookingCard({ booking }: { booking: Booking }) {
  const [pending, startTransition] = useTransition()
  const status = STATUS_STYLES[booking.status] ?? STATUS_STYLES.pending

  function setStatus(s: string) {
    startTransition(() => updateStatus(booking.id, s))
  }

  return (
    <div className={`admin-card ${pending ? 'admin-card-loading' : ''}`}>
      <div className="admin-card-header">
        <div>
          <span className={`admin-badge ${status.className}`}>{status.label}</span>
          <h2 className="admin-card-name">{booking.name}</h2>
          <p className="admin-card-time">{timeAgo(booking.created_at)}</p>
        </div>
        {booking.first_visit_price && (
          <div className="admin-card-price">
            <div className="admin-card-price-val">${booking.price_per_visit}</div>
            <div className="admin-card-price-sub">/visit</div>
          </div>
        )}
      </div>

      <div className="admin-card-body">
        <div className="admin-card-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>{booking.address}</span>
        </div>
        {booking.preferred_date && (
          <div className="admin-card-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>{formatDate(booking.preferred_date)}</span>
          </div>
        )}
        <div className="admin-card-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>{booking.sq_ft?.toLocaleString()} sq ft · {booking.frequency}</span>
        </div>
        {booking.overgrowth_fee ? (
          <div className="admin-card-row admin-card-row-warning">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>First visit ${booking.first_visit_price} (incl. ${booking.overgrowth_fee} cleanup)</span>
          </div>
        ) : null}
        {booking.email && (
          <div className="admin-card-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            <a href={`mailto:${booking.email}`} className="admin-card-link">{booking.email}</a>
          </div>
        )}
      </div>

      <div className="admin-card-actions">
        <a href={`tel:${booking.phone}`} className="admin-action-call">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.54 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Call
        </a>
        <a href={`sms:${booking.phone}`} className="admin-action-text">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Text
        </a>
      </div>

      {booking.status === 'pending' && (
        <div className="admin-card-status-btns">
          <button className="admin-status-confirm" onClick={() => setStatus('confirmed')} disabled={pending}>
            ✓ Confirm
          </button>
          <button className="admin-status-decline" onClick={() => setStatus('declined')} disabled={pending}>
            ✗ Decline
          </button>
        </div>
      )}
      {booking.status !== 'pending' && (
        <button className="admin-status-reset" onClick={() => setStatus('pending')} disabled={pending}>
          Reset to pending
        </button>
      )}
    </div>
  )
}
