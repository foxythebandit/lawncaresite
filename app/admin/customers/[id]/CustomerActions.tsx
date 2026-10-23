'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addCustomerJob, startCustomerPlan } from '../../actions'
import type { JobLine } from '@/lib/crm-jobs'
import Icon from '../../icons'

type Property = { id: string; address: string; hasActivePlan: boolean }
type Line = { key: string; description: string; amount: string }

const blankLine = (): Line => ({ key: crypto.randomUUID(), description: '', amount: '' })

/** Where all later work for an existing customer starts: extra one-off jobs and mowing plans. */
export default function CustomerActions({ customerId, properties }: { customerId: string; properties: Property[] }) {
  const router = useRouter()
  const [open, setOpen] = useState<'job' | 'plan' | null>(null)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const ops = useRef<Record<string, string>>({})
  const planProperties = properties.filter(p => !p.hasActivePlan)

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

  function op(name: string) {
    if (!ops.current[name]) ops.current[name] = crypto.randomUUID()
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
        const result = await startCustomerPlan({ jobOperationId: op('plan-job'), planOperationId: op('plan'), customerId,
          propertyId: planProperty === 'new' ? null : planProperty, newAddress: planProperty === 'new' ? planAddress : null,
          firstDate: planDate, intervalUnit: unit, intervalCount: Number(count), pricePerVisit: planPrice.trim() })
        finish(result, 'Mowing plan started. The first visit is under Jobs.')
      } catch { setMessage({ text: 'Could not start the plan. Retry to check the same request.', error: true }) }
    })
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
      <button type="button" className={`crm-button${open === 'plan' ? ' crm-button-primary' : ''}`} onClick={() => { setOpen(open === 'plan' ? null : 'plan'); setMessage(null) }}><Icon name="calendar" size={15} />Start mowing plan</button>
    </div>

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

    {open === 'plan' && <section className="crm-sheet" aria-label="Start mowing plan">
      <h2>Start a mowing plan</h2>
      <p>Creates the first visit and repeats it on a schedule. Each finished visit creates the next one. Extra work stays separate — use Add job.</p>
      <div className="crm-sheet-grid">
        {propertyPicker(planProperty, setPlanProperty, planAddress, setPlanAddress, planProperties)}
        <label className="crm-field">Price per visit ($)<input inputMode="decimal" value={planPrice} placeholder="45.00" onChange={e => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setPlanPrice(e.target.value)} /></label>
        <label className="crm-field">How often
          <select value={planEvery} onChange={e => setPlanEvery(e.target.value)}>
            <option value="1-week">Weekly</option><option value="2-week">Every 2 weeks</option>
            <option value="3-week">Every 3 weeks</option><option value="1-month">Monthly</option>
          </select>
        </label>
        <label className="crm-field">First visit<input type="date" value={planDate} onChange={e => setPlanDate(e.target.value)} /></label>
      </div>
      <div className="crm-action-row">
        <button type="button" className="crm-button crm-button-primary" disabled={pending || !planDate || !planPrice} onClick={savePlan}>Start plan</button>
        <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setOpen(null)}>Cancel</button>
      </div>
    </section>}

    {message && <div className={`crm-toast${message.error ? ' crm-toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>
      <span>{message.text}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>×</button>
    </div>}
  </>
}
