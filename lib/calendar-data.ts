// lib-ok: Staff date-range reads are shared by Today, Week, and Calendar routes.
import 'server-only'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'

export type CalendarEntry = {
  booking_id: string | null
  agreement_id: string | null
  revision_id: string | null
  cadence_on: string | null
  service_on: string
  visit_time: string | null
  visit_status: 'confirmed' | 'completed'
  customer_id: string | null
  property_id: string | null
  name: string
  address: string
  job_total: number | null
}

export type CalendarAttention = {
  overdue: number
  needs_scheduling: number
  schedule_review: number
  catching_up: boolean
}

export function austinDay(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

export async function getCalendarEntries(from: string, through: string): Promise<CalendarEntry[]> {
  await requireStaff('/admin/jobs')
  const db = adminDb()
  const visits: CalendarEntry[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.rpc('crm_calendar_entries', { p_from: from, p_through: through })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error('Could not load the calendar range.')
    visits.push(...data)
    if (data.length < pageSize) return visits
  }
}

export async function getCalendarAttention(today = austinDay()): Promise<CalendarAttention> {
  await requireStaff('/admin/jobs')
  const { data, error } = await adminDb().rpc('crm_calendar_attention', { p_today: today })
  if (error || !data) throw new Error('Could not load visit attention counts.')
  return data
}

export async function getScheduledVisits(from: string, through: string) {
  await requireStaff('/admin/route')
  const { data, error } = await adminDb().from('bookings').select('*')
    .eq('status', 'confirmed').gte('confirmed_date', from).lte('confirmed_date', through)
    .order('confirmed_date').order('confirmed_time', { nullsFirst: false }).order('id')
  if (error) throw new Error('Could not load scheduled visits.')
  return data
}

export async function getNextScheduledVisit(today: string) {
  await requireStaff('/admin/route')
  const { data, error } = await adminDb().from('bookings').select('name,address,confirmed_date,confirmed_time')
    .eq('status', 'confirmed').gt('confirmed_date', today)
    .order('confirmed_date').order('confirmed_time', { nullsFirst: false }).order('id').limit(1).maybeSingle()
  if (error) throw new Error('Could not load the next visit.')
  return data
}
