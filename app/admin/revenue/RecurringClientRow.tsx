'use client'

import { useTransition } from 'react'
import { deleteBooking } from '../actions'

interface Props {
  id: string
  phone: string
  name: string
  annual: number
  widthPct: number
}

export default function RecurringClientRow({ id, phone, name, annual, widthPct }: Props) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="admin-expected-bar-row">
      <a href={`/admin/client/${encodeURIComponent(phone)}`} className="admin-expected-bar-name" style={{ textDecoration: 'none', color: 'inherit' }}>
        {name}
      </a>
      <div className="admin-expected-bar-track">
        <div className="admin-expected-bar-fill" style={{ width: `${widthPct}%` }} />
      </div>
      <span className="admin-expected-bar-val">${annual.toLocaleString()}/yr</span>
      <button
        className="admin-revenue-row-delete"
        onClick={() => { if (window.confirm(`Delete ${name}'s booking entirely? This removes their whole record, not just this projection. (To keep their history but stop counting them as recurring, use the "One-time service" toggle on their card instead.)`)) startTransition(() => deleteBooking(id)) }}
        disabled={pending}
        title="Delete this booking"
      >
        ×
      </button>
    </div>
  )
}
