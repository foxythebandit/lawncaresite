import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarContext, calendarHref, calendarRange, calendarReturnTo, shiftCalendar, visitStatus, visitTime } from '@/lib/calendar-view'
import { customerDisplayName } from '@/lib/lead-labels'

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

test('staff identity prefers a name, then an address with its unit, then an honest fallback', () => {
  const address = '71 Willowbank Walk, Apt 4, Austin, TX 78744'
  assert.equal(customerDisplayName({ name: '  Kelli Alvarez ', address }), 'Kelli Alvarez')
  assert.equal(customerDisplayName({ name: '(512) 555-0183', phone: '5125550183', address }), address)
  assert.equal(customerDisplayName({ name: '5125550183', address }), address)
  assert.equal(customerDisplayName({ name: '', address }), address)
  assert.equal(customerDisplayName({ phone: '5125550183' }), 'Unnamed customer')
})
