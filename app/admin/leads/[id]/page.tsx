import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import LeadWorkspace from '../LeadWorkspace'

export const dynamic = 'force-dynamic'

export default async function LeadQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireStaff(`/admin/leads/${id}`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const db = adminDb()
  const { data: lead } = await db.from('leads').select('*').eq('id', id).single()
  if (!lead) notFound()
  const [{ data: activities }, { data: events }, { data: bookings }] = await Promise.all([
    db.from('lead_activities').select('id,kind,outcome,body,actor_email,occurred_at').eq('lead_id', id).order('occurred_at', { ascending: false }).limit(30),
    db.from('intake_events').select('id,staff_alerts(*)').eq('lead_id', id).order('created_at'),
    db.from('bookings').select('id,status,created_at,confirmed_at,completed_at,payment_recorded_at,amount_charged,payment_method').eq('lead_id', id).order('created_at'),
  ])
  return <LeadWorkspace lead={lead} activities={activities ?? []} events={events ?? []} bookings={bookings ?? []} />
}
