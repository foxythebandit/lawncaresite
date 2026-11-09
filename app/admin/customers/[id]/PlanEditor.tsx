'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { changeAgreement, changePlanSchedule, moveVisit, pausePlan, savePlanItems } from '../../actions'
import { addInterval, cadenceText, formatMoney, PLAN_SERVICES, planName, type JobLine } from '@/lib/crm-jobs'
import { uuid } from '@/lib/uuid'

export type EditablePlan = {
  id: string; updatedAt: string; status: 'active' | 'paused'; name: string; address: string
  items: JobLine[]; price: number; intervalUnit: 'week' | 'month'; intervalCount: number
  /** The plan's next open visit (may be overdue); Move plan starts from it. */
  next: { id: string; updatedAt: string; date: string | null; occurrenceOn: string | null; time: string | null; price: number } | null
  /** Unfinished visits that pause/end would cancel (same rule as the server's preview check). */
  futureVisits: { id: string; date: string | null }[]
}

type Message = { text: string; error: boolean }
type Line = { key: string; description: string; amount: string }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)
const moneyInput = /^\d{0,8}(\.\d{0,2})?$/
const EVERY = [['1-week', 'Weekly'], ['2-week', 'Every 2 weeks'], ['3-week', 'Every 3 weeks'], ['1-month', 'Monthly']] as const
const listDates = (dates: (string | null)[]) => dates.map(d => d ? dateLabel(d) : 'no date').join(', ')

/** One place to manage a plan: price, how often, next date, pause/resume/end. Nothing emails unless ticked. */
export default function PlanEditor({ plans, firstName, canEmail, onClose, onMessage, onAddPlan }: {
  plans: EditablePlan[]; firstName: string; canEmail: boolean
  onClose: () => void; onMessage: (message: Message | null) => void; onAddPlan: () => void
}) {
  const [selected, setSelected] = useState(plans[0]?.id ?? '')
  const plan = plans.find(p => p.id === selected) ?? plans[0]
  if (!plan) return null
  return <section className="crm-sheet crm-plan-editor" aria-label="Edit plan">
    <h2>Edit plan</h2>
    {plans.length > 1 && <label className="crm-field">Plan
      <select value={plan.id} onChange={e => { setSelected(e.target.value); onMessage(null) }}>
        {plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.address}{p.status === 'paused' ? ' (paused)' : ''}</option>)}
      </select>
    </label>}
    <p>{plan.name} at {plan.address} · {cadenceText(plan.intervalUnit, plan.intervalCount)} · {formatMoney(plan.price)} a visit
      {plan.status === 'paused' ? ' · Paused' : ''}. Changes never touch done or past visits, and nothing is sent to {firstName} unless you tick the email box.</p>
    <PlanForm key={plan.id} plan={plan} firstName={firstName} canEmail={canEmail} onClose={onClose} onMessage={onMessage} />
    <div className="crm-plan-section">
      <h3>Different property or customer</h3>
      <p className="crm-visit-note">A plan can&apos;t be moved to another address or customer here: its past visits and payments belong
        to this address and stay with it. End this plan below, then start a new plan at the other property.</p>
      <div className="crm-action-row"><button type="button" className="crm-button crm-button-sm" onClick={onAddPlan}>+ Start another plan</button></div>
    </div>
    <div className="crm-action-row"><button type="button" className="crm-button crm-button-ghost" onClick={onClose}>Close</button></div>
  </section>
}

function PlanForm({ plan, firstName, canEmail, onClose, onMessage }: {
  plan: EditablePlan; firstName: string; canEmail: boolean; onClose: () => void; onMessage: (message: Message | null) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const ops = useRef<Record<string, string>>({})

  const services = plan.items.filter(item => item.kind === 'service')
  const startDiscount = plan.items.filter(item => item.kind === 'discount')
    .reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)
  const [lines, setLines] = useState<Line[]>(() => (services.length ? services : [{ kind: 'service', description: 'Lawn care', amount: String(plan.price) }])
    .map(item => ({ key: uuid(), description: item.description, amount: Number(item.amount).toFixed(2) })))
  const [discount, setDiscount] = useState(startDiscount ? startDiscount.toFixed(2) : '')
  const [alsoNext, setAlsoNext] = useState(false)

  const current = `${plan.intervalCount}-${plan.intervalUnit}`
  const [every, setEvery] = useState(current)

  const [moveTo, setMoveTo] = useState(plan.next?.date ?? '')
  const [moveTime, setMoveTime] = useState(plan.next?.time ?? '')
  const [email, setEmail] = useState(false) // explicit opt-in, always starts unticked
  const [bookOn, setBookOn] = useState('')

  const [restartOn, setRestartOn] = useState('')
  const [resumeOn, setResumeOn] = useState('')

  function op(name: string) {
    if (!ops.current[name]) ops.current[name] = uuid()
    return ops.current[name]
  }
  function run(action: () => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>, done: string) {
    onMessage(null)
    startTransition(async () => {
      try {
        const result = await action()
        // A failed step keeps its operation ID, so Retry replays anything that did save.
        if (!result.success) { onMessage({ text: result.error ?? 'Could not save.', error: true }); return }
        ops.current = {}
        onMessage({ text: typeof result.data?.warning === 'string' ? result.data.warning : done, error: false })
        onClose()
        router.refresh()
      } catch {
        onMessage({ text: 'The request did not finish. Retry to check the same request.', error: true })
      }
    })
  }

  // What each visit is and costs.
  const newItems: JobLine[] = [
    ...lines.filter(l => l.description.trim() || l.amount.trim()).map(l => ({ kind: 'service' as const, description: l.description.trim(), amount: l.amount.trim() || '0' })),
    ...(Number(discount) > 0 ? [{ kind: 'discount' as const, description: plan.items.find(i => i.kind === 'discount')?.description || 'Discount', amount: discount.trim() }] : []),
  ]
  const newTotal = newItems.reduce((sum, item) => sum + (item.kind === 'discount' ? -1 : 1) * Number(item.amount || 0), 0)
  const itemsKey = JSON.stringify(newItems.map(i => [i.kind, i.description, Number(i.amount)]))
  const itemsChanged = itemsKey !== JSON.stringify(plan.items.map(i => [i.kind, i.description.trim(), Math.abs(Number(i.amount))]))
  const newName = planName(newItems)

  // How often: the next visit keeps its date and later ones follow the new spacing.
  const [count, unit] = every.split('-') as [string, 'week' | 'month']
  const from = plan.next?.occurrenceOn ?? null
  const preview = from ? [1, 2, 3].map(k => addInterval(from, unit, Number(count) * k)) : []

  const shift = plan.next?.date && moveTo ? daysBetween(plan.next.date, moveTo) : 0
  const cancelDates = listDates(plan.futureVisits.map(v => v.date))
  const n = plan.futureVisits.length
  const visitsText = `${n} upcoming visit${n === 1 ? '' : 's'}`

  return <>
    <div className="crm-plan-section">
      <h3>Service and price per visit</h3>
      <datalist id={`plan-services-${plan.id}`}>{PLAN_SERVICES.map(s => <option key={s} value={s} />)}</datalist>
      {lines.map((line, i) => <div className="crm-line" key={line.key}>
        <label className="crm-field">Service<input value={line.description} maxLength={120} list={`plan-services-${plan.id}`} placeholder="Lawn care, Maintenance…"
          onChange={e => setLines(lines.map(l => l.key === line.key ? { ...l, description: e.target.value } : l))} /></label>
        <label className="crm-field">Price ($)<input inputMode="decimal" value={line.amount} placeholder="0.00"
          onChange={e => moneyInput.test(e.target.value) && setLines(lines.map(l => l.key === line.key ? { ...l, amount: e.target.value } : l))} /></label>
        <button type="button" className="crm-price-remove" aria-label={`Remove service ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter(l => l.key !== line.key))}>×</button>
      </div>)}
      <button type="button" className="crm-price-add" onClick={() => setLines([...lines, { key: uuid(), description: '', amount: '' }])}>+ Add service</button>
      <div className="crm-sheet-grid">
        <label className="crm-field">Discount per visit ($, optional)<input inputMode="decimal" value={discount} placeholder="0.00"
          onChange={e => moneyInput.test(e.target.value) && setDiscount(e.target.value)} /></label>
      </div>
      <p className="crm-visit-note">New total {formatMoney(Math.max(newTotal, 0))} a visit{newName !== plan.name ? ` · becomes a ${newName.toLowerCase()}` : ''}.
        Visits booked from now on use it; done visits keep what they cost.</p>
      {plan.next && <label className="crm-check"><input type="checkbox" checked={alsoNext} onChange={e => setAlsoNext(e.target.checked)} />
        Also change the booked next visit{plan.next.date ? ` (${dateLabel(plan.next.date)})` : ''} from {formatMoney(plan.next.price)} to {formatMoney(Math.max(newTotal, 0))}</label>}
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || !itemsChanged || newTotal <= 0}
          onClick={() => run(() => savePlanItems({ agreementId: plan.id, expectedUpdatedAt: plan.updatedAt, operationId: op(`items:${itemsKey}`), items: newItems,
            visit: alsoNext && plan.next ? { bookingId: plan.next.id, expectedUpdatedAt: plan.next.updatedAt, operationId: op(`visit:${itemsKey}`) } : null }),
            `Saved: ${formatMoney(newTotal)} a visit${alsoNext ? ', including the next visit' : ' from the visit after next'}.`)}>Save price</button>
      </div>
    </div>

    <div className="crm-plan-section">
      <h3>How often</h3>
      <div className="crm-sheet-grid">
        <label className="crm-field">Visits
          <select value={every} onChange={e => setEvery(e.target.value)}>
            {!EVERY.some(([value]) => value === current) && <option value={current}>{cadenceText(plan.intervalUnit, plan.intervalCount)} (now)</option>}
            {EVERY.map(([value, label]) => <option key={value} value={value}>{label}{value === current ? ' (now)' : ''}</option>)}
          </select>
        </label>
      </div>
      {every !== current && <p className="crm-visit-note">{from
        ? `Next visit stays ${dateLabel(from)}; then ${listDates(preview)}…`
        : 'Nothing is booked; the new spacing starts when the plan resumes or books its next visit.'}</p>}
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || every === current}
          onClick={() => run(() => changePlanSchedule({ agreementId: plan.id, expectedUpdatedAt: plan.updatedAt, operationId: op(`every:${every}`),
            intervalUnit: unit, intervalCount: Number(count) }), `Now ${cadenceText(unit, Number(count))}.`)}>Change how often</button>
      </div>
    </div>

    {plan.status === 'active' && <div className="crm-plan-section">
      <h3>Next visit date</h3>
      {plan.next ? <>
        <div className="crm-sheet-grid">
          <label className="crm-field">Next visit<input type="date" value={moveTo} onChange={e => setMoveTo(e.target.value)} /></label>
          <label className="crm-field">Time (optional)<input value={moveTime} placeholder="Morning, Afternoon, 9:00" onChange={e => setMoveTime(e.target.value)} /></label>
        </div>
        <p className="crm-visit-note">Moves the whole plan: {shift ? `the next visit and every later one ${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'} ${shift < 0 ? 'earlier' : 'later'}` : 'later visits follow the new date'}.
          To move just one visit, use Move on it under Upcoming visits.</p>
        {canEmail && <label className="crm-check"><input type="checkbox" checked={email} onChange={e => setEmail(e.target.checked)} />Email {firstName} the new date</label>}
        <div className="crm-action-row">
          <button type="button" className="crm-button crm-button-primary" disabled={pending || !moveTo || (moveTo === plan.next.date && moveTime === (plan.next.time ?? ''))}
            onClick={() => run(() => moveVisit({ bookingId: plan.next!.id, expectedUpdatedAt: plan.next!.updatedAt, operationId: op(`move:${moveTo}:${moveTime}`),
              date: moveTo, time: moveTime, wholePlan: true, email: canEmail && email }), `Plan moved; next visit ${dateLabel(moveTo)}.`)}>Move plan</button>
        </div>
      </> : <>
        <p className="crm-visit-note">No visit is booked for this plan. Pick the date of the next one; the plan repeats from there.</p>
        <div className="crm-sheet-grid">
          <label className="crm-field">Next visit<input type="date" min={today()} value={bookOn} onChange={e => setBookOn(e.target.value)} /></label>
        </div>
        <div className="crm-action-row">
          <button type="button" className="crm-button crm-button-primary" disabled={pending || !bookOn || bookOn < today()}
            onClick={() => run(() => pausePlan({ agreementId: plan.id, expectedUpdatedAt: plan.updatedAt, pauseOperationId: op(`book-pause:${bookOn}`),
              resumeOperationId: op(`book:${bookOn}`), futureJobIds: plan.futureVisits.map(v => v.id), resumeOn: bookOn }), `Next visit booked for ${dateLabel(bookOn)}.`)}>Book the next visit</button>
        </div>
      </>}
    </div>}

    <div className="crm-plan-section">
      <h3>{plan.status === 'paused' ? 'Resume or end' : 'Pause or end'}</h3>
      {plan.status === 'active' ? <>
        <div className="crm-sheet-grid">
          <label className="crm-field">Restart on (optional)<input type="date" min={today()} value={restartOn} onChange={e => setRestartOn(e.target.value)} /></label>
        </div>
        <p className="crm-visit-note">{n ? `Pausing cancels ${visitsText} (${cancelDates}); they stay in history.` : 'No upcoming visits to cancel.'} Done and overdue visits stay as they are.
          {restartOn ? ` The plan restarts on ${dateLabel(restartOn)} with a visit that day.` : ' Without a restart date it waits until you press Resume.'}</p>
        <div className="crm-action-row">
          <button type="button" className="crm-button" disabled={pending || Boolean(restartOn && restartOn < today())}
            onClick={() => { if (window.confirm(restartOn ? `Pause the plan until ${dateLabel(restartOn)} and cancel ${visitsText}?` : `Pause the plan and cancel ${visitsText}?`))
              run(() => pausePlan({ agreementId: plan.id, expectedUpdatedAt: plan.updatedAt, pauseOperationId: op(`pause:${plan.futureVisits.map(v => v.id).join(',')}`),
                resumeOperationId: op(`restart:${restartOn}`), futureJobIds: plan.futureVisits.map(v => v.id), resumeOn: restartOn || null }),
                restartOn ? `Paused; next visit ${dateLabel(restartOn)}.` : 'Plan paused. Use Edit plan → Resume to restart it.') }}>
            {restartOn ? `Pause until ${dateLabel(restartOn)}` : 'Pause plan'}</button>
        </div>
      </> : <>
        <div className="crm-sheet-grid">
          <label className="crm-field">Resume on<input type="date" min={today()} value={resumeOn} onChange={e => setResumeOn(e.target.value)} /></label>
        </div>
        <p className="crm-visit-note">Books a visit on that date; the plan repeats {cadenceText(plan.intervalUnit, plan.intervalCount)} from there.</p>
        <div className="crm-action-row">
          <button type="button" className="crm-button crm-button-primary" disabled={pending || !resumeOn || resumeOn < today()}
            onClick={() => run(() => changeAgreement({ agreementId: plan.id, expectedUpdatedAt: plan.updatedAt, operationId: op(`resume:${resumeOn}`),
              action: 'resume', nextOn: resumeOn }), `Plan resumed; next visit ${dateLabel(resumeOn)}.`)}>Resume plan</button>
        </div>
      </>}
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-danger" disabled={pending}
          onClick={() => { if (window.confirm(`End the ${plan.name.toLowerCase()}${n ? ` and cancel ${visitsText}` : ''}? It cannot restart; done visits stay in history.`))
            run(() => changeAgreement({ agreementId: plan.id, expectedUpdatedAt: plan.updatedAt, operationId: op(`end:${plan.futureVisits.map(v => v.id).join(',')}`),
              action: 'end', futureJobIds: plan.futureVisits.map(v => v.id) }), `${plan.name} ended.`) }}>End plan</button>
      </div>
    </div>
  </>
}
