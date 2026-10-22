'use client'

import { formatPhone } from '@/lib/format-phone'
import Link from 'next/link'

interface Lead {
  id: string; name?: string | null; phone: string; address: string | null
  sq_ft: number | null; services?: string[] | null; stage?: string | null; follow_up_at?: string | null
}

export default function LeadRow({ lead, source, converted, timeAgo, needsAction, due }: {
  lead: Lead; source: string | null; converted: boolean; timeAgo: string; needsAction: boolean; due: boolean
}) {
  return <div className="admin-card crm-lead">
    <Link className="crm-lead-main" href={`/admin/leads/${lead.id}`} aria-label={`Open quote for ${lead.name || formatPhone(lead.phone)}`}>
      <div className="crm-lead-top">
        <span className="crm-lead-name">{lead.name || formatPhone(lead.phone)}</span>
        <span className={`crm-chip ${needsAction ? 'crm-chip-due' : ''}`}>{converted ? 'Booked' : due ? 'Follow up due' : lead.stage === 'new' || !lead.stage ? 'New' : lead.stage}</span>
      </div>
      <div className="crm-lead-address">{lead.address ?? 'Address not provided'}{lead.sq_ft ? ` · ${lead.sq_ft.toLocaleString()} sq ft` : ''}</div>
      <div className="crm-lead-meta">{(lead.services ?? []).join(', ') || 'Service not specified'} · {source ?? 'Direct / unknown'} · {timeAgo}</div>
    </Link>
    <div className="crm-lead-actions"><a className="crm-icon-link" href={`tel:${lead.phone}`} aria-label={`Call ${formatPhone(lead.phone)}`}>Call</a></div>
  </div>
}
