import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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

async function legacyFacts(db, ids) {
  const { rows } = await db.query(`select id,status,occurrence_on,confirmed_date,notes,completed_at,
    job_total,accepted_quote_snapshot,attribution,
    (select jsonb_agg(to_jsonb(i) order by i.id) from job_items i where i.booking_id = b.id) items,
    (select jsonb_agg(to_jsonb(p) order by p.id) from job_payments p where p.booking_id = b.id) payments
    from bookings b where id = any($1::uuid[]) order by id`, [ids])
  return rows
}

test('cutover retains existing obligations and money and catches up without calendar reads', async () => {
  const template = [{ kind: 'service', description: 'Lawn care', amount: '85.50' }]
  const legacy = []
  let before
  const upgrade = await freshDb({ beforeMigration: async (db, name) => {
    if (!name.endsWith('_crm_service_schedule_rules.sql')) return
    const { rows: [person] } = await db.query("insert into customers(name,phone) values('Legacy Test','5125550119') returning id")
    const { rows: [site] } = await db.query("insert into properties(customer_id,address) values($1,'1 Austin Lane') returning id", [person.id])
    for (const status of ['active', 'paused', 'ended']) {
      const { rows: [plan] } = await db.query(`insert into recurring_agreements(customer_id,property_id,status,
        anchor_on,next_on,interval_unit,interval_count,price_per_visit,items_template)
        values($1,$2,$3,'2020-01-31','2020-03-31','month',1,85.50,$4) returning id`,
        [person.id, site.id, status, JSON.stringify(template)])
      legacy.push({ planId: plan.id, ids: [] })
      for (const [visitStatus, slot, actual] of [
        ['completed', '2020-01-31', '2020-01-31'], ['confirmed', '2020-02-29', '2020-03-01'],
        ['skipped', '2020-03-31', '2020-03-31'], ['canceled', '2020-04-30', '2020-04-30'],
      ]) {
        const { rows: [visit] } = await db.query(`insert into bookings(name,phone,address,customer_id,property_id,
          agreement_id,occurrence_on,confirmed_date,status,notes,job_total,accepted_quote_snapshot,attribution,completed_at)
          values('Legacy Test','5125550119','1 Austin Lane',$1,$2,$3,$4,$5,$6,'Save this note',59.85,
            '{"total":59.85}', '{"first":{"source":"legacy"}}',
            case when $6 = 'completed' then '2020-01-31 12:00:00+00'::timestamptz end) returning id`,
          [person.id, site.id, plan.id, slot, actual, visitStatus])
        legacy.at(-1).ids.push(visit.id)
        if (visitStatus === 'completed') {
          await db.query("insert into job_items(booking_id,kind,description,amount) values($1,'service','Agreed price',59.85)", [visit.id])
          await db.query(`select public.record_job_payment($1,$2,59.85,'2020-01-31','Cash','manual')`,
            [visit.id, randomUUID()])
        }
      }
    }
    before = await legacyFacts(db, legacy.flatMap(plan => plan.ids))
  } })
  try {
    assert.deepEqual(await legacyFacts(upgrade, legacy.flatMap(plan => plan.ids)), before)
    const { rows: [counts] } = await upgrade.query(`select
      count(*) filter(where agreement_id = $1 and confirmed_date >= (now() at time zone 'America/Chicago')::date)::int active_future,
      count(*) filter(where agreement_id in ($2,$3) and confirmed_date >= (now() at time zone 'America/Chicago')::date)::int inactive_future,
      count(*) filter(where confirmed_date < (now() at time zone 'America/Chicago')::date)::int past
      from bookings`, legacy.map(plan => plan.planId))
    assert.ok(counts.active_future >= 2)
    assert.equal(counts.inactive_future, 0)
    assert.equal(counts.past, 12, 'cutover must not backfill hypothetical overdue work')

    const { rows: [boundary] } = await upgrade.query(`select
      generated_through::text as cursor, (generated_through + 90)::text as later
      from recurring_agreements where id = $1`, [legacy[0].planId])
    const { rows: [attention] } = await upgrade.query('select crm_calendar_attention($1) as counts', [boundary.later])
    assert.equal(attention.counts.catching_up, true)
    await upgrade.query('select crm_reconcile_schedules($1)', [boundary.later])
    const { rows: [caughtUp] } = await upgrade.query('select crm_calendar_attention($1) as counts', [boundary.later])
    assert.equal(caughtUp.counts.catching_up, false)
    assert.equal(caughtUp.counts.overdue, attention.counts.overdue)
    const { rows: [retry] } = await upgrade.query('select crm_reconcile_schedules($1) as changed', [boundary.later])
    assert.equal(retry.changed, 0)
    assert.deepEqual(await legacyFacts(upgrade, legacy.flatMap(plan => plan.ids)), before)
  } finally {
    await upgrade.close()
  }
})

test('cutover pauses generation when a saved moved visit occupies a regular date', async () => {
  let planId, savedId, before, dates
  const template = [{ kind: 'service', description: 'Lawn care', amount: '85.50' }]
  const upgrade = await freshDb({ beforeMigration: async (db, name) => {
    if (!name.endsWith('_crm_service_schedule_rules.sql')) return
    const { rows: [fixtureDates] } = await db.query(`select d::text as today, (d + 7)::text as old_slot,
      (d + 14)::text as moved_date, (d + 21)::text as restart
      from (select (now() at time zone 'America/Chicago')::date as d) clock`)
    dates = fixtureDates
    const { rows: [person] } = await db.query("insert into customers(name,phone) values('Legacy Test','5125550119') returning id")
    const { rows: [site] } = await db.query("insert into properties(customer_id,address) values($1,'1 Austin Lane') returning id", [person.id])
    const { rows: [plan] } = await db.query(`insert into recurring_agreements(customer_id,property_id,
      anchor_on,next_on,interval_unit,interval_count,price_per_visit,items_template)
      values($1,$2,$3,$4,'week',1,85.50,$5) returning id`,
    [person.id, site.id, dates.today, dates.moved_date, JSON.stringify(template)])
    planId = plan.id
    const { rows: [visit] } = await db.query(`insert into bookings(name,phone,address,customer_id,property_id,
      agreement_id,occurrence_on,confirmed_date,status,notes,job_total,accepted_quote_snapshot)
      values('Legacy Test','5125550119','1 Austin Lane',$1,$2,$3,$4,$5,'confirmed','Saved move',59.85,
        '{"total":59.85}') returning id`, [person.id, site.id, planId, dates.old_slot, dates.moved_date])
    savedId = visit.id
    before = await legacyFacts(db, [savedId])
  } })
  try {
    const { rows: [review] } = await upgrade.query(`select schedule_review_reason, generation_starts_on, updated_at
      from recurring_agreements where id = $1`, [planId])
    assert.match(review.schedule_review_reason, /saved visit moved onto a regular visit date/)
    assert.equal(review.generation_starts_on, null)
    const { rows: [attention] } = await upgrade.query('select crm_calendar_attention($1) as counts', [dates.today])
    assert.equal(attention.counts.schedule_review, 1)
    await upgrade.query('select crm_reconcile_schedules($1)', [dates.today])
    const { rows: entries } = await upgrade.query(`select booking_id,service_on::text from crm_calendar_entries($1,$2)
      where agreement_id = $3`, [dates.today, dates.restart, planId])
    assert.deepEqual(entries, [{ booking_id: savedId, service_on: dates.moved_date }])
    const restart = date => upgrade.query(
      "select crm_agreement_command($1,$2,$3,'resume',jsonb_build_object('next_on',$4::date))",
      [planId, review.updated_at, randomUUID(), date])
    await assert.rejects(restart(dates.moved_date), /after the saved visits/)
    await restart(dates.restart)
    const { rows: reopened } = await upgrade.query(`select service_on::text from crm_calendar_entries($1,$2)
      where agreement_id = $3 order by service_on`, [dates.today, dates.restart, planId])
    assert.deepEqual(reopened.map(row => row.service_on), [dates.moved_date, dates.restart])
    assert.deepEqual(await legacyFacts(upgrade, [savedId]), before)
  } finally {
    await upgrade.close()
  }
})
