'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addCustomerJob, startCustomerPlan } from '../../actions'
import { PLAN_SERVICES, planName, type JobLine } from '@/lib/crm-jobs'
import Icon from '../../icons'
import { uuid } from '@/lib/uuid'
import PlanEditor, { type EditablePlan } from './PlanEditor'

type OpenVisit = { id: string; date: string | null; price: number; recurring: boolean }
/** `plans`: names of the property's active or paused plans (a property can have mowing and maintenance). */
type Property = { id: string; address: string; plans: string[]; openVisits: OpenVisit[] }
type Line = { key: string; description: string; amount: string }

const blankLine = (): Line => ({ key: uuid(), description: '', amount: '' })

/** Where all later work for an existing customer starts: extra one-off jobs, and starting or editing plans. */
export default function CustomerActions({ customerId, properties, plans, firstName, canEmail }: {
  customerId: string; properties: Property[]; plans: EditablePlan[]; firstName: string; canEmail: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState<'job' | 'plan' | 'edit' | null>(null)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const ops = useRef<Record<string, string>>({})
  const planProperties = properties

  const [jobProperty, setJobProperty] = useState(properties[0]?.id ?? 'new')
  const [jobAddress, setJobAddress] = useState('')
  const [jobDate, setJobDate] = useState('')
  const [jobNotes, setJobNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const [discount, setDiscount] = useState('')

  const [planProperty, setPlanProperty] = useState(planProperties[0]?.id ?? 'new')
  const [planAddress, setPlanAddress] = useState('')
  const [planPrice, setPlanPrice] = useState('')
  const [planEvery, setPlanEvery] = useState('2-week')
  const [planDate, setPlanDate] = useState('')
  const [planFrom, setPlanFrom] = useState('new')
  const [planService, setPlanService] = useState(plans.length ? '' : 'Lawn care')
  const planVisits = properties.find(p => p.id === planProperty)?.openVisits ?? []
  const newPlanName = planName([{ kind: 'service', description: planService || 'Lawn care' }])
  const samePlanHere = properties.find(p => p.id === planProperty)?.plans.includes(newPlanName)

  /** A visit already booked at the property (a lead's recurring booking) becomes the first plan visit. */
  function choosePlanProperty(id: string) {
    setPlanProperty(id)
    const visit = (properties.find(p => p.id === id)?.openVisits ?? []).find(v => v.recurring)
    choosePlanFrom(visit?.id ?? 'new', id)
  }
  function choosePlanFrom(value: string, propertyId = planProperty) {
    setPlanFrom(value)
    const visit = (properties.find(p => p.id === propertyId)?.openVisits ?? []).find(v => v.id === value)
    if (visit?.date) setPlanDate(visit.date)
    if (visit && visit.price > 0 && !planPrice) setPlanPrice(visit.price.toFixed(2))
  }

  function op(name: string) {
    if (!ops.current[name]) ops.current[name] = uuid()
    return ops.current[name]
  }
  function finish(result: { success: boolean; error?: string }, done: string, resetOnError: string[] = []) {
    if (!result.success) {
      // A definite server rejection may be retried with edited values under a fresh operation.
      for (const name of resetOnError) delete ops.current[name]
      setMessage({ text: result.error ?? 'Could not save.', error: true }); return false
    }
    ops.current = {}
    setMessage({ text: done, error: false })
    setOpen(null)
    router.refresh()
    return true
  }

  function saveJob() {
    setMessage(null)
    const items: JobLine[] = lines.filter(l => l.description.trim() || l.amount.trim())
      .map(l => ({ kind: 'service', description: l.description, amount: l.amount.trim() || '0' }))
    if (discount.trim() && Number(discount) > 0) items.push({ kind: 'discount', description: 'Discount', amount: discount.trim() })
    startTransition(async () => {
      try {
        const result = await addCustomerJob({ operationId: op('job'), customerId, propertyId: jobProperty === 'new' ? null : jobProperty,
          newAddress: jobProperty === 'new' ? jobAddress : null, date: jobDate, notes: jobNotes, items })
        if (finish(result, 'Job added. Find it under Jobs to schedule it.', ['job'])) { setLines([blankLine()]); setDiscount(''); setJobDate(''); setJobNotes('') }
      } catch { setMessage({ text: 'Could not add the job. Retry to check the same request.', error: true }) }
    })
  }

  function savePlan() {
    setMessage(null)
    const [count, unit] = planEvery.split('-') as [string, 'week' | 'month']
    startTransition(async () => {
      try {
        const result = await startCustomerPlan({ jobOperationId: op('plan-job'), planOperationId: op('plan'), confirmOperationId: op('plan-confirm'), customerId,
          propertyId: planProperty === 'new' ? null : planProperty, newAddress: planProperty === 'new' ? planAddress : null,
          existingBookingId: planProperty !== 'new' && planFrom !== 'new' ? planFrom : null,
          firstDate: planDate, intervalUnit: unit, intervalCount: Number(count), pricePerVisit: planPrice.trim(), service: planService.trim() })
        if (finish(result, `${newPlanName} started. The first visit is under Upcoming visits.`)) setPlanService('')
      } catch { setMessage({ text: 'Could not start the plan. Retry to check the same request.', error: true }) }
    })
  }

  function openStartPlan() {
    if (open !== 'plan') choosePlanProperty(planProperty)
    setOpen(open === 'plan' ? null : 'plan'); setMessage(null)
  }

  const propertyPicker = (value: string, onChange: (v: string) => void, address: string, onAddress: (v: string) => void, list: Property[]) => <>
    <label className="crm-field">Property
      <select value={value} onChange={e => onChange(e.target.value)}>
        {list.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
        <option value="new">New address…</option>
      </select>
    </label>
    {value === 'new' && <label className="crm-field">Address<input value={address} onChange={e => onAddress(e.target.value)} placeholder="Street, city" maxLength={500} /></label>}
  </>

  return <>
    <div className="crm-customer-actions">
      <button type="button" className={`crm-button${open === 'job' ? ' crm-button-primary' : ''}`} onClick={() => { setOpen(open === 'job' ? null : 'job'); setMessage(null) }}>+ Add job</button>
      {plans.length > 0 && <button type="button" className={`crm-button${open === 'edit' ? ' crm-button-primary' : ''}`}
        onClick={() => { setOpen(open === 'edit' ? null : 'edit'); setMessage(null) }}><Icon name="calendar" size={15} />Edit plan</button>}
      <button type="button" className={`crm-button${open === 'plan' ? ' crm-button-primary' : plans.length ? ' crm-button-ghost' : ''}`} onClick={openStartPlan}>
        {plans.length ? '+ Another plan' : <><Icon name="calendar" size={15} />Start plan</>}</button>
    </div>

    {open === 'edit' && <PlanEditor plans={plans} firstName={firstName} canEmail={canEmail} onMessage={setMessage}
      onClose={() => setOpen(null)} onAddPlan={() => { setOpen(null); openStartPlan() }} />}

    {open === 'job' && <section className="crm-sheet" aria-label="Add job">
      <h2>Add a job</h2>
      <p>One-off work for this customer — a cleanup, mulch, an extra mow. The price is what they agreed to; nothing is sent to them.</p>
      <div className="crm-sheet-grid">
        {propertyPicker(jobProperty, setJobProperty, jobAddress, setJobAddress, properties)}
        <label className="crm-field">Visit date (optional)<input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} /></label>
      </div>
      {lines.map((line, i) => <div className="crm-line" key={line.key}>
        <label className="crm-field">Service<input value={line.description} maxLength={120} placeholder="Leaf cleanup, gutters…"
          onChange={e => setLines(lines.map(l => l.key === line.key ? { ...l, description: e.target.value } : l))} /></label>
        <label className="crm-field">Price ($)<input inputMode="decimal" value={line.amount} placeholder="0.00"
          onChange={e => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setLines(lines.map(l => l.key === line.key ? { ...l, amount: e.target.value } : l))} /></label>
        <button type="button" className="crm-price-remove" aria-label={`Remove service ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter(l => l.key !== line.key))}>×</button>
      </div>)}
      <button type="button" className="crm-price-add" onClick={() => setLines([...lines, blankLine()])}>+ Add service</button>
      <div className="crm-sheet-grid">
        <label className="crm-field">Discount ($, optional)<input inputMode="decimal" value={discount} placeholder="0.00" onChange={e => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setDiscount(e.target.value)} /></label>
      </div>
      <label className="crm-field">Notes (optional)<textarea value={jobNotes} maxLength={2000} onChange={e => setJobNotes(e.target.value)} /></label>
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={saveJob}>Add job</button>
        <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setOpen(null)}>Cancel</button>
      </div>
    </section>}

    {open === 'plan' && <section className="crm-sheet" aria-label="Start plan">
      <h2>Start a plan</h2>
      <p>Repeats a service on a schedule — mowing, maintenance, anything regular. Each visit you mark done books the next one.
        A property can have more than one plan. One-off work stays separate — use Add job. Nothing is sent to the customer.</p>
      <datalist id="start-plan-services">{PLAN_SERVICES.map(s => <option key={s} value={s} />)}</datalist>
      <div className="crm-sheet-grid">
        <label className="crm-field">Service<input value={planService} maxLength={120} list="start-plan-services" placeholder="Lawn care, Maintenance…"
          onChange={e => setPlanService(e.target.value)} /></label>
        {propertyPicker(planProperty, choosePlanProperty, planAddress, setPlanAddress, planProperties)}
        {planVisits.length > 0 && <label className="crm-field">First visit
          <select value={planFrom} onChange={e => choosePlanFrom(e.target.value)}>
            {planVisits.map(v => <option key={v.id} value={v.id}>Already booked{v.date ? ` · ${v.date}` : ''} · ${v.price.toFixed(2)}</option>)}
            <option value="new">A new visit</option>
          </select>
        </label>}
        <label className="crm-field">Price per visit ($)<input inputMode="decimal" value={planPrice} placeholder="45.00" onChange={e => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setPlanPrice(e.target.value)} /></label>
        <label className="crm-field">How often
          <select value={planEvery} onChange={e => setPlanEvery(e.target.value)}>
            <option value="1-week">Weekly</option><option value="2-week">Every 2 weeks</option>
            <option value="3-week">Every 3 weeks</option><option value="1-month">Monthly</option>
          </select>
        </label>
        <label className="crm-field">First visit<input type="date" value={planDate} onChange={e => setPlanDate(e.target.value)} /></label>
      </div>
      {samePlanHere && <p className="crm-visit-note">This property already has a {newPlanName.toLowerCase()}. To change it, use Edit plan instead.</p>}
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || !planDate || !planPrice || !planService.trim()} onClick={savePlan}>Start {newPlanName.toLowerCase()}</button>
        <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setOpen(null)}>Cancel</button>
      </div>
    </section>}

    {message && <div className={`crm-toast${message.error ? ' crm-toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>
      <span>{message.text}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>×</button>
    </div>}
  </>
}
