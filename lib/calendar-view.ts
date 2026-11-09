// lib-ok: Calendar dates, display labels, and safe return URLs are shared by the calendar and visit routes.
import { jobStatusLabel } from './crm-jobs'

export const CALENDAR_PATH = '/admin/jobs'
export const VIEWS = ['day', 'week', 'month'] as const
export type CalendarView = typeof VIEWS[number]
export const ATTENTION = {
  overdue: 'Overdue',
  needs_scheduling: 'Needs scheduling',
  schedule_review: 'Needs schedule review',
} as const
export type AttentionKind = keyof typeof ATTENTION

const iso = (date: Date) => date.toISOString().slice(0, 10)
const dateAtNoon = (day: string) => new Date(day + 'T12:00:00Z')

export function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false
  const date = dateAtNoon(value)
  return Number.isFinite(date.getTime()) && iso(date) === value
}

export function addDays(day: string, count: number) {
  const date = dateAtNoon(day)
  date.setUTCDate(date.getUTCDate() + count)
  return iso(date)
}

export function dateLabel(day: string, options: Intl.DateTimeFormatOptions) {
  return dateAtNoon(day).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

export function calendarRange(view: CalendarView, day: string) {
  const first = view === 'week' ? addDays(day, -((dateAtNoon(day).getUTCDay() + 6) % 7))
    : view === 'month' ? day.slice(0, 7) + '-01' : day
  const date = dateAtNoon(first)
  const last = view === 'week' ? addDays(first, 6)
    : view === 'month' ? iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))) : day
  return { first, last }
}

export function shiftCalendar(view: CalendarView, day: string, step: -1 | 1) {
  if (view !== 'month') return addDays(day, (view === 'week' ? 7 : 1) * step)
  const date = dateAtNoon(day)
  return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + step, 1)))
}

export function visitStatus(status: string, day: string | null, today: string) {
  if (status === 'pending') return ATTENTION.needs_scheduling
  if (status === 'confirmed' && day && day < today) return ATTENTION.overdue
  return jobStatusLabel(status)
}

export function visitTime(value: string | null | undefined) {
  if (!value?.trim()) return 'Any time'
  const time = value.trim()
  const exact = /^([01]?\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(time)
  if (!exact) return time
  const hour = Number(exact[1])
  return `${hour % 12 || 12}:${exact[2]} ${hour < 12 ? 'AM' : 'PM'}`
}

export function visitWindow(time: string | null): string {
  if (/^(?:[01]?\d|2[0-3]):[0-5]\d(?::00)?$/.test(time?.trim() ?? '')) return 'Timed'
  const value = time?.trim().toLowerCase()
  if (value === 'morning') return 'Morning'
  if (value === 'afternoon') return 'Afternoon'
  if (!value || value === 'any time') return 'Any time'
  return 'Other windows'
}

export type CalendarContext = {
  view: CalendarView
  date: string
  search: string
  attention?: AttentionKind
  filter?: 'confirmed' | 'week'
  page?: number
}

export function calendarContext(query: Record<string, unknown>, today: string): CalendarContext {
  const view = VIEWS.find(view => view === query.view) ?? 'week'
  const attention = Object.keys(ATTENTION).find(key => key === query.attention) as AttentionKind | undefined
  return {
    view, date: calendarDate(query.date) ? query.date : today,
    search: typeof query.search === 'string' ? query.search.trim().slice(0, 160) : '',
    attention: attention ?? (query.filter === 'pending' ? 'needs_scheduling' : undefined),
    filter: query.filter === 'confirmed' || query.filter === 'week' ? query.filter : undefined,
    page: typeof query.page === 'string' && /^[1-9]\d{0,3}$/.test(query.page) ? Number(query.page) : undefined,
  }
}

export function calendarHref(context: CalendarContext, focus?: string) {
  const params = new URLSearchParams({ view: context.view, date: context.date })
  if (context.search) params.set('search', context.search)
  if (context.attention) params.set('attention', context.attention)
  if (context.filter) params.set('filter', context.filter)
  if (context.page) params.set('page', String(context.page))
  if (focus && /^[a-zA-Z0-9_-]{1,90}$/.test(focus)) params.set('focus', focus)
  return `${CALENDAR_PATH}?${params}`
}

export function calendarReturnTo(value: unknown, today: string) {
  if (typeof value !== 'string' || !value.startsWith(CALENDAR_PATH + '?') || value.length > 1400) return calendarHref(calendarContext({}, today))
  const params = new URLSearchParams(value.slice(CALENDAR_PATH.length + 1))
  return calendarHref(calendarContext(Object.fromEntries(params), today), params.get('focus') ?? undefined)
}

export function visitHref(target: { booking_id: string | null; agreement_id: string | null; revision_id: string | null; cadence_on: string | null }, returnTo?: string) {
  const path = target.booking_id ? `${CALENDAR_PATH}/${target.booking_id}`
    : `${CALENDAR_PATH}/occurrence/${target.agreement_id}_${target.revision_id}_${target.cadence_on}`
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path
}
