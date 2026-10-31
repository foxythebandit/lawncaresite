'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { scheduleJobAndEmail } from '../actions'
import { moveLead } from './board-actions'
import { uuid } from '@/lib/uuid'

/**
 * Booking request → confirm the visit right on the lead page (UX audit Q1), with the same action as
 * Jobs' "Confirm & email customer". The customer gets the confirmation email when email is set up.
 */
export function ScheduleVisit({ booking, canEmail }: {
  booking: { id: string; updated_at: string; preferred_date?: string | null; preferred_time?: string | null }; canEmail: boolean
}) {
  const router = useRouter()
  const [date, setDate] = useState(booking.preferred_date ?? '')
  const [time, setTime] = useState(booking.preferred_time && !/^any/i.test(booking.preferred_time) ? booking.preferred_time : '')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [pending, startTransition] = useTransition()
  // A retry of the same date and time reuses its operation ID, so a lost response never confirms twice.
  const operation = useRef<{ key: string; id: string } | null>(null)

  function confirm() {
    const key = `${date}|${time}`
    if (operation.current?.key !== key) operation.current = { key, id: uuid() }
    const operationId = operation.current.id
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await scheduleJobAndEmail({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, operationId, action: 'confirm', date, time })
        if (!result.success) { setMessage({ text: result.error, error: true }); return }
        operation.current = null
        setMessage({ text: typeof result.data?.warning === 'string' ? result.data.warning : result.data?.email_sent ? 'Visit confirmed · email sent' : 'Visit confirmed' })
        router.refresh()
      } catch { setMessage({ text: 'Not saved · retry', error: true }) }
    })
  }

  return <div className="crm-schedule" id="schedule">
    <div className="crm-schedule-fields">
      <label className="crm-field">Visit date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="crm-field">Time<input value={time} maxLength={50} placeholder="Morning" onChange={event => setTime(event.target.value)} /></label>
    </div>
    <button type="button" className="crm-button crm-button-primary" disabled={pending || !date} onClick={confirm}>
      {canEmail ? 'Confirm & email customer' : 'Confirm visit'}</button>
    {message && <p className={message.error ? 'crm-error' : 'crm-muted'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </div>
}

/** Closed → In talks, the lead page's main button for a closed lead (UX audit Q2). */
export function ReopenButton({ leadId, className }: { leadId: string; className: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  return <>
    <button type="button" className={className} disabled={pending} onClick={() => startTransition(async () => {
      const result = await moveLead(leadId, 'in_talks').catch(() => ({ ok: false as const, error: 'Not saved' }))
      if (result.ok) router.refresh(); else setError(result.error)
    })}>Reopen</button>
    {error && <span className="crm-error" role="alert">{error}</span>}
  </>
}
