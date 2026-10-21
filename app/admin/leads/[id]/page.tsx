import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import MapQuoteBuilder from '@/components/MapQuoteBuilder'
import { processLeadAlert, requestLeadBooking, updateLeadContact } from '../quote-actions'

export const dynamic = 'force-dynamic'
export default async function LeadQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireStaff(`/admin/leads/${id}`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const db = adminDb()
  const { data: lead } = await db.from('leads').select('*').eq('id', id).single()
  if (!lead) notFound()
  const [{ data: events }, { data: bookings }] = await Promise.all([
    db.from('intake_events').select('*, staff_alerts(*)').eq('lead_id', id).order('created_at'),
    db.from('bookings').select('id, status, created_at, confirmed_at, completed_at, payment_recorded_at, amount_charged, payment_method').eq('lead_id', id).order('created_at'),
  ])
  return <>
    <div className="admin-card lead-workspace">
      <Link href="/admin/leads">← Leads</Link>
      <h1>{lead.name || 'Quote inquiry'}</h1>
      <p>{lead.address || 'Address not yet provided'}</p>
      <p><a href={`tel:${lead.phone}`}>Call {lead.phone}</a>{lead.email && <> · {lead.email}</>}</p>
      <p>{(lead.services ?? []).join(', ') || 'Services unknown'} · {lead.frequency || 'Frequency unknown'} · {lead.timing || 'Timing unknown'}</p>
      <p><strong>{lead.quote_confirmed_at ? 'Confirmed quote' : lead.quote_saved_at ? 'Draft estimate' : 'New inquiry'}</strong> · Received {new Date(lead.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</p>
      {lead.quote_saved_at && <p>Quote saved {lead.quote_saved_at}{lead.quote_confirmed_at && ` · Confirmed ${lead.quote_confirmed_at}`}</p>}
      {lead.quote_confirmed_at && lead.name && (lead.quote_draft?.address || lead.address) && !bookings?.length && <form action={requestLeadBooking.bind(null, id)}>
        <label>Requested visit date <input type="date" name="preferred_date" /></label>
        <button>Create booking request</button>
        <p>Confirm the booking separately from Bookings after agreeing with the customer.</p>
      </form>}
      <details><summary>Edit contact name and email</summary>
        <form action={updateLeadContact.bind(null, id)}>
          <label>Name <input name="name" defaultValue={lead.name ?? ''} required maxLength={150} /></label>
          <label>Email <input name="email" type="email" defaultValue={lead.email ?? ''} maxLength={254} /></label>
          <button>Save contact</button>
        </form>
      </details>
      <details><summary>Answers and acquisition details</summary>
        <pre>{JSON.stringify({ answers: lead.answers, attribution: lead.attribution, source: lead.source, form_version: lead.form_version,
          external_submission_id: lead.external_submission_id, consent: lead.consent, consent_text: lead.consent_text,
          consent_version: lead.consent_version, consented_at: lead.consented_at, score: lead.score, estimated_value: lead.estimated_value }, null, 2)}</pre>
        <p>External scores and estimated values are not revenue. Missing attribution is unknown.</p>
      </details>
      <details><summary>Booking stages ({bookings?.length ?? 0})</summary>
        {(bookings ?? []).map(b => <p key={b.id}>{b.status === 'pending' ? 'Booking request' : b.status === 'confirmed' ? 'Confirmed booking' : b.status === 'completed' ? 'Completed job' : b.status} · Requested {b.created_at}
          {b.confirmed_at && ` · Confirmed ${b.confirmed_at}`}
          {b.completed_at && ` · Completed ${b.completed_at}`}
          {b.payment_recorded_at && ` · Payment recorded ${b.payment_recorded_at}: $${b.amount_charged ?? 0} (${b.payment_method})`}</p>)}
      </details>
      <details><summary>Staff SMS status</summary>
        {(events ?? []).flatMap(e => (e.staff_alerts ?? []).map((a: { id: string; recipient: string; state: string; provider_status: string; error_code: string; attempts: number; provider_sid: string }) => <div key={a.id}>
          <p>{a.recipient || 'Recipient not configured'} · {a.state} {a.provider_status && `(${a.provider_status})`} · {a.attempts} attempts {a.error_code && `· ${a.error_code}`}</p>
          {a.provider_sid ? <form action={processLeadAlert.bind(null, id, a.id, e.id, 'refresh')}><button>Check delivery</button></form>
            : ['pending','disabled','failed'].includes(a.state) ? <form action={processLeadAlert.bind(null, id, a.id, e.id, 'retry')}><button>Retry staff alert</button></form>
            : <p>Check Twilio logs before resending; acceptance is uncertain.</p>}
        </div>))}
      </details>
    </div>
    <MapQuoteBuilder staffQuote={{ id, address: lead.address, sq_ft: lead.sq_ft, services: lead.services, frequency: lead.frequency, draft: lead.quote_draft }} />
  </>
}
