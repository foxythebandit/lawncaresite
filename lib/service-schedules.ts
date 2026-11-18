// lib-ok: Shared schedule types and descriptions for the customer, visit and editor.
import type { Json, Tables } from '@/supabase/database.types'
import { CALENDAR_PATH, calendarReturnTo, dateLabel, calendarDate, visitReturnHref } from './calendar-view'

export type Cadence =
  | { frequency: 'paused' }
  | { frequency: 'weekly' | 'biweekly'; anchor_on: string }
  | { frequency: 'monthly'; anchor_on: string; pattern: 'day'; day: number }
  | { frequency: 'monthly'; anchor_on: string; pattern: 'last_day' }
  | { frequency: 'monthly'; anchor_on: string; pattern: 'ordinal'; ordinal: number; weekday: number }
  | { frequency: 'legacy'; anchor_on: string; unit: 'week' | 'month'; count: number }

export type SchedulePeriod = { start: string; end: string; rule: Cadence }
export type ScheduleDefinition = {
  version: 1; base: Cadence; annual?: SchedulePeriod[]; temporary?: SchedulePeriod[]; excluded_on?: string[]
}

export type ServiceLabel = Pick<Tables<'service_labels'>, 'id' | 'name' | 'retired_at' | 'updated_at'>
export type ServiceEditorSource = { id: string; propertyId: string; labelId: string | null; date: string; version: string; price: number; regularPrice?: number; arrival: string | null; service: string }
export type IntroContinuation = { source_id: string; property_id: string; allocated_id: string; allocated_on: string | null; amount: number }
export type ServicePreview = {
  preview: string
  first_on?: string
  first_price?: number
  first_arrival?: string | null
  same_day_extra?: boolean
  intro_transfer?: { to_on?: string; standard_price?: number; intro_price?: number; needs_review?: boolean }
  intro_continuation?: { from_on: string | null; regular_price: number } | null
  dates: { on: string; price: number; arrival: string | null }[]
  changes: { booking_id: string | null; on: string; old_on?: string; action: 'keep' | 'cancel' | 'restore' | 'update' | 'extra' | 'conflict' | 'move' | 'tombstone'; price: number | null; old_price: number | null; arrival: string | null }[]
  conflicts: { booking_id?: string; on: string; action: 'conflict' | 'collision' }[]
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth']
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export const serviceDate = (on: string) => dateLabel(on, { month: 'short', day: 'numeric', year: 'numeric' })
export function definitionFrom(value: Json | undefined | null): ScheduleDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !value.base) return null
  // The database constraint validates the closed definition before a revision can be saved.
  return value as unknown as ScheduleDefinition
}

export function dayOfWeek(on: string) {
  const weekday = new Date(`${on}T12:00:00Z`).getUTCDay()
  return weekday || 7
}

export function cadenceLabel(rule: Cadence): string {
  if (rule.frequency === 'paused') return 'No visits'
  if (rule.frequency === 'legacy') return `Every ${rule.count === 1 ? '' : `${rule.count} `}${rule.unit}${rule.count === 1 ? '' : 's'}`
  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    return `${rule.frequency === 'weekly' ? 'Every week' : 'Every two weeks'} on ${WEEKDAYS[dayOfWeek(rule.anchor_on) - 1]}`
  }
  if (rule.frequency === 'monthly' && rule.pattern === 'last_day') return 'Monthly on the last day'
  if (rule.frequency === 'monthly' && rule.pattern === 'ordinal') return `Monthly on the ${rule.ordinal === -1 ? 'last' : ORDINALS[rule.ordinal - 1].toLowerCase()} ${WEEKDAYS[rule.weekday - 1]}`
  return rule.frequency === 'monthly' && rule.pattern === 'day' ? `Monthly on day ${rule.day}` : 'Monthly'
}

export function scheduleLabel(definition: ScheduleDefinition | null, plan: Pick<Tables<'recurring_agreements'>, 'interval_unit' | 'interval_count' | 'anchor_on'>) {
  if (!definition) return cadenceLabel({ frequency: 'legacy', anchor_on: plan.anchor_on, unit: plan.interval_unit === 'month' ? 'month' : 'week', count: plan.interval_count })
  const base = cadenceLabel(definition.base)
  const seasons = definition.annual?.length ?? 0
  return seasons ? `${definition.base.frequency === 'paused' ? 'Seasonal service' : base} · ${seasons} annual period${seasons === 1 ? '' : 's'}` : base
}

export function serviceEditorOrigin(value: unknown) {
  if (typeof value !== 'string' || value.length > 1800) return undefined
  const [path, query] = value.split('?')
  const parts = path.split('/')
  const isSaved = parts.length === 4 && parts.slice(0, 3).join('/') === CALENDAR_PATH && UUID.test(parts[3])
  const occurrence = parts.length === 5 && parts[3] === 'occurrence' && parts.slice(0, 3).join('/') === CALENDAR_PATH
    ? parts[4].split('_') : []
  if (!isSaved && !(occurrence.length === 3 && UUID.test(occurrence[0]) && UUID.test(occurrence[1]) && calendarDate(occurrence[2]))) return undefined
  const back = new URLSearchParams(query).get('returnTo')
  return visitReturnHref(path, back?.startsWith(CALENDAR_PATH + '?') ? calendarReturnTo(back) : undefined)
}

export function serviceEditorHref(customer: string, options: { schedule?: string; visit?: string; from?: string; extra?: boolean; origin?: string } = {}) {
  const query = new URLSearchParams()
  if (options.schedule && UUID.test(options.schedule)) query.set('schedule', options.schedule)
  if (options.visit && UUID.test(options.visit)) query.set('visit', options.visit)
  if (options.from && calendarDate(options.from)) query.set('from', options.from)
  if (options.extra) query.set('extra', '1')
  const origin = serviceEditorOrigin(options.origin)
  if (origin) query.set('origin', origin)
  return `/admin/customers/${customer}/service${query.size ? `?${query}` : ''}`
}
