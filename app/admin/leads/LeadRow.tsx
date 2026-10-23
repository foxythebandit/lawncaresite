'use client'

import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'
import Icon from '../icons'

interface Lead {
  id: string; name?: string | null; phone: string; address: string | null
  sq_ft: number | null; services?: string[] | null; stage?: string | null; follow_up_at?: string | null; quote_status?: string | null
}

export default function LeadRow({ lead, source, converted, timeAgo, needsAction, due }: {
  lead: Lead; source: string | null; converted: boolean; timeAgo: string; needsAction: boolean; due: boolean
}) {
  const stage = lead.stage || 'new'
  const [label, tone] = converted ? ['Booked', 'booked'] : lead.quote_status === 'canceled' && stage === 'lost' ? ['Canceled', 'lost'] : due ? ['Follow up due', 'due'] : [stage === 'new' ? 'New' : stage, stage]
  return <div className="admin-card crm-lead" data-needs-action={needsAction || undefined}>
    <Link className="crm-lead-main" href={`/admin/leads/${lead.id}`} aria-label={`Open quote for ${lead.name || formatPhone(lead.phone)}`}>
      <div className="crm-lead-top">
        <span className="crm-lead-name">{lead.name || formatPhone(lead.phone)}</span>
        <span className={`crm-chip crm-chip-${tone}`}>{label}</span>
      </div>
      <div className="crm-lead-address">{lead.address ?? 'Address not provided'}{lead.sq_ft ? ` · ${lead.sq_ft.toLocaleString()} sq ft` : ''}</div>
      <div className="crm-lead-meta">
        <span>{(lead.services ?? []).join(', ') || 'Service not specified'}</span>
        <span>{source ?? 'Direct / unknown'}</span>
      </div>
      <div className="crm-lead-time">{timeAgo}</div>
    </Link>
    <div className="crm-lead-actions"><a className="crm-icon-link" href={`tel:${lead.phone}`} aria-label={`Call ${formatPhone(lead.phone)}`}><Icon name="phone" size={17} /></a></div>
  </div>
}
