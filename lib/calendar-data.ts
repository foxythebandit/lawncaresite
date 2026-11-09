// lib-ok: Staff date-range reads are shared by Today, Week, and Calendar routes.
import 'server-only'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { austinDay, CALENDAR_PATH } from './calendar-view'

export { austinDay } from './calendar-view'

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

export async function getCalendarEntries(from: string, through: string, returnTo = CALENDAR_PATH): Promise<CalendarEntry[]> {
  await requireStaff(returnTo)
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

export async function getCalendarAttention(today = austinDay(), returnTo = CALENDAR_PATH): Promise<CalendarAttention> {
  await requireStaff(returnTo)
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
  const { data, error } = await adminDb().from('bookings').select('id,name,address,phone,confirmed_date,confirmed_time')
    .eq('status', 'confirmed').gt('confirmed_date', today)
    .order('confirmed_date').order('confirmed_time', { nullsFirst: false }).order('id').limit(1).maybeSingle()
  if (error) throw new Error('Could not load the next visit.')
  return data
}

export const ATTENTION_PAGE_SIZE = 25

export type CalendarAttentionRow = {
  kind: import('./calendar-view').AttentionKind
  booking_id: string | null
  agreement_id: string | null
  revision_id: string | null
  cadence_on: string | null
  service_on: string | null
  visit_time: string | null
  visit_status: string | null
  customer_id: string | null
  name: string | null
  address: string | null
  phone: string | null
  job_total: number | null
  reason: string | null
  service?: string
}

export async function getCalendarAttentionPage(today: string, kind: CalendarAttentionRow['kind'], page: number, returnTo = CALENDAR_PATH) {
  await requireStaff(returnTo)
  const { data, error } = await adminDb().rpc('crm_calendar_attention_page', {
    p_today: today, p_kind: kind, p_limit: ATTENTION_PAGE_SIZE, p_offset: (page - 1) * ATTENTION_PAGE_SIZE,
  })
  if (error || !data) throw new Error('Could not load visits needing attention.')
  const result = data as unknown as { counts: CalendarAttention; rows: CalendarAttentionRow[] }
  if (kind !== 'needs_scheduling') return result
  const labels = await savedVisitServices(result.rows.flatMap(row => row.booking_id ? [row.booking_id] : []))
  return { ...result, rows: result.rows.map(row => ({ ...row, service: labels.get(row.booking_id ?? '') })) }
}

export async function getVisitSearch(search: string, page: number, filter?: 'confirmed' | 'week', bounds?: { first: string; last: string }, returnTo = CALENDAR_PATH) {
  await requireStaff(returnTo)
  // Quote the value for PostgREST's or() grammar and escape ILIKE wildcards.
  const pattern = search.replace(/[\\%_]/g, '\\$&').replace(/[\\"]/g, '\\$&')
  const clause = ['name', 'address', 'phone', 'email'].map(field => `${field}.ilike."%${pattern}%"`).join(',')
  let query = adminDb().from('bookings').select('id,name,address,phone,status,confirmed_date,confirmed_time,preferred_date,preferred_time,job_total')
    .or('schedule_state.is.null,schedule_state.neq.superseded').or(clause)
  if (filter === 'confirmed') query = query.eq('status', 'confirmed')
  if (filter === 'week' && bounds) query = query.gte('confirmed_date', bounds.first).lte('confirmed_date', bounds.last)
  const offset = (page - 1) * ATTENTION_PAGE_SIZE
  const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + ATTENTION_PAGE_SIZE)
  if (error) throw new Error('Could not search visits.')
  return { rows: data.slice(0, ATTENTION_PAGE_SIZE), more: data.length > ATTENTION_PAGE_SIZE }
}

export function visitService(items: { kind?: unknown; description?: unknown }[]) {
  const labels = [...new Set(items.flatMap(item =>
    item.kind === 'service' && typeof item.description === 'string' && item.description.trim() ? [item.description.trim()] : []))]
  if (!labels.length) return null
  return labels.length === 1 ? labels[0] : `${labels[0]} + ${labels.length - 1}`
}

async function savedVisitServices(saved: string[]) {
  const labels = new Map<string, string>()
  const db = adminDb()
  for (let i = 0; i < saved.length; i += 100) {
    const { data, error } = await db.from('bookings').select('id,job_items(kind,description)').in('id', saved.slice(i, i + 100))
    if (error) throw new Error('Could not load visit services.')
    for (const row of data) {
      const label = visitService(row.job_items)
      if (label) labels.set(row.id, label)
    }
  }
  return labels
}

export async function getCalendarVisits(from: string, through: string, returnTo = CALENDAR_PATH) {
  const visits = await getCalendarEntries(from, through, returnTo)
  const db = adminDb()
  const saved = [...new Set(visits.flatMap(row => row.booking_id ? [row.booking_id] : []))]
  const virtual = [...new Set(visits.flatMap(row => row.revision_id && !row.booking_id ? [row.revision_id] : []))]
  const labels = await savedVisitServices(saved)
  for (let i = 0; i < virtual.length; i += 100) {
    const { data, error } = await db.from('agreement_schedule_revisions').select('id,items_template').in('id', virtual.slice(i, i + 100))
    if (error) throw new Error('Could not load scheduled services.')
    for (const row of data) {
      const label = visitService(Array.isArray(row.items_template) ? row.items_template as { kind?: unknown; description?: unknown }[] : [])
      if (label) labels.set(row.id, label)
    }
  }
  return visits.map(visit => ({ ...visit, service: labels.get(visit.booking_id ?? visit.revision_id ?? '') ?? 'Service visit' }))
}
