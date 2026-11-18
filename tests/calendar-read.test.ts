import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarContext, calendarHref, calendarRange, calendarReturnTo, compareVisitTimes, shiftCalendar, visitReturnHref, visitStatus, visitTime, visitWindow } from '@/lib/calendar-view'
import { customerDisplayName } from '@/lib/lead-labels'
import { keepsStaffQuery, staffReturnTo } from '@/lib/staff-policy'
import { serviceEditorHref } from '@/lib/service-schedules'

test('old calendar URLs stay useful and visit returns are confined to the calendar', () => {
  const today = '2026-11-09'
  const context = calendarContext({ view: 'list', date: '2026-02-29', filter: 'pending', search: '  Apt 4  ' }, today)
  assert.equal(context.view, 'week')
  assert.equal(context.date, today)
  assert.equal(context.attention, 'needs_scheduling')
  const back = calendarHref(context, 'visit-id')
  assert.equal(calendarReturnTo(back, today), back)
  assert.equal(calendarReturnTo('https://example.test/admin/jobs?date=2026-11-09', today), calendarHref(calendarContext({}, today)))
  assert.equal(calendarReturnTo('/admin/jobs/../../?view=month', today), calendarHref(calendarContext({}, today)))
})

test('staff login carries only valid Calendar query and visit return context', () => {
  const calendar = '/admin/jobs?view=month&date=2026-12-01&search=Park'
  const id = '12345678-abcd-1234-abcd-123456789012'
  const saved = `/admin/jobs/${id}`
  const occurrence = `/admin/jobs/occurrence/${id}_${id}_2026-12-01`
  const safeVisit = visitReturnHref(saved, calendar)
  assert.equal(staffReturnTo(calendar), calendar)
  assert.equal(staffReturnTo(safeVisit), safeVisit)
  assert.equal(staffReturnTo(visitReturnHref(occurrence, calendar)), visitReturnHref(occurrence, calendar))
  assert.equal(staffReturnTo(calendar + '&next=//elsewhere.test'), calendar)
  assert.equal(staffReturnTo(safeVisit + '&next=//elsewhere.test'), safeVisit)
  assert.equal(staffReturnTo(visitReturnHref(saved, '//elsewhere.test/admin/jobs?date=2026-12-01')), saved)
  assert.equal(staffReturnTo(visitReturnHref(saved, '/admin/jobs/../../?view=month')), saved)
  assert.equal(staffReturnTo('https://elsewhere.test' + calendar), '/admin/leads')
  assert.equal(staffReturnTo('/admin/jobs/%2e%2e?view=month'), '/admin/leads')
  assert.equal(staffReturnTo('/admin/revenue?next=//elsewhere.test'), '/admin/leads')
  assert.equal(staffReturnTo('/admin/login?next=' + encodeURIComponent(calendar)), '/admin/leads')
  assert.equal(staffReturnTo('/admin/revenue'), '/admin/revenue')
  assert.equal(staffReturnTo('/l/234ABC'), '/l/234ABC')
})

test('service editor sign-in preserves the source visit and its calendar while stripping other input', () => {
  const customer = '12345678-abcd-1234-abcd-123456789012'
  const visit = '12345678-abcd-1234-abcd-123456789013'
  const calendar = '/admin/jobs?view=day&date=2026-12-01&search=Kelli'
  const origin = visitReturnHref(`/admin/jobs/${visit}`, calendar)
  const editor = serviceEditorHref(customer, { visit, origin })
  assert.equal(keepsStaffQuery(editor.split('?')[0]), true)
  assert.equal(keepsStaffQuery('/admin/revenue'), false)
  assert.equal(staffReturnTo(editor + '&next=//elsewhere.test'), editor)
  const unsafe = new URLSearchParams({ visit: '../../', origin: '//elsewhere.test/admin/jobs/' + visit })
  assert.equal(staffReturnTo(`/admin/customers/${customer}/service?${unsafe}`), `/admin/customers/${customer}/service`)
})

test('calendar ranges use local dates across months and DST, and work status uses the actual date', () => {
  assert.deepEqual(calendarRange('week', '2026-11-01'), { first: '2026-10-26', last: '2026-11-01' })
  assert.deepEqual(calendarRange('month', '2028-02-29'), { first: '2028-02-01', last: '2028-02-29' })
  assert.equal(shiftCalendar('month', '2028-01-31', 1), '2028-02-01')
  assert.equal(shiftCalendar('week', '2026-10-29', 1), '2026-11-05')
  assert.equal(visitStatus('completed', '2026-12-01', '2026-11-09'), 'Done')
  assert.equal(visitStatus('confirmed', '2026-10-01', '2026-11-09'), 'Overdue')
  assert.equal(visitStatus('pending', '2026-10-01', '2026-11-09'), 'Needs scheduling')
  assert.equal(visitTime('13:15'), '1:15 PM')
  assert.equal(visitTime('After school pickup'), 'After school pickup')
})

test('exact arrival times sort by minutes while existing window groups stay intact', () => {
  const arrivals = ['14:00', '9:00', '09:00', 'Any time', 'Afternoon', 'Morning', 'After school pickup', '00:00']
  assert.deepEqual(arrivals.sort(compareVisitTimes), ['Morning', '00:00', '9:00', '09:00', '14:00',
    'Afternoon', 'Any time', 'After school pickup'])
  assert.equal(compareVisitTimes('9:00', '09:00'), 0)
  assert.equal(visitTime('9:00'), '9:00 AM')
  assert.equal(visitTime('09:00'), '9:00 AM')
  assert.equal(visitTime('14:00'), '2:00 PM')
  assert.equal(visitTime('00:00'), '12:00 AM')
  assert.equal(visitWindow('24:00'), 'Other windows')
})

test('staff identity prefers a name, then an address with its unit, then an honest fallback', () => {
  const address = '71 Willowbank Walk, Apt 4, Austin, TX 78744'
  assert.equal(customerDisplayName({ name: '  Kelli Alvarez ', address }), 'Kelli Alvarez')
  assert.equal(customerDisplayName({ name: '(512) 555-0183', phone: '5125550183', address }), address)
  assert.equal(customerDisplayName({ name: '5125550183', address }), address)
  assert.equal(customerDisplayName({ name: '', address }), address)
  assert.equal(customerDisplayName({ phone: '5125550183' }), 'Unnamed customer')
})
