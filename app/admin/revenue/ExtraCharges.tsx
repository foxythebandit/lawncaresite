'use client'

import { useState, useTransition } from 'react'
import { addExtraCharge, updateExtraCharge, deleteExtraCharge, type ExtraCharge } from '../actions'

const QUICK_SERVICES = ['Garden bed cleanup', 'Shrub trimming', 'Yard clearout', 'Leaf cleanup', 'Mulch install', 'Haul-off']
const METHODS = ['Cash', 'Venmo', 'Zelle', 'Stripe']

type Client = { name: string; phone: string }

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function AddChargeForm({ clients, onDone }: { clients: Client[]; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [clientKey, setClientKey]  = useState(clients[0]?.phone ?? '__new')
  const [newName, setNewName]      = useState('')
  const [description, setDesc]     = useState('')
  const [amount, setAmount]        = useState('')
  const [date, setDate]            = useState(today())
  const [method, setMethod]        = useState('Cash')
  const [error, setError]          = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const client = clients.find(c => c.phone === clientKey)
    const client_name = client ? client.name : newName
    startTransition(async () => {
      const res = await addExtraCharge({
        charged_on: date,
        client_name,
        phone: client?.phone ?? null,
        description,
        amount: parseFloat(amount),
        payment_method: method,
      })
      if (res?.error) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form className="admin-extra-form" onSubmit={submit}>
      <label className="admin-extra-field">
        <span>Client</span>
        <select value={clientKey} onChange={e => setClientKey(e.target.value)} className="admin-revenue-edit-select">
          {clients.map(c => <option key={c.phone} value={c.phone}>{c.name}</option>)}
          <option value="__new">+ Someone not in bookings</option>
        </select>
      </label>
      {clientKey === '__new' && (
        <label className="admin-extra-field">
          <span>Name</span>
          <input value={newName} onChange={e => setNewName(e.target.value)} className="admin-revenue-edit-select" placeholder="Client name" required />
        </label>
      )}
      <label className="admin-extra-field admin-extra-field-wide">
        <span>What you did</span>
        <input value={description} onChange={e => setDesc(e.target.value)} className="admin-revenue-edit-select" placeholder="e.g. Front bed cleanup, 6 bags hauled" required />
        <div className="admin-extra-chips">
          {QUICK_SERVICES.map(s => (
            <button type="button" key={s} className="admin-extra-chip" onClick={() => setDesc(s)}>{s}</button>
          ))}
        </div>
      </label>
      <label className="admin-extra-field">
        <span>Amount</span>
        <input type="number" step="0.01" min="0" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="admin-revenue-edit-select" placeholder="$0.00" required />
      </label>
      <label className="admin-extra-field">
        <span>Date</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="admin-revenue-edit-select" required />
      </label>
      <label className="admin-extra-field">
        <span>Paid by</span>
        <select value={method} onChange={e => setMethod(e.target.value)} className="admin-revenue-edit-select">
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
      </label>
      {error && <div className="admin-extra-error">{error}</div>}
      <div className="admin-extra-actions">
        <button type="submit" className="admin-revenue-row-save" disabled={pending}>{pending ? 'Saving…' : 'Add charge'}</button>
        <button type="button" className="admin-revenue-row-cancel" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </form>
  )
}

function ChargeRow({ charge }: { charge: ExtraCharge }) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [description, setDesc] = useState(charge.description)
  const [amount, setAmount]    = useState(charge.amount)
  const [method, setMethod]    = useState(charge.payment_method ?? 'Cash')
  const [date, setDate]        = useState(charge.charged_on)

  function save() {
    setEditing(false)
    startTransition(() => updateExtraCharge(charge.id, {
      charged_on: date,
      client_name: charge.client_name,
      phone: charge.phone,
      description,
      amount,
      payment_method: method,
    }))
  }

  if (editing) {
    return (
      <tr>
        <td><input type="date" value={date} onChange={e => setDate(e.target.value)} className="admin-revenue-edit-select" /></td>
        <td style={{ fontWeight: 500 }}>{charge.client_name}</td>
        <td><input value={description} onChange={e => setDesc(e.target.value)} className="admin-revenue-edit-select" style={{ width: '100%' }} /></td>
        <td>
          <select value={method} onChange={e => setMethod(e.target.value)} className="admin-revenue-edit-select">
            {METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="admin-revenue-edit-input" />
            <button className="admin-revenue-row-save" onClick={save} disabled={pending}>Save</button>
            <button className="admin-revenue-row-cancel" onClick={() => setEditing(false)} disabled={pending}>×</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{formatDate(charge.charged_on)}</td>
      <td style={{ fontWeight: 500 }}>
        {charge.phone
          ? <a href={`/admin/client/${encodeURIComponent(charge.phone)}`} style={{ color: 'inherit', textDecoration: 'none' }}>{charge.client_name}</a>
          : charge.client_name}
      </td>
      <td style={{ color: 'var(--ink-soft)' }}>{charge.description}</td>
      <td>{charge.payment_method ?? '—'}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <span style={{ fontWeight: 600, color: 'var(--green-mid)' }}>${charge.amount.toFixed(2)}</span>
          <button className="admin-revenue-row-edit" onClick={() => setEditing(true)} disabled={pending} title="Edit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button
            className="admin-revenue-row-delete"
            onClick={() => { if (window.confirm(`Delete "${charge.description}" for ${charge.client_name}?`)) startTransition(() => deleteExtraCharge(charge.id)) }}
            disabled={pending}
            title="Delete"
          >
            ×
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function ExtraCharges({ charges, clients }: { charges: ExtraCharge[]; clients: Client[] }) {
  const [adding, setAdding] = useState(false)
  const total = charges.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="admin-revenue-card" style={{ marginTop: 12 }}>
      <div className="admin-extra-head">
        <div className="admin-revenue-card-title" style={{ marginBottom: 0 }}>
          Extra Services{charges.length > 0 && <> · ${total.toLocaleString()}</>}
        </div>
        {!adding && (
          <button className="admin-revenue-row-save" onClick={() => setAdding(true)}>+ Add charge</button>
        )}
      </div>
      <p className="admin-extra-hint">Bed cleanups, trims and other one-time work you billed outside a booking. Counts toward total earned and the monthly chart.</p>

      {adding && <AddChargeForm clients={clients} onDone={() => setAdding(false)} />}

      {charges.length === 0 ? (
        !adding && <div className="admin-empty" style={{ padding: '24px 20px' }}>No extra charges yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-revenue-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Service</th>
                <th>Method</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {charges.map(c => <ChargeRow key={c.id} charge={c} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
