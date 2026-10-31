'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addVisitToPlan, changeJob, finishVisit, moveVisit } from '../../actions'
import { formatMoney, jobStatusLabel } from '@/lib/crm-jobs'
import Icon from '../../icons'
import { uuid } from '@/lib/uuid'

export type UpcomingVisit = {
  id: string; updatedAt: string; status: string; date: string | null; time: string | null
  address: string; price: number; inPlan: boolean
  /** Active plan at this visit's property that the visit could join (a lead's recurring booking). */
  joinPlanId: string | null
  /** Recurring but in no plan: completing it needs a plan or an explicit one-time decision. */
  needsPlan: boolean
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)

/** The customer's open visits, each with the everyday actions: done + paid, move, and plan fixes. */
export default function UpcomingVisits({ visits, firstName, hasEmail, emailConfigured }: {
  visits: UpcomingVisit[]; firstName: string; hasEmail: boolean; emailConfigured: boolean
}) {
  const [message, setMessage] = useState<Message>(null)
  return <section className="crm-panel crm-customer-wide crm-upcoming" aria-label="Upcoming visits">
    <h2>Upcoming visits ({visits.length})</h2>
    {visits.length ? visits.map(visit => <VisitRow key={visit.id} visit={visit} firstName={firstName}
      canEmail={hasEmail && emailConfigured} setMessage={setMessage} />)
      : <p className="crm-muted">Nothing booked. Use + Add job or Start mowing plan.</p>}
    {message && <div className={`crm-toast${message.error ? ' crm-toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>
      <span>{message.text}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>×</button>
    </div>}
  </section>
}

type Message = { text: string; error: boolean } | null

function VisitRow({ visit, firstName, canEmail, setMessage }: {
  visit: UpcomingVisit; firstName: string; canEmail: boolean; setMessage: (message: Message) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState<'done' | 'move' | null>(null)
  const ops = useRef<Record<string, string>>({})
  const [doneOn, setDoneOn] = useState(today())
  const [amount, setAmount] = useState(visit.price > 0 ? visit.price.toFixed(2) : '')
  const [method, setMethod] = useState('Cash')
  const [moveTo, setMoveTo] = useState(visit.date ?? '')
  const [moveTime, setMoveTime] = useState(visit.time ?? '')
  const [wholePlan, setWholePlan] = useState(false)
  const [email, setEmail] = useState(canEmail)

  const overdue = visit.date != null && visit.date < today()
  const shift = visit.date && moveTo ? daysBetween(visit.date, moveTo) : 0

  function op(name: string) {
    if (!ops.current[name]) ops.current[name] = uuid()
    return ops.current[name]
  }
  function run(action: () => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>, done: string) {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await action()
        if (!result.success) { setMessage({ text: result.error ?? 'Could not save.', error: true }); return }
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
        <strong>{visit.date ? dateLabel(visit.date) : 'No date yet'}{visit.time ? ` · ${visit.time}` : ''}</strong>
        <span>{formatMoney(visit.price)} · {visit.inPlan ? 'Mowing plan visit' : visit.needsPlan ? 'Recurring, not in a plan' : 'One-off'} · {visit.address}</span>
      </div>
      <span className={`admin-badge admin-badge-${overdue ? 'pending' : visit.status}`}>{overdue ? 'Overdue' : jobStatusLabel(visit.status)}</span>
    </div>
    <div className="crm-visit-actions">
      {visit.needsPlan && visit.joinPlanId
        ? <button type="button" className="crm-button crm-button-sm crm-button-primary" disabled={pending}
            onClick={() => run(() => addVisitToPlan({ bookingId: visit.id, expectedUpdatedAt: visit.updatedAt, operationId: op('join'), agreementId: visit.joinPlanId! }),
              'Added to the mowing plan. Mark it done when the visit happens.')}>Add to mowing plan</button>
        : <button type="button" className={`crm-button crm-button-sm${open === 'done' ? ' crm-button-primary' : ''}`} disabled={pending || visit.needsPlan}
            onClick={() => { setOpen(open === 'done' ? null : 'done'); setMessage(null) }}><Icon name="check" size={14} />Done</button>}
      <button type="button" className={`crm-button crm-button-sm${open === 'move' ? ' crm-button-primary' : ''}`} disabled={pending}
        onClick={() => { setOpen(open === 'move' ? null : 'move'); setMessage(null) }}><Icon name="calendar" size={14} />{visit.date ? 'Move' : 'Set date'}</button>
      {visit.needsPlan && !visit.joinPlanId && <button type="button" className="crm-button crm-button-sm" disabled={pending}
        onClick={() => run(() => changeJob({ bookingId: visit.id, expectedUpdatedAt: visit.updatedAt, operationId: op('one-time'), action: 'mark_one_time' }),
          'Marked one-time. You can mark it done now.')}>Mark one-time</button>}
      <button type="button" className="crm-button crm-button-sm crm-button-ghost" disabled={pending}
        onClick={() => { if (window.confirm('Cancel this visit? It stays in history.')) run(() => changeJob({ bookingId: visit.id, expectedUpdatedAt: visit.updatedAt, operationId: op('cancel'), action: 'cancel' }), 'Visit canceled.') }}>Cancel visit</button>
    </div>
    {visit.needsPlan && <p className="crm-visit-note">{visit.joinPlanId
      ? 'Booked as recurring but not in the mowing plan. Add it to the plan; it keeps its own price and the plan continues from its date.'
      : 'Booked as recurring but there is no mowing plan. Start one above (it can begin from this visit) or mark this visit one-time.'}</p>}

    {open === 'done' && <div className="crm-visit-form" aria-label="Mark visit done">
      <div className="crm-sheet-grid">
        <label className="crm-field">Date done<input type="date" value={doneOn} onChange={e => setDoneOn(e.target.value)} /></label>
        <label className="crm-field">Paid now ($, optional)<input inputMode="decimal" value={amount} placeholder="0.00"
          onChange={e => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setAmount(e.target.value)} /></label>
        <label className="crm-field">Paid by<select value={method} onChange={e => setMethod(e.target.value)}>
          <option>Cash</option><option>Stripe</option><option>Venmo</option><option>Zelle</option><option>Other</option></select></label>
      </div>
      <p className="crm-visit-note">{visit.inPlan ? 'The mowing plan books the next visit automatically.' : 'One-off visit; nothing repeats.'} Leave Paid empty if they have not paid yet.</p>
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || !doneOn}
          onClick={() => run(() => finishVisit({ bookingId: visit.id, confirmOperationId: op('confirm'), completeOperationId: op('complete'),
            paymentOperationId: op('pay'), completedOn: doneOn, amount, method }),
            `Visit done${amount && Number(amount) > 0 ? ` and ${formatMoney(amount)} recorded` : ''}.${visit.inPlan ? ' Next visit is booked.' : ''}`)}>
          {amount && Number(amount) > 0 ? 'Mark done & record payment' : 'Mark done'}</button>
      </div>
    </div>}

    {open === 'move' && <div className="crm-visit-form" aria-label="Move visit">
      <div className="crm-sheet-grid">
        <label className="crm-field">New date<input type="date" value={moveTo} onChange={e => setMoveTo(e.target.value)} /></label>
        <label className="crm-field">Time (optional)<input value={moveTime} placeholder="Morning, Afternoon, 9:00" onChange={e => setMoveTime(e.target.value)} /></label>
      </div>
      {visit.inPlan && <label className="crm-check"><input type="checkbox" checked={wholePlan} onChange={e => setWholePlan(e.target.checked)} />
        Move the rest of the plan too{shift ? ` (every later visit ${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'} ${shift < 0 ? 'earlier' : 'later'})` : ''}</label>}
      {canEmail && <label className="crm-check"><input type="checkbox" checked={email} onChange={e => setEmail(e.target.checked)} />Email {firstName} the new date</label>}
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || !moveTo || (moveTo === visit.date && moveTime === (visit.time ?? ''))}
          onClick={() => run(() => moveVisit({ bookingId: visit.id, expectedUpdatedAt: visit.updatedAt, operationId: op(`move:${moveTo}:${moveTime}:${wholePlan}`),
            date: moveTo, time: moveTime, wholePlan: visit.inPlan && wholePlan, email: canEmail && email }),
            wholePlan && visit.inPlan ? 'Visit moved; the plan now runs from the new date.' : 'Only this visit moved.')}>
          {wholePlan && visit.inPlan ? 'Move visit & plan' : 'Move this visit'}</button>
      </div>
    </div>}

  </div>
}
