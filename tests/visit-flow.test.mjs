// Plan visit flow against the real migrations (PGlite): complete → next visit, move one visit or
// the whole plan, and fold a lead's recurring visit into the customer's plan (owner report, 30 Oct).
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { before, test } from 'node:test'
import { freshDb } from './pglite-db.mjs'

let db
before(async () => { db = await freshDb() })

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const day = (offset, from = today) => {
  const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10)
}
const iso = value => value instanceof Date ? value.toISOString().slice(0, 10) : value

async function call(fn, ...args) {
  const params = args.map((_, i) => `$${i + 1}`).join(',')
  const { rows } = await db.query(`select public.${fn}(${params}) as r`, args)
  return rows[0].r
}
async function job(bookingId) {
  const { rows } = await db.query('select * from bookings where id = $1', [bookingId])
  const row = rows[0]
  return { ...row, occurrence_on: iso(row.occurrence_on), confirmed_date: iso(row.confirmed_date) }
}
async function plan(agreementId) {
  const { rows } = await db.query('select * from recurring_agreements where id = $1', [agreementId])
  return { ...rows[0], anchor_on: iso(rows[0].anchor_on), next_on: iso(rows[0].next_on) }
}
async function openPlanVisits(agreementId) {
  const { rows } = await db.query(`select id, occurrence_on from bookings where agreement_id = $1
    and status in ('pending','confirmed') order by occurrence_on`, [agreementId])
  return rows.map(r => iso(r.occurrence_on))
}

/** Same calls as startCustomerPlan on the customer page; first visit confirmed on its date. */
async function customerWithPlan(firstOn, price = '85.00', confirm = true) {
  const { rows: [customer] } = await db.query(`insert into customers(name, phone) values('Liz Test', '5125550100') returning id`)
  // Customers come from a linked lead job; later jobs copy its acquisition.
  await db.query(`insert into bookings(name, phone, address, customer_id, status, one_time)
    values('Liz Test', '5125550100', '4017 Avenue H', $1, 'completed', true)`, [customer.id])
  const items = [{ kind: 'service', description: 'Lawn care', amount: price }]
  const created = await call('crm_create_customer_job', id(), customer.id, null, { address: '4017 Avenue H' },
    { preferred_date: firstOn, one_time: false, frequency: 'Bi-weekly' }, items)
  let first = await job(created.booking_id)
  const started = await call('crm_start_agreement', first.id, first.updated_at, id(),
    { anchor_on: firstOn, next_on: day(14, firstOn), end_on: null, interval_unit: 'week', interval_count: 2, items_template: items })
  if (confirm) {
    first = await job(first.id)
    await call('crm_job_command', first.id, first.updated_at, id(), 'confirm', { date: firstOn, time: null })
  }
  return { customerId: customer.id, propertyId: created.property_id, agreementId: started.agreement_id, firstId: first.id }
}

test('completing a plan visit creates the next one on the cadence, and payment records', async () => {
  const p = await customerWithPlan(today)
  const first = await job(p.firstId)
  const done = await call('complete_job', first.id, first.updated_at, id(), today)
  const next = await job(done.next_booking_id)
  assert.equal(next.occurrence_on, day(14))
  assert.equal(next.status, 'confirmed')
  assert.equal(Number(next.job_total), 85)
  await call('record_job_payment', first.id, id(), '85.00', today, 'Cash', 'manual')
  const { rows } = await db.query('select sum(amount)::text as paid from job_payments where booking_id = $1', [first.id])
  assert.equal(rows[0].paid, '85.00')
})

test('finishing an old, never-scheduled plan visit books the next one on or after today', async () => {
  const start = day(-63) // like Liz: plan first visit two months ago, left "To schedule"
  const p = await customerWithPlan(start, '85.00', false)
  assert.equal((await plan(p.agreementId)).next_on, day(14, start))
  let first = await job(p.firstId)
  await call('crm_job_command', first.id, first.updated_at, id(), 'confirm', { date: start, time: null })
  first = await job(first.id)
  const done = await call('complete_job', first.id, first.updated_at, id(), start)
  const next = await job(done.next_booking_id)
  assert.ok(next.occurrence_on >= today, `next visit ${next.occurrence_on} is not in the past`)
  assert.ok(next.occurrence_on < day(14), 'it is the first cadence date from today')
  assert.equal((await plan(p.agreementId)).next_on, day(14, next.occurrence_on))
})

test("a lead's recurring visit joins the customer's plan; canceling the stale visit adds nothing", async () => {
  const stale = day(-63)
  const p = await customerWithPlan(stale, '85.00', false)
  // The phone/website booking: same customer and property, "biweekly", not in any plan.
  const { rows: [orphan] } = await db.query(`insert into bookings(name, phone, address, customer_id, property_id, status,
      confirmed_date, preferred_date, frequency, one_time, price_per_visit, job_total)
    values('Liz Test', '5125550100', '4017 Avenue H', $1, $2, 'confirmed', $3, $3, 'biweekly', false, 65, 65) returning id`,
    [p.customerId, p.propertyId, today])
  let visit = await job(orphan.id)
  await assert.rejects(call('complete_job', visit.id, visit.updated_at, id(), today), /start an agreement, or mark this visit one-time/)

  const op = id()
  const attached = await call('crm_attach_to_agreement', visit.id, visit.updated_at, op, p.agreementId)
  assert.equal(attached.duplicate, false)
  assert.equal((await call('crm_attach_to_agreement', visit.id, visit.updated_at, op, p.agreementId)).duplicate, true)
  visit = await job(visit.id)
  assert.equal(visit.agreement_id, p.agreementId)
  assert.equal(visit.occurrence_on, today)
  assert.equal(Number(visit.job_total), 65, 'the visit keeps its own price')
  const restarted = await plan(p.agreementId)
  assert.equal(restarted.anchor_on, today)
  assert.equal(restarted.next_on, day(14))

  const old = await job(p.firstId)
  const canceled = await call('crm_job_command', old.id, old.updated_at, id(), 'cancel', {})
  assert.equal(canceled.next_booking_id, visit.id, 'the booked later visit is the next one')
  assert.deepEqual(await openPlanVisits(p.agreementId), [today])

  const done = await call('complete_job', visit.id, visit.updated_at, id(), today)
  const next = await job(done.next_booking_id)
  assert.equal(next.occurrence_on, day(14))
  assert.equal(Number(next.job_total), 85, 'later visits charge the plan price')
})

test('attach refuses another customer\'s plan and a visit already in a plan', async () => {
  const a = await customerWithPlan(day(3))
  const b = await customerWithPlan(day(4))
  const visit = await job(b.firstId)
  await assert.rejects(call('crm_attach_to_agreement', visit.id, visit.updated_at, id(), a.agreementId), /already in a mowing plan/)
  const { rows: [other] } = await db.query(`insert into bookings(name, phone, address, customer_id, property_id, status, confirmed_date, frequency)
    values('X', '1', 'Y', $1, $2, 'confirmed', $3, 'weekly') returning id`, [b.customerId, b.propertyId, day(5)])
  const loose = await job(other.id)
  await assert.rejects(call('crm_attach_to_agreement', loose.id, loose.updated_at, id(), a.agreementId), /customer and property/)
})

test('moving one visit keeps the plan cadence; moving the plan shifts it', async () => {
  const on = day(7)
  const p = await customerWithPlan(on)
  // Only this visit, a week earlier: the next one still follows the original cadence.
  let visit = await job(p.firstId)
  await call('crm_job_command', visit.id, visit.updated_at, id(), 'reschedule', { date: today, time: 'Morning' })
  visit = await job(visit.id)
  assert.equal(visit.confirmed_date, today)
  assert.equal(visit.occurrence_on, on)
  let done = await call('complete_job', visit.id, visit.updated_at, id(), today)
  assert.equal((await job(done.next_booking_id)).occurrence_on, day(14, on))

  // Whole plan a week earlier (Dmitre): this visit and everything after it moves 7 days.
  const q = await customerWithPlan(on)
  visit = await job(q.firstId)
  const op = id()
  const shifted = await call('crm_shift_agreement', visit.id, visit.updated_at, op, today, 'Morning')
  assert.equal(shifted.shift_days, -7)
  assert.equal((await call('crm_shift_agreement', visit.id, visit.updated_at, op, today, 'Morning')).duplicate, true)
  visit = await job(visit.id)
  assert.equal(visit.occurrence_on, today)
  assert.equal(visit.confirmed_date, today)
  assert.equal(visit.confirmed_time, 'Morning')
  const moved = await plan(q.agreementId)
  assert.equal(moved.anchor_on, today)
  assert.equal(moved.next_on, day(14))
  done = await call('complete_job', visit.id, visit.updated_at, id(), today)
  assert.equal((await job(done.next_booking_id)).occurrence_on, day(14))
})

test('moving the plan later shifts every later open visit and refuses a taken date', async () => {
  const p = await customerWithPlan(day(2))
  const first = await job(p.firstId)
  // Two open visits: finish nothing, but book the next one explicitly through the generator.
  await db.query('select public.crm_generate_next_job($1, $2, $3)', [first.id, day(2), day(16)])
  assert.deepEqual(await openPlanVisits(p.agreementId), [day(2), day(16)])
  const fresh = await job(first.id)
  await call('crm_shift_agreement', fresh.id, fresh.updated_at, id(), day(5), null)
  assert.deepEqual(await openPlanVisits(p.agreementId), [day(5), day(19)])
  assert.equal((await plan(p.agreementId)).next_on, day(33))

  const again = await job(first.id)
  await call('crm_job_command', again.id, again.updated_at, id(), 'skip', {})
  const { rows: [second] } = await db.query(`select id from bookings where agreement_id = $1 and occurrence_on = $2`, [p.agreementId, day(19)])
  const secondJob = await job(second.id)
  await assert.rejects(call('crm_shift_agreement', secondJob.id, secondJob.updated_at, id(), day(5), null), /already has a visit on that date/)
})
