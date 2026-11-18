import assert from 'node:assert/strict'
import { test } from 'node:test'
import { feedAuthorized } from '../lib/google-ads-feed'
import { conversionCsv, conversionRows, googleCustomers, ONE_TIME_CONVERSION, paidVisits, PLAN_CONVERSION, type RevenueJob } from '../lib/google-ads-revenue'

const job = (over: Partial<RevenueJob> & { id: string }): RevenueJob => ({
  name: 'Ana', phone: '(512) 555-0100', created_at: '2026-10-01T15:00:00Z', status: 'confirmed', ...over,
})

// Lead job from a Google click, then two plan visits that carry no gclid of their own.
const jobs: RevenueJob[] = [
  job({ id: '00aa0000-0000-0000-0000-000000000001', customer_id: 'cust-1', gclid: 'CLICK-1', one_time: false, frequency: 'biweekly',
    attribution: { first_touch: { captured_at: '2026-10-01T14:30:00Z' } }, status: 'completed', completed_at: '2026-10-03T20:00:00Z', amount_charged: 93 }),
  job({ id: '00bb0000-0000-0000-0000-000000000002', customer_id: 'cust-1', agreement_id: 'plan-1', created_at: '2026-10-05T15:00:00Z', status: 'completed' }),
  job({ id: '00cc0000-0000-0000-0000-000000000003', customer_id: 'cust-1', agreement_id: 'plan-1', created_at: '2026-10-19T15:00:00Z' }),
  // One-time job, no Google click: never credited.
  job({ id: '00dd0000-0000-0000-0000-000000000004', customer_id: 'cust-2', name: 'Bo', phone: '5125550199', one_time: true, status: 'completed',
    completed_at: '2026-10-10T20:00:00Z', amount_charged: 150 }),
  // One-time Google customer.
  job({ id: '00ee0000-0000-0000-0000-000000000005', customer_id: 'cust-3', name: 'Cy', phone: '5125550123', gclid: 'CLICK-3', one_time: true,
    frequency: 'One-time', created_at: '2026-10-20T16:00:00Z' }),
]
const payments = [
  { booking_id: '00bb0000-0000-0000-0000-000000000002', amount: '65.00', paid_on: '2026-10-17' },
  { booking_id: '00ee0000-0000-0000-0000-000000000005', amount: 120, paid_on: '2026-10-20' },
]

test('plan visits without their own gclid are credited to the customer’s first Google click', () => {
  const visits = paidVisits(jobs, payments)
  assert.equal(visits.length, 4)
  const planVisit = visits.find(v => v.jobId.startsWith('00bb'))!
  assert.equal(planVisit.click?.gclid, 'CLICK-1')
  assert.equal(planVisit.plan, true)
  assert.equal(visits.find(v => v.jobId.startsWith('00dd'))!.click, null)
})

test('upload rows: plan vs one-time names, real amounts, Central time, never before the click', () => {
  const rows = conversionRows(paidVisits(jobs, payments), new Date('2026-11-02T12:00:00Z'))
  assert.deepEqual(rows.map(r => [r.gclid, r.name, r.value]), [
    ['CLICK-1', PLAN_CONVERSION, '93.00'],
    ['CLICK-1', PLAN_CONVERSION, '65.00'],
    ['CLICK-3', ONE_TIME_CONVERSION, '120.00'],
  ])
  // Paid on Oct 3 → 18:mm Central that evening.
  assert.match(rows[0].time, /^2026-10-03 18:\d\d:00$/)
  // Cy paid the same day as her 11:00 Central click → the row stays after the click.
  assert.match(rows[2].time, /^2026-10-20 18:\d\d:00$/)
})

test('visits more than 90 days after the click, or not yet in the past, are left out', () => {
  const late = [{ booking_id: '00cc0000-0000-0000-0000-000000000003', amount: 65, paid_on: '2027-01-15' }]
  assert.equal(conversionRows(paidVisits(jobs, late), new Date('2027-02-01T00:00:00Z')).filter(r => r.value === '65.00').length, 0)
  const today = [{ booking_id: '00cc0000-0000-0000-0000-000000000003', amount: 65, paid_on: '2026-11-02' }]
  assert.equal(conversionRows(paidVisits(jobs, today), new Date('2026-11-02T15:00:00Z')).filter(r => r.value === '65.00').length, 0)
  const beforeClick = [{ booking_id: '00cc0000-0000-0000-0000-000000000003', amount: 65, paid_on: '2026-09-30' }]
  assert.equal(conversionRows(paidVisits(jobs, beforeClick), new Date('2026-11-02T15:00:00Z')).filter(r => r.value === '65.00').length, 0)
})

test('the upload file is Google’s click-conversion format with no personal details', () => {
  const csv = conversionCsv(conversionRows(paidVisits(jobs, payments), new Date('2026-11-02T12:00:00Z')))
  const lines = csv.trim().split('\n')
  assert.equal(lines[0], 'Parameters:TimeZone=America/Chicago')
  assert.equal(lines[1], 'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency')
  assert.equal(lines.length, 5)
  assert.ok(!/Ana|Cy|555/.test(csv))
})

test('report: Google customers with what they paid; unknown sources stay out', () => {
  const rows = googleCustomers(jobs, paidVisits(jobs, payments))
  assert.deepEqual(rows.map(r => [r.name, r.plan, r.paid, r.visits]), [['Cy', false, 120, 1], ['Ana', true, 158, 2]].sort((a, b) => Number(b[2]) - Number(a[2])))
})

test('feed requires the configured Basic credentials', () => {
  const password = 'a-long-feed-password'
  const good = `Basic ${Buffer.from(`google:${password}`).toString('base64')}`
  assert.equal(feedAuthorized(good, 'google', password), true)
  assert.equal(feedAuthorized(`Basic ${Buffer.from('google:wrong').toString('base64')}`, 'google', password), false)
  assert.equal(feedAuthorized(null, 'google', password), false)
  assert.equal(feedAuthorized(good, 'google', 'short'), false)
  assert.equal(feedAuthorized(good, undefined, undefined), false)
  // Dashboard-pasted values with stray whitespace still match.
  assert.equal(feedAuthorized(good, ' google\n', `${password}\n`), true)
})
