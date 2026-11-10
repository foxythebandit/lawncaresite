'use client'

import Link from 'next/link'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { changeJob, finishVisit } from '../../actions'
import { formatMoney, jobStatusLabel, type ActionResult } from '@/lib/crm-jobs'
import { calendarHref } from '@/lib/calendar-view'
import Icon from '../../icons'
import { uuid } from '@/lib/uuid'

export type UpcomingVisit = {
  id: string; updatedAt: string; status: string; date: string | null; time: string | null
  address: string; price: number; inPlan: boolean
  service: string
  /** Recurring but in no plan: completing it needs a plan or an explicit one-time decision. */
  needsPlan: boolean
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

/** The customer's open visits, each with the everyday actions: done + paid, move, and plan fixes. */
export default function UpcomingVisits({ visits, nextScheduledOn }: { visits: UpcomingVisit[]; nextScheduledOn?: string }) {
  const [message, setMessage] = useState<Message>(null)
  const calendarDate = visits.length === 0 ? nextScheduledOn : undefined
  return <section className="crm-panel crm-customer-wide crm-upcoming" aria-label="Upcoming visits">
    <h2>Upcoming visits{calendarDate ? '' : ` (${visits.length})`}</h2>
    {visits.length ? visits.map(visit => <VisitRow key={visit.id} visit={visit} setMessage={setMessage} />)
      : calendarDate ? <p className="crm-muted"><Link href={calendarHref({ view: 'day', date: calendarDate, search: '' })}>
        View {dateLabel(calendarDate)} on Calendar</Link></p>
      : <p className="crm-muted">Nothing booked. Add a service to get started.</p>}
    {message && <div className={`crm-toast${message.error ? ' crm-toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>
      <span>{message.text}{message.reviewHref && <> <Link href={message.reviewHref}>Open visit to review completion</Link></>}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>×</button>
    </div>}
  </section>
}

type Message = { text: string; error: boolean; reviewHref?: string } | null

function VisitRow({ visit, setMessage }: {
  visit: UpcomingVisit; setMessage: (message: Message) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState<'done' | null>(null)
  const ops = useRef<Record<string, string>>({})
  const [doneOn, setDoneOn] = useState(today())
  const [amount, setAmount] = useState(visit.price > 0 ? visit.price.toFixed(2) : '')
  const [method, setMethod] = useState('Cash')

  const overdue = visit.date != null && visit.date < today()

  function op(name: string) {
    if (!ops.current[name]) ops.current[name] = uuid()
    return ops.current[name]
  }
  function run(action: () => Promise<ActionResult>, done: string) {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await action()
        if (!result.success) {
          setMessage({ text: result.error ?? 'Could not save.', error: true,
            reviewHref: result.data?.introReview?.extraReview ? `/admin/jobs/${visit.id}` : undefined })
          return
        }
        ops.current = {}
        setOpen(null)
        setMessage({ text: typeof result.data?.warning === 'string' ? result.data.warning : done, error: false })
        router.refresh()
      } catch {
        setMessage({ text: 'The request did not finish. Retry to check the same request.', error: true })
      }
    })
  }

  return <div className="crm-visit">
    <div className="crm-customer-entry">
      <div>
        <Link href={`/admin/jobs/${visit.id}`}><strong>{visit.date ? dateLabel(visit.date) : 'No date yet'}{visit.time ? ` · ${visit.time}` : ''}</strong></Link>
        <span>{visit.service} · {formatMoney(visit.price)} · {visit.address}</span>
      </div>
      <span className={`admin-badge admin-badge-${overdue ? 'pending' : visit.status}`}>{overdue ? 'Overdue' : jobStatusLabel(visit.status)}</span>
    </div>
    <div className="crm-visit-actions">
      {visit.needsPlan
        ? <Link className="crm-button crm-button-sm crm-button-primary" href={`/admin/jobs/${visit.id}`}>Choose a schedule</Link>
        : <button type="button" className={`crm-button crm-button-sm${open === 'done' ? ' crm-button-primary' : ''}`} disabled={pending}
            onClick={() => { setOpen(open === 'done' ? null : 'done'); setMessage(null) }}><Icon name="check" size={14} />Done</button>}
      <Link className="crm-button crm-button-sm" href={`/admin/jobs/${visit.id}`}><Icon name="calendar" size={14} />{visit.date ? 'Reschedule' : 'Set date'}</Link>
      {visit.needsPlan && <button type="button" className="crm-button crm-button-sm" disabled={pending}
        onClick={() => run(() => changeJob({ bookingId: visit.id, expectedUpdatedAt: visit.updatedAt, operationId: op('one-time'), action: 'mark_one_time' }),
          'Marked one-time. You can mark it done now.')}>Mark one-time</button>}
      <button type="button" className="crm-button crm-button-sm crm-button-ghost" disabled={pending}
        onClick={() => { if (window.confirm('Cancel this visit? It stays in history.')) run(() => changeJob({ bookingId: visit.id, expectedUpdatedAt: visit.updatedAt, operationId: op('cancel'), action: 'cancel' }), 'Visit canceled.') }}>Cancel visit</button>
    </div>
    {visit.needsPlan && <p className="crm-visit-note">Choose a matching service schedule, or mark this visit one-time.</p>}

    {open === 'done' && <div className="crm-visit-form" aria-label="Mark visit done">
      <div className="crm-sheet-grid">
        <label className="crm-field">Date done<input type="date" value={doneOn} onChange={e => setDoneOn(e.target.value)} /></label>
        <label className="crm-field">Paid now ($, optional)<input inputMode="decimal" value={amount} placeholder="0.00"
          onChange={e => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setAmount(e.target.value)} /></label>
        <label className="crm-field">Paid by<select value={method} onChange={e => setMethod(e.target.value)}>
          <option>Cash</option><option>Stripe</option><option>Venmo</option><option>Zelle</option><option>Other</option></select></label>
      </div>
      <p className="crm-visit-note">{visit.inPlan ? 'Future visits already follow the service schedule.' : 'One-off visit; nothing repeats.'} Leave Paid empty if they have not paid yet.</p>
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || !doneOn}
          onClick={() => run(() => finishVisit({ bookingId: visit.id, confirmOperationId: op('confirm'), completeOperationId: op('complete'),
            paymentOperationId: op('pay'), completedOn: doneOn, amount, method }),
            `Visit done${amount && Number(amount) > 0 ? ` and ${formatMoney(amount)} recorded` : ''}.${visit.inPlan ? ' Next visit is booked.' : ''}`)}>
          {amount && Number(amount) > 0 ? 'Mark done & record payment' : 'Mark done'}</button>
      </div>
    </div>}

  </div>
}
