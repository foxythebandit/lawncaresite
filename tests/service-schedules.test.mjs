import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { freshDb } from './pglite-db.mjs'

let db
before(async () => { db = await freshDb() })
after(async () => { await db?.close() })

const definition = (base, overrides = {}) => ({ version: 1, base, ...overrides })
const monthly = (anchor_on, pattern, fields = {}) => ({ frequency: 'monthly', anchor_on, pattern, ...fields })
const paused = { frequency: 'paused' }
const biweekly = anchor_on => ({ frequency: 'biweekly', anchor_on })

async function preview(rule, from, through) {
  const { rows } = await db.query(
    'select d::text from public.crm_schedule_dates($1,$2,$3) as d order by d',
    [rule, from, through],
  )
  return rows.map(row => row.d)
}

test('monthly previews distinguish the 31st, last day, and fifth weekday', async () => {
  assert.deepEqual(await preview(definition(monthly('2028-01-31', 'day', { day: 31 })), '2028-01-01', '2028-04-30'),
    ['2028-01-31', '2028-03-31'])
  assert.deepEqual(await preview(definition(monthly('2028-01-31', 'last_day')), '2028-01-01', '2028-04-30'),
    ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])
  assert.deepEqual(await preview(definition(monthly('2028-01-01', 'ordinal', { ordinal: 5, weekday: 1 })), '2028-01-01', '2028-04-30'),
    ['2028-01-31'])
  assert.deepEqual(await preview(definition({ frequency: 'legacy', unit: 'month', count: 1, anchor_on: '2028-01-31' }),
    '2028-01-01', '2028-04-30'), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])
})

test('annual work repeats and a cross-year season includes the first day of a month', async () => {
  const spring = definition(paused, { annual: [
    { start: '03-01', end: '06-01', rule: biweekly('2026-11-09') },
  ] })
  assert.deepEqual(await preview(spring, '2027-02-01', '2027-04-05'), ['2027-03-01', '2027-03-15', '2027-03-29'])
  assert.deepEqual(await preview(spring, '2028-02-01', '2028-04-05'), ['2028-03-06', '2028-03-20', '2028-04-03'])
  const leaves = definition(paused, { annual: [
    { start: '08-01', end: '02-01', rule: monthly('2026-08-01', 'day', { day: 1 }) },
  ] })
  assert.deepEqual(await preview(leaves, '2027-07-01', '2028-03-01'),
    ['2027-08-01', '2027-09-01', '2027-10-01', '2027-11-01', '2027-12-01', '2028-01-01'])
})

test('temporary pause outranks the annual phase and the base keeps its anchor', async () => {
  const schedule = definition(biweekly('2027-01-04'), {
    annual: [{ start: '02-01', end: '03-01', rule: { frequency: 'weekly', anchor_on: '2027-02-01' } }],
    temporary: [{ start: '2027-02-08', end: '2027-02-15', rule: paused }],
    excluded_on: ['2027-02-22'],
  })
  assert.deepEqual(await preview(schedule, '2027-01-20', '2027-03-15'),
    ['2027-02-01', '2027-02-15', '2027-03-01', '2027-03-15'])
})

test('invalid and overlapping periods cannot be previewed', async () => {
  await assert.rejects(preview(definition(paused, { annual: [
    { start: '08-01', end: '02-01', rule: paused },
    { start: '01-01', end: '03-01', rule: paused },
  ] }), '2027-01-01', '2027-01-31'), /overlap/)
  await assert.rejects(preview(definition(paused, { temporary: [
    { start: '2027-02-15', end: '2027-02-08', rule: paused },
  ] }), '2027-01-01', '2027-01-31'), /inverted/)
  await assert.rejects(preview(definition({ frequency: 'monthly', anchor_on: '2027-01-01', pattern: 'day', day: 32 }),
    '2027-01-01', '2027-01-31'), /cadence fields/)
  await assert.rejects(preview(definition(paused), '2027-01-01', '2028-12-31'), /at most 366 days/)
})
