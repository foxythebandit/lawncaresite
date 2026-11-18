'use client'

import Link from 'next/link'
import { serviceEditorHref } from '@/lib/service-schedules'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addCustomerJob } from '../../actions'
import type { JobLine } from '@/lib/crm-jobs'
import Icon from '../../icons'
import { uuid } from '@/lib/uuid'

type Property = { id: string; address: string }
type Line = { key: string; description: string; amount: string }

const blankLine = (): Line => ({ key: uuid(), description: '', amount: '' })

/** New services and itemized one-off visits for an existing customer. */
export default function CustomerActions({ customerId, properties }: { customerId: string; properties: Property[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const ops = useRef<Record<string, string>>({})

  const [jobProperty, setJobProperty] = useState(properties[0]?.id ?? 'new')
  const [jobAddress, setJobAddress] = useState('')
  const [jobDate, setJobDate] = useState('')
  const [jobNotes, setJobNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const [discount, setDiscount] = useState('')

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
    setOpen(false)
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
        if (finish(result, 'Visit added. Find it under Needs scheduling in Calendar.', ['job'])) { setLines([blankLine()]); setDiscount(''); setJobDate(''); setJobNotes('') }
      } catch { setMessage({ text: 'Could not add the visit. Retry to check the same request.', error: true }) }
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
      <Link className="crm-button crm-button-primary" href={serviceEditorHref(customerId)}><Icon name="calendar" size={15} />Add visit</Link>
      <button type="button" className="crm-button" onClick={() => { setOpen(!open); setMessage(null) }}>Add itemized visit</button>
    </div>

    {open && <section className="crm-sheet" aria-label="Add itemized visit">
      <h2>Add an itemized visit</h2>
      <p>Use multiple service lines or an agreed discount for a single visit.</p>
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
        <button type="button" className="crm-button crm-button-primary" disabled={pending} onClick={saveJob}>Add visit</button>
        <button type="button" className="crm-button crm-button-ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>}

    {message && <div className={`crm-toast${message.error ? ' crm-toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>
      <span>{message.text}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>×</button>
    </div>}
  </>
}
