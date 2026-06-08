'use client'

import { useTransition, useState, useRef } from 'react'
import { updateStatus, updateNotes, markComplete, deleteBooking } from './actions'

interface Booking {
  id: string
  name: string
  phone: string
  email: string | null
  address: string
  preferred_date: string | null
  confirmed_date: string | null
  sq_ft: number | null
  frequency: string | null
  price_per_visit: number | null
  first_visit_price: number | null
  overgrowth_fee: number | null
  last_mow: string | null
  status: string
  created_at: string
  map_screenshot_url: string | null
  notes: string | null
  completed_at: string | null
  amount_charged: number | null
  payment_method: string | null
  next_visit_date: string | null
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

function calcNextDate(from: string, frequency: string | null) {
  const base = new Date(from + 'T12:00:00')
  const freq = (frequency ?? '').toLowerCase()
  const days = freq.includes('bi') ? 14 : freq.includes('month') ? 30 : 7
  base.setDate(base.getDate() + days)
  return base.toISOString().split('T')[0]
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'admin-badge-pending'   },
  confirmed: { label: 'Confirmed', className: 'admin-badge-confirmed' },
  declined:  { label: 'Declined',  className: 'admin-badge-declined'  },
  completed: { label: 'Completed', className: 'admin-badge-completed' },
}

export default function BookingCard({ booking }: { booking: Booking }) {
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded]   = useState(false)
  const [confirmingDate, setConfirmingDate] = useState(false)
  const [pickedDate, setPickedDate] = useState(booking.preferred_date ?? '')
  const [notes, setNotes]         = useState(booking.notes ?? '')
  const [notesSaved, setNotesSaved] = useState(false)
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const [completing, setCompleting] = useState(false)
  const [completeDate, setCompleteDate] = useState(today)
  const [completeAmount, setCompleteAmount] = useState(booking.price_per_visit ?? 0)
  const [completePayment, setCompletePayment] = useState('Stripe')

  const previewNextDate = calcNextDate(completeDate || today, booking.frequency)

  const status = STATUS_STYLES[booking.status] ?? STATUS_STYLES.pending

  function doConfirm() {
    setConfirmingDate(false)
    startTransition(() => updateStatus(booking.id, 'confirmed', pickedDate || undefined))
  }

  function doMarkComplete() {
    setCompleting(false)
    startTransition(() => markComplete(booking.id, {
      completed_at: completeDate,
      amount_charged: completeAmount,
      payment_method: completePayment,
    }))
  }

  function saveNotes(val: string) {
    setNotes(val)
    if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current)
    notesSaveTimer.current = setTimeout(() => {
      startTransition(() => updateNotes(booking.id, val))
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    }, 800)
  }

  return (
    <div className={`admin-card ${pending ? 'admin-card-loading' : ''}`}>

      <button className="admin-card-summary" onClick={() => setExpanded(e => !e)}>
        <span className={`admin-badge ${status.className}`}>{status.label}</span>
        <span className="admin-card-summary-name">{booking.name}</span>
        <span className="admin-card-summary-addr">{booking.address}</span>
        {booking.price_per_visit && (
          <span className="admin-card-summary-price">
            ${booking.price_per_visit}<span className="admin-card-summary-sub">/visit</span>
          </span>
        )}
        <svg
          className={`admin-card-chevron${expanded ? ' admin-card-chevron-open' : ''}`}
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {expanded && (
        <>
          <div className="admin-card-body">
            <div className="admin-card-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>{booking.address}</span>
            </div>
            {(booking.confirmed_date || booking.preferred_date) && (
              <div className="admin-card-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>
                  {booking.confirmed_date
                    ? <><strong>Confirmed:</strong> {formatDate(booking.confirmed_date)}</>
                    : <><span style={{ color: 'var(--ink-soft)' }}>Preferred:</span> {formatDate(booking.preferred_date!)}</>
                  }
                </span>
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

            {/* Completion record */}
            {booking.status === 'completed' && booking.completed_at && (
              <div className="admin-complete-record">
                <div className="admin-complete-record-row">
                  <span>Completed</span>
                  <strong>{formatDate(booking.completed_at.split('T')[0])}</strong>
                </div>
                {booking.amount_charged != null && (
                  <div className="admin-complete-record-row">
                    <span>Charged</span>
                    <strong>${booking.amount_charged.toFixed(2)}</strong>
                  </div>
                )}
                {booking.payment_method && (
                  <div className="admin-complete-record-row">
                    <span>Via</span>
                    <strong>{booking.payment_method}</strong>
                  </div>
                )}
                {booking.next_visit_date && (
                  <div className="admin-complete-record-row">
                    <span>Next visit</span>
                    <strong>{formatDate(booking.next_visit_date)}</strong>
                  </div>
                )}
              </div>
            )}

            <div className="admin-card-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.54 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <a href={`tel:${booking.phone}`} className="admin-card-link">{booking.phone}</a>
            </div>
            {booking.email && (
              <div className="admin-card-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <a href={`mailto:${booking.email}`} className="admin-card-link">{booking.email}</a>
              </div>
            )}
            <div className="admin-card-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>{timeAgo(booking.created_at)}</span>
            </div>

            {/* Notes */}
            <div className="admin-notes-wrap">
              <label className="admin-notes-label">
                Internal notes
                {notesSaved && <span className="admin-notes-saved">Saved</span>}
              </label>
              <textarea
                className="admin-notes-input"
                placeholder="Gate code, dog in yard, rescheduled, etc."
                value={notes}
                onChange={e => saveNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {booking.map_screenshot_url && (
            <a
              href={booking.map_screenshot_url}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-card-screenshot"
            >
              <img src={booking.map_screenshot_url} alt="Traced lawn" />
              <span className="admin-screenshot-hint">Open full image ↗</span>
            </a>
          )}

          <div className={`admin-card-actions ${booking.email ? 'admin-card-actions-3' : ''}`}>
            <a href={`tel:${booking.phone}`} className="admin-action-call">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.54 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              Call
            </a>
            <a href={`sms:${booking.phone}`} className="admin-action-text">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Text
            </a>
            {booking.email && (
              <a href={`mailto:${booking.email}`} className="admin-action-email">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Email
              </a>
            )}
          </div>

          {booking.status === 'pending' && !confirmingDate && (
            <div className="admin-card-status-btns">
              <button className="admin-status-confirm" onClick={() => setConfirmingDate(true)} disabled={pending}>
                ✓ Confirm
              </button>
              <button className="admin-status-decline" onClick={() => { if (window.confirm(`Decline ${booking.name}'s booking?`)) startTransition(() => updateStatus(booking.id, 'declined')) }} disabled={pending}>
                ✗ Decline
              </button>
            </div>
          )}

          {booking.status === 'pending' && confirmingDate && (
            <div className="admin-confirm-date-panel">
              <label className="admin-confirm-date-label">Set confirmed date (optional)</label>
              <input
                type="date"
                className="admin-confirm-date-input"
                value={pickedDate}
                onChange={e => setPickedDate(e.target.value)}
              />
              <div className="admin-confirm-date-btns">
                <button className="admin-confirm-date-send" onClick={doConfirm} disabled={pending}>
                  ✓ Confirm &amp; send email
                </button>
                <button className="admin-confirm-date-cancel" onClick={() => setConfirmingDate(false)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {booking.status === 'confirmed' && !completing && (
            <div className="admin-card-status-btns">
              <button className="admin-status-complete" onClick={() => setCompleting(true)} disabled={pending}>
                ✓ Mark complete
              </button>
            </div>
          )}

          {booking.status === 'confirmed' && completing && (
            <div className="admin-complete-panel">
              <div className="admin-complete-panel-title">Mark job complete</div>
              <div className="admin-complete-fields">
                <div className="admin-complete-field">
                  <label>Date completed</label>
                  <input
                    type="date"
                    value={completeDate}
                    onChange={e => setCompleteDate(e.target.value)}
                    className="admin-confirm-date-input"
                  />
                </div>
                <div className="admin-complete-field">
                  <label>Amount charged ($)</label>
                  <input
                    type="number"
                    value={completeAmount}
                    onChange={e => setCompleteAmount(parseFloat(e.target.value) || 0)}
                    className="admin-confirm-date-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="admin-complete-field">
                  <label>Payment method</label>
                  <select
                    value={completePayment}
                    onChange={e => setCompletePayment(e.target.value)}
                    className="admin-confirm-date-input"
                    style={{ width: '100%' }}
                  >
                    <option>Stripe</option>
                    <option>Cash</option>
                    <option>Venmo</option>
                    <option>Zelle</option>
                  </select>
                </div>
              </div>
              <div className="admin-complete-next-hint">
                Next visit auto-scheduled: <strong>{formatDate(previewNextDate)}</strong>
              </div>
              <div className="admin-confirm-date-btns">
                <button className="admin-confirm-date-send" onClick={doMarkComplete} disabled={pending}>
                  ✓ Save &amp; schedule next
                </button>
                <button className="admin-confirm-date-cancel" onClick={() => setCompleting(false)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {booking.status !== 'pending' && booking.status !== 'completed' && (
            <button className="admin-status-reset" onClick={() => startTransition(() => updateStatus(booking.id, 'pending'))} disabled={pending}>
              Reset to pending
            </button>
          )}
          <button
            className="admin-status-delete"
            onClick={() => { if (window.confirm(`Delete ${booking.name}? This cannot be undone.`)) startTransition(() => deleteBooking(booking.id)) }}
            disabled={pending}
          >
            Delete client
          </button>
        </>
      )}
    </div>
  )
}
