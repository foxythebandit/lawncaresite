// Edit plan against the real migrations (PGlite): change how often, price, pause until a date,
// resume and end, for mowing and maintenance plans. Past and finished visits never change.
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
  const { rows: [row] } = await db.query('select * from bookings where id = $1', [bookingId])
  return { ...row, occurrence_on: iso(row.occurrence_on), confirmed_date: iso(row.confirmed_date), preferred_date: iso(row.preferred_date) }
}
async function plan(agreementId) {
  const { rows: [row] } = await db.query('select * from recurring_agreements where id = $1', [agreementId])
  return { ...row, anchor_on: iso(row.anchor_on), next_on: iso(row.next_on) }
}
async function planVisits(agreementId) {
  const { rows } = await db.query(`select id, status, occurrence_on, confirmed_date, frequency, job_total from bookings
    where agreement_id = $1 order by occurrence_on`, [agreementId])
  return rows.map(r => ({ ...r, occurrence_on: iso(r.occurrence_on), confirmed_date: iso(r.confirmed_date), job_total: Number(r.job_total) }))
}

/** Same calls as startCustomerPlan; `service` makes a mowing or maintenance plan. */
async function customerWithPlan(firstOn, { price = '85.00', service = 'Lawn care', customerId = null, propertyId = null } = {}) {
  if (!customerId) {
    const { rows: [customer] } = await db.query(`insert into customers(name, phone) values('Pat Test', '5125550111') returning id`)
    customerId = customer.id
    await db.query(`insert into bookings(name, phone, address, customer_id, status, one_time)
      values('Pat Test', '5125550111', '12 Oak St', $1, 'completed', true)`, [customerId])
  }
  const items = [{ kind: 'service', description: service, amount: price }]
  const created = await call('crm_create_customer_job', id(), customerId, propertyId, propertyId ? null : { address: '12 Oak St' },
    { preferred_date: firstOn, one_time: false, frequency: 'Bi-weekly' }, items)
  let first = await job(created.booking_id)
  await call('crm_job_command', first.id, first.updated_at, id(), 'confirm', { date: firstOn, time: null })
  first = await job(first.id)
  const started = await call('crm_start_agreement', first.id, first.updated_at, id(),
    { anchor_on: firstOn, next_on: day(14, firstOn), end_on: null, interval_unit: 'week', interval_count: 2, items_template: items })
  return { customerId, propertyId: created.property_id, agreementId: started.agreement_id, firstId: first.id }
}

test('changing how often keeps the next visit, re-spaces later open visits, and leaves done visits alone', async () => {
  const p = await customerWithPlan(day(-14))
  let first = await job(p.firstId)
  const done = await call('complete_job', first.id, first.updated_at, id(), day(-14))
  const next = done.next_booking_id
  assert.equal((await job(next)).occurrence_on, today)
  // A second open visit booked ahead (legacy data can have one).
  await db.query('select public.crm_generate_next_job($1, $2, $3)', [next, today, day(14)])
  const before = await plan(p.agreementId)

  const op = id()
  const changed = await call('crm_change_agreement_interval', p.agreementId, before.updated_at, op, 'week', 1, 'Weekly')
  assert.equal(changed.duplicate, false)
  assert.equal(changed.moved, 1)
  assert.equal((await call('crm_change_agreement_interval', p.agreementId, before.updated_at, op, 'week', 1, 'Weekly')).duplicate, true)

  const visits = await planVisits(p.agreementId)
  assert.deepEqual(visits.map(v => [v.status, v.occurrence_on]), [['completed', day(-14)], ['confirmed', today], ['confirmed', day(7)]])
  assert.equal(visits[2].confirmed_date, day(7))
  assert.equal(visits[0].frequency, 'Bi-weekly', 'the finished visit keeps its label')
  assert.deepEqual(visits.slice(1).map(v => v.frequency), ['Weekly', 'Weekly'])
  const after = await plan(p.agreementId)
  assert.equal(after.interval_count, 1)
  assert.equal(after.anchor_on, today)
  assert.equal(after.next_on, day(14))

  // Completing books the next on the new interval, without a second open visit.
  const nextJob = await job(next)
  const done2 = await call('complete_job', nextJob.id, nextJob.updated_at, id(), today)
  assert.equal((await job(done2.next_booking_id)).occurrence_on, day(7))
  const third = await job(done2.next_booking_id)
  const done3 = await call('complete_job', third.id, third.updated_at, id(), day(7))
  assert.equal((await job(done3.next_booking_id)).occurrence_on, day(14))

  await assert.rejects(call('crm_change_agreement_interval', p.agreementId, (await plan(p.agreementId)).updated_at, id(), 'week', 1, 'Weekly'), /already visits that often/)
})

test('monthly from the next visit; a stale screen is refused', async () => {
  const p = await customerWithPlan(day(3))
  const stale = (await plan(p.agreementId)).updated_at
  await call('crm_change_agreement_interval', p.agreementId, stale, id(), 'month', 1, 'Monthly')
  const after = await plan(p.agreementId)
  assert.equal(after.interval_unit, 'month')
  assert.equal(after.anchor_on, day(3))
  const d = new Date(`${day(3)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)
  if (d.getUTCDate() === new Date(`${day(3)}T12:00:00Z`).getUTCDate()) assert.equal(after.next_on, d.toISOString().slice(0, 10))
  await assert.rejects(call('crm_change_agreement_interval', p.agreementId, stale, id(), 'week', 3, 'Every 3 weeks'), /changed since/)
})

test('re-spacing refuses to land on a canceled visit of the plan', async () => {
  const p = await customerWithPlan(day(1))
  const first = await job(p.firstId)
  await db.query('select public.crm_generate_next_job($1, $2, $3)', [first.id, day(1), day(15)])
  // An individually canceled plan visit sits on day 8, where weekly would put the second visit.
  await db.query(`insert into bookings(name, phone, address, customer_id, property_id, agreement_id, occurrence_on, status)
    values('Pat Test', '1', '12 Oak St', $1, $2, $3, $4, 'canceled')`, [p.customerId, p.propertyId, p.agreementId, day(8)])
  const current = await plan(p.agreementId)
  await assert.rejects(call('crm_change_agreement_interval', p.agreementId, current.updated_at, id(), 'week', 1, 'Weekly'), /move or cancel it first/)
  assert.deepEqual((await planVisits(p.agreementId)).filter(v => v.status === 'confirmed').map(v => v.occurrence_on), [day(1), day(15)])
})

test('new price applies to later visits; the booked visit changes only when asked', async () => {
  const p = await customerWithPlan(today, { price: '65.00' })
  const agreement = await plan(p.agreementId)
  const items = [{ kind: 'service', description: 'Lawn care', amount: '72.00' }]
  await call('crm_agreement_command', p.agreementId, agreement.updated_at, id(), 'price_template', { items_template: items })
  assert.equal(Number((await plan(p.agreementId)).price_per_visit), 72)
  let visit = await job(p.firstId)
  assert.equal(Number(visit.job_total), 65, 'booked visit is unchanged')
  await call('crm_replace_job_items', visit.id, visit.updated_at, id(), items)
  visit = await job(p.firstId)
  assert.equal(Number(visit.job_total), 72)
  const done = await call('complete_job', visit.id, visit.updated_at, id(), today)
  assert.equal(Number((await job(done.next_booking_id)).job_total), 72)
  await assert.rejects(call('crm_replace_job_items', visit.id, (await job(visit.id)).updated_at, id(), items), /Finished job prices/)
})

test('pause until a date: upcoming visits cancel, next visit lands on the resume date, rhythm restarts there', async () => {
  const p = await customerWithPlan(day(2))
  let agreement = await plan(p.agreementId)
  await call('crm_agreement_command', p.agreementId, agreement.updated_at, id(), 'pause', { future_job_ids: [p.firstId] })
  assert.equal((await plan(p.agreementId)).status, 'paused')
  assert.equal((await job(p.firstId)).status, 'canceled')
  agreement = await plan(p.agreementId)
  const resumed = await call('crm_agreement_command', p.agreementId, agreement.updated_at, id(), 'resume', { next_on: day(23) })
  const next = await job(resumed.next_booking_id)
  assert.equal(next.occurrence_on, day(23))
  assert.equal(next.status, 'confirmed')
  const after = await plan(p.agreementId)
  assert.equal(after.status, 'active')
  assert.equal(after.anchor_on, day(23))
  assert.equal(after.next_on, day(37), 'a full interval after the resume date')
  const done = await call('complete_job', next.id, next.updated_at, id(), day(23))
  assert.equal((await job(done.next_booking_id)).occurrence_on, day(37))
})

test('end cancels upcoming visits only and the plan can no longer change', async () => {
  const p = await customerWithPlan(day(-14))
  const first = await job(p.firstId)
  const done = await call('complete_job', first.id, first.updated_at, id(), day(-14))
  const agreement = await plan(p.agreementId)
  await call('crm_agreement_command', p.agreementId, agreement.updated_at, id(), 'end', { future_job_ids: [done.next_booking_id] })
  const visits = await planVisits(p.agreementId)
  assert.deepEqual(visits.map(v => v.status), ['completed', 'canceled'])
  const ended = await plan(p.agreementId)
  await assert.rejects(call('crm_change_agreement_interval', p.agreementId, ended.updated_at, id(), 'week', 1, 'Weekly'), /Ended plans/)
})

test('a maintenance plan beside a mowing plan at the same property runs on its own', async () => {
  const mow = await customerWithPlan(day(1))
  const care = await customerWithPlan(day(1), { price: '300.00', service: 'Maintenance', customerId: mow.customerId, propertyId: mow.propertyId })
  assert.notEqual(mow.agreementId, care.agreementId)
  const careAgreement = await plan(care.agreementId)
  await call('crm_change_agreement_interval', care.agreementId, careAgreement.updated_at, id(), 'month', 1, 'Monthly')
  const careVisit = await job(care.firstId)
  const done = await call('complete_job', careVisit.id, careVisit.updated_at, id(), day(1))
  const nextCare = await job(done.next_booking_id)
  assert.equal(Number(nextCare.job_total), 300)
  assert.equal(nextCare.agreement_id, care.agreementId)
  const { rows: items } = await db.query('select description from job_items where booking_id = $1', [nextCare.id])
  assert.deepEqual(items.map(i => i.description), ['Maintenance'])
  // The mowing plan is untouched.
  const mowPlan = await plan(mow.agreementId)
  assert.equal(mowPlan.interval_unit, 'week')
  assert.deepEqual((await planVisits(mow.agreementId)).map(v => [v.status, v.occurrence_on]), [['confirmed', day(1)]])
})
