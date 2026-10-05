'use client'

import { useState, useTransition } from 'react'
import { updateCompletedJob, deleteBooking } from '../actions'

interface Job {
  id: string
  name: string
  address: string
  payment_method: string | null
  amount_charged: number | null
  completed_at: string
}

function formatDate(dateStr: string) {
  return new Date(dateStr.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function CompletedJobRow({ job }: { job: Job }) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing]   = useState(false)
  const [amount, setAmount]     = useState(job.amount_charged ?? 0)
  const [method, setMethod]     = useState(job.payment_method ?? 'Stripe')

  function save() {
    setEditing(false)
    startTransition(() => updateCompletedJob(job.id, { amount_charged: amount, payment_method: method }))
  }

  if (editing) {
    return (
      <tr>
        <td>{formatDate(job.completed_at)}</td>
        <td style={{ fontWeight: 500 }}>{job.name}</td>
        <td style={{ color: 'var(--ink-soft)' }}>{job.address}</td>
        <td>
          <select
            value={method}
            onChange={e => setMethod(e.target.value)}
            className="admin-revenue-edit-select"
          >
            <option>Stripe</option>
            <option>Cash</option>
            <option>Venmo</option>
            <option>Zelle</option>
          </select>
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" step="0.01"
              value={amount}
              onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              className="admin-revenue-edit-input"
            />
            <button className="admin-revenue-row-save" onClick={save} disabled={pending}>Save</button>
            <button className="admin-revenue-row-cancel" onClick={() => setEditing(false)} disabled={pending}>×</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{formatDate(job.completed_at)}</td>
      <td style={{ fontWeight: 500 }}>{job.name}</td>
      <td style={{ color: 'var(--ink-soft)' }}>{job.address}</td>
      <td>{job.payment_method ?? '—'}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <span style={{ fontWeight: 600, color: 'var(--green-mid)' }}>${(job.amount_charged ?? 0).toFixed(2)}</span>
          <button className="admin-revenue-row-edit" onClick={() => setEditing(true)} disabled={pending} title="Edit amount / method">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button
            className="admin-revenue-row-delete"
            onClick={() => { if (window.confirm(`Delete this completed job for ${job.name}?`)) startTransition(() => deleteBooking(job.id)) }}
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
