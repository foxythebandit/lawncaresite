'use client'

import { useTransition } from 'react'
import { deleteLead } from '../actions'

interface Lead {
  id: string
  phone: string
  address: string | null
  sq_ft: number | null
  map_screenshot_url: string | null
}

export default function LeadRow({
  lead, source, converted, timeAgo,
}: {
  lead: Lead
  source: string | null
  converted: boolean
  timeAgo: string
}) {
  const [pending, startTransition] = useTransition()

  return (
    <div className={`admin-card ${pending ? 'admin-card-loading' : ''}`}>
      <div className="admin-card-summary" style={{ cursor: 'default' }}>
        {lead.map_screenshot_url && (
          <a
            href={lead.map_screenshot_url}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-lead-thumb"
            title="Open traced lawn photo"
          >
            <img src={lead.map_screenshot_url} alt="Traced lawn" />
          </a>
        )}
        <span className={`admin-badge ${converted ? 'admin-badge-confirmed' : 'admin-badge-pending'}`}>
          {converted ? 'Booked' : 'Lead only'}
        </span>
        <a href={`tel:${lead.phone}`} className="admin-card-summary-name" style={{ color: 'inherit', textDecoration: 'none' }}>
          {lead.phone}
        </a>
        <span className="admin-card-summary-addr">
          {lead.address ?? '—'}{lead.sq_ft ? ` · ${lead.sq_ft.toLocaleString()} sq ft` : ''}
        </span>
        <span className="admin-card-summary-sub" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {source ?? 'Direct / unknown'} · {timeAgo}
        </span>
        <button
          onClick={() => { if (window.confirm('Delete this lead?')) startTransition(() => deleteLead(lead.id)) }}
          disabled={pending}
          style={{ background: 'none', border: 'none', color: 'var(--ink-faint, #999)', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
          aria-label="Delete lead"
        >
          ×
        </button>
      </div>
    </div>
  )
}
