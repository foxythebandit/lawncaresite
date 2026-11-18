import { serviceEditorHref } from './service-schedules'
import { CALENDAR_PATH, calendarReturnTo, visitReturnHref } from './calendar-view'

const VISIT_ID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
const SERVICE_PATH = new RegExp(`^/admin/customers/(${VISIT_ID})/service$`, 'i')
const VISIT_PATH = new RegExp(`^${CALENDAR_PATH}/(?:${VISIT_ID}|occurrence/${VISIT_ID}_${VISIT_ID}_[0-9]{4}-[0-9]{2}-[0-9]{2})$`, 'i')

export function keepsStaffQuery(pathname: string) {
  return pathname === CALENDAR_PATH || pathname.startsWith(CALENDAR_PATH + '/') || SERVICE_PATH.test(pathname)
}

/** Only internal admin paths and short lead links may survive staff login. Calendar queries use their own allowlist. */
export function staffReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) return '/admin/leads'
  const queryStart = value.indexOf('?')
  if (queryStart >= 0) {
    const path = value.slice(0, queryStart)
    if (path === CALENDAR_PATH) return calendarReturnTo(value)
    if (VISIT_PATH.test(path)) {
      const back = new URLSearchParams(value.slice(queryStart + 1)).get('returnTo')
      return visitReturnHref(path, back?.startsWith(CALENDAR_PATH + '?') ? calendarReturnTo(back) : undefined)
    }
    const service = SERVICE_PATH.exec(path)
    if (service) {
      const params = new URLSearchParams(value.slice(queryStart + 1))
      return serviceEditorHref(service[1], { schedule: params.get('schedule') ?? undefined,
        visit: params.get('visit') ?? undefined, from: params.get('from') ?? undefined, extra: params.get('extra') === '1', origin: params.get('origin') ?? undefined })
    }
    return '/admin/leads'
  }
  return (/^\/admin(?:\/[a-zA-Z0-9_-]+)*$/.test(value) && !value.startsWith('/admin/login'))
    || /^\/l\/[23456789A-Z]{6}$/.test(value) ? value : '/admin/leads'
}

export function isStaff(user: { email?: string; email_confirmed_at?: string; app_metadata?: Record<string, unknown> } | null, allowlist = process.env.STAFF_EMAILS ?? ''): boolean {
  const emails = allowlist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return !!user?.email && !!user.email_confirmed_at && user.app_metadata?.role === 'staff' && emails.includes(user.email.toLowerCase())
}
