import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { after, before, test } from 'node:test'
import { freshDb } from './pglite-db.mjs'

let db
before(async () => { db = await freshDb() })
after(async () => { await db?.close() })
const actor = id()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const day = (offset, from = today) => {
  const date = new Date(`${from}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

async function call(name, ...args) {
  const parameters = args.map((_, i) => `$${i + 1}`).join(',')
  return (await db.query(`select public.${name}(${parameters}) as result`, args)).rows[0].result
}
const row = async (sql, ...args) => (await db.query(sql, args)).rows[0]
const plan = agreementId => row('select * from recurring_agreements where id=$1', agreementId)
const visit = bookingId => row('select to_jsonb(b) as visit from bookings b where id=$1', bookingId).then(r => r.visit)
const at = (agreementId, offset) => row('select id from bookings where agreement_id=$1 and occurrence_on=$2', agreementId, day(offset))
  .then(r => visit(r.id))
const label = name => row('select * from service_labels where name=$1 and retired_at is null', name)
const weekly = (anchor_on = today) => ({ frequency: 'weekly', anchor_on })
const definition = (base, extra = {}) => ({ version: 1, base, ...extra })
const items = (description, amount) => [{ kind: 'service', description, amount }]

async function customer() {
  const { id: customer_id } = await row("insert into customers(name,phone) values('Service Editor Test','5125550156') returning id")
  const { id: property_id } = await row("insert into properties(customer_id,address) values($1,'111 Editor Lane') returning id", customer_id)
  await db.query("insert into bookings(name,phone,address,customer_id,property_id,status,one_time) values('Service Editor Test','5125550156','111 Editor Lane',$1,$2,'completed',true)", [customer_id, property_id])
  return { customer_id, property_id }
}
async function create(c, request) {
  const preview = await call('crm_service_create', c.customer_id, request, actor)
  const op = id()
  const save = () => call('crm_service_create', c.customer_id, request, actor, op, preview.preview)
  const result = await save()
  assert.deepEqual(await save(), { ...result, duplicate: true })
  return { ...result, preview, op }
}
async function setup(overrides = {}) {
  const c = await customer()
  const mowing = await label('Lawn care')
  const request = { property_id: c.property_id, label_id: mowing.id, first_on: today, price: '85.50', arrival: 'Morning',
    definition: definition(weekly()), ...overrides }
  return { ...c, ...await create(c, request), request }
}
async function review(agreementId, request) {
  const version = (await plan(agreementId)).updated_at
  const preview = await call('crm_service_edit', agreementId, version, request, actor)
  const op = id()
  return { preview, op, save: () => call('crm_service_edit', agreementId, version, request, actor, op, preview.preview) }
}

test('labels carry no price, two services at one property stay independent, and labels preserve past work', async () => {
  const c = await customer()
  const mow = await label('Lawn care')
  const custom = await call('crm_save_service_label', null, null, 'Acorn cleanup', false, id(), actor)
  assert.equal('price' in custom, false)
  const request = { property_id: c.property_id, first_on: today, arrival: 'Morning', definition: definition(weekly()) }
  const a = await create(c, { ...request, label_id: mow.id, price: '85.50' })
  const b = await create(c, { ...request, label_id: custom.id, price: '250.00', definition: null })
  const cleanup = await visit(b.booking_id)
  assert.equal(cleanup.job_total, 250)
  assert.equal(cleanup.agreement_id, null)
  await call('complete_job', cleanup.id, cleanup.updated_at, id(), today)
  await call('record_job_payment', cleanup.id, id(), '250.00', today, 'Cash', 'manual')
  assert.equal((await visit(a.booking_id)).status, 'confirmed')
  assert.equal((await at(a.agreement_id, 7)).job_total, 85.5)
  assert.equal((await row('select count(*)::int as count from job_payments where booking_id=$1', a.booking_id)).count, 0)

  const renamed = await call('crm_save_service_label', custom.id, custom.updated_at, 'Leaf and acorn cleanup', false, id(), actor)
  const finished = await visit(cleanup.id)
  const started = await create(c, { ...request, label_id: custom.id, price: '250.00', source_id: finished.id,
    source_version: finished.updated_at })
  const retired = await call('crm_save_service_label', custom.id, renamed.updated_at, renamed.name, true, id(), actor)
  assert.ok(retired.retired_at)
  assert.equal(started.booking_id, cleanup.id)
  assert.deepEqual((await visit(cleanup.id)).accepted_quote_snapshot, cleanup.accepted_quote_snapshot)
  assert.equal((await row('select description from job_items where booking_id=$1', cleanup.id)).description, 'Acorn cleanup')
  assert.equal((await row('select description from job_items where booking_id=$1', (await at(started.agreement_id, 7)).id)).description,
    'Leaf and acorn cleanup')
  await assert.rejects(call('crm_service_create', c.customer_id, { ...request, label_id: custom.id, price: '30' }, actor), /active service label/)

  const extra = await create(c, { ...request, label_id: mow.id, related_agreement_id: a.agreement_id,
    definition: null, first_on: day(3), price: '41.27' })
  assert.equal((await visit(extra.booking_id)).agreement_id, null)
  assert.equal((await visit(extra.booking_id)).job_total, 41.27)
  assert.equal((await at(a.agreement_id, 7)).job_total, 85.5)
  const revision = await row('select * from agreement_schedule_revisions where agreement_id=$1', a.agreement_id)
  assert.equal(revision.staff_user_id, actor)
  assert.equal(revision.operation_id, a.op)
})

test('a one-off with a retired label can start a schedule under a new active label', async () => {
  const c = await customer()
  const custom = await call('crm_save_service_label', null, null, 'Seasonal yard cleanup', false, id(), actor)
  const existing = await create(c, { property_id: c.property_id, label_id: custom.id, first_on: today, price: '250' })
  const first = await visit(existing.booking_id)
  await call('crm_save_service_label', custom.id, custom.updated_at, custom.name, true, id(), actor)
  const active = await label('Leaf cleanup')
  const result = await create(c, { property_id: c.property_id, label_id: active.id, first_on: today, price: '225',
    definition: definition(weekly()), source_id: first.id, source_version: first.updated_at })
  assert.equal(result.booking_id, first.id)
  assert.equal((await visit(first.id)).service_label_id, custom.id)
  assert.equal((await visit(first.id)).job_total, 250)
  const future = await at(result.agreement_id, 7)
  assert.equal(future.service_label_id, active.id)
  assert.equal(future.job_total, 225)
})

test('annual spring mowing, monthly February override, and cross-year cleanup use the reviewed dates', async () => {
  const nextYear = Number(today.slice(0, 4)) + 1
  const c = await customer()
  const mowing = await label('Lawn care')
  const cleanup = await label('Leaf cleanup')
  const spring = definition({ frequency: 'paused' }, { annual: [
    { start: '03-01', end: '06-01', rule: { frequency: 'biweekly', anchor_on: '2027-03-01' } },
  ] })
  const first = `${nextYear}-03-01`
  const a = await create(c, { property_id: c.property_id, label_id: mowing.id, first_on: first,
    price: '83.25', arrival: 'Afternoon', definition: spring })
  const projected = (await db.query('select service_on::text,job_total::text from crm_calendar_entries($1,$2) where agreement_id=$3 order by service_on',
    [day(1, first), day(365, first), a.agreement_id])).rows
  assert.deepEqual(projected, a.preview.dates.map(v => ({ service_on: v.on, job_total: v.price.toFixed(2) })))
  assert.ok(a.preview.dates.every(v => ['03','04','05'].includes(v.on.slice(5, 7))))
  const base = { frequency: 'monthly', pattern: 'day', day: 15, anchor_on: `${nextYear}-01-15` }
  const monthly = await create(c, { property_id: c.property_id, label_id: mowing.id, first_on: `${nextYear}-01-15`,
    price: '92', arrival: 'Morning', definition: definition(base, { annual: [
      { start: '02-01', end: '03-01', rule: weekly(`${nextYear}-02-01`) },
    ] }) })
  assert.ok(monthly.preview.dates.filter(v => v.on.startsWith(`${nextYear}-02`)).length >= 4)
  assert.ok(monthly.preview.dates.some(v => v.on === `${nextYear}-03-15`))
  const season = await create(c, { property_id: c.property_id, label_id: cleanup.id, first_on: `${nextYear}-08-01`,
    price: '250', arrival: 'Any time', definition: definition({ frequency: 'paused' }, { annual: [
      { start: '08-01', end: '02-01', rule: { frequency: 'monthly', pattern: 'last_day', anchor_on: `${nextYear}-08-01` } },
    ] }) })
  assert.ok(season.preview.dates.some(v => v.on === `${nextYear + 1}-01-31`))
  assert.ok(!season.preview.dates.some(v => v.on === `${nextYear + 1}-02-29` || v.on.startsWith(`${nextYear + 1}-02`)))
})

test('temporary cadence edits and a skip period retain original rhythm, IDs, and reviewed price', async () => {
  const a = await setup({ definition: definition({ frequency: 'biweekly', anchor_on: today }) })
  const untouched = await at(a.agreement_id, 42)
  const range = await review(a.agreement_id, { mode: 'range', from: day(7), through: day(35), rule: weekly(day(7)) })
  assert.deepEqual(range.preview.dates.map(x => x.on), [7,14,21,28,35].map(x => day(x)))
  const result = await range.save()
  assert.deepEqual(await range.save(), { ...result, duplicate: true })
  assert.equal((await at(a.agreement_id, 42)).id, untouched.id)
  const { rows } = await db.query("select confirmed_date::text as on,job_total::text as price from bookings where agreement_id=$1 and status='confirmed' order by confirmed_date", [a.agreement_id])
  assert.deepEqual(rows.map(x => x.on), [0,7,14,21,28,35,42,56,70,84].map(x => day(x)))
  assert.ok(rows.every(v => v.price === '85.50'))
  const note = await at(a.agreement_id, 21)
  await call('crm_calendar_save_note', note.id, note.updated_at, id(), 'Gate code 1234')
  const skip = await review(a.agreement_id, { mode: 'range', from: day(14), through: day(35), rule: { frequency: 'paused' } })
  assert.equal(skip.preview.changes.find(x => x.booking_id === note.id).action, 'cancel')
  assert.equal(skip.preview.dates.length, 0)
  await skip.save()
  assert.equal((await visit(note.id)).notes, 'Gate code 1234')
  assert.equal((await visit(note.id)).status, 'canceled')
  assert.equal((await at(a.agreement_id, 42)).status, 'confirmed')
})

test('a note travels with a whole-schedule shift and repricing while independent overrides survive', async () => {
  const a = await setup()
  const p = await plan(a.agreement_id)
  const from = day(1)
  const legacy = definition({ frequency: 'legacy', unit: 'week', count: 1, anchor_on: today })
  await (await review(p.id, { mode: 'future', from, definition: legacy })).save()
  const [first, noted, price, moved, arrival] = await Promise.all([7,14,21,28,35].map(n => at(p.id, n)))
  await call('crm_calendar_save_note', noted.id, noted.updated_at, id(), 'Gate code 1234')
  await db.query("update bookings set phone='5125550188' where id=$1", [noted.id])
  await call('crm_replace_job_items', price.id, price.updated_at, id(), items('Custom same total', '85.50'))
  await call('crm_job_command', moved.id, moved.updated_at, id(), 'reschedule', { date: day(32), time: 'Morning' })
  await call('crm_job_command', arrival.id, arrival.updated_at, id(), 'reschedule', { date: day(35), time: '09:30' })
  await call('crm_shift_agreement', first.id, first.updated_at, id(), day(9), 'Morning')
  assert.equal((await visit(noted.id)).confirmed_date, day(16))
  assert.equal((await visit(noted.id)).phone, '5125550188')
  assert.equal((await visit(price.id)).confirmed_date, day(23))
  assert.equal((await visit(moved.id)).confirmed_date, day(32))
  const revised = await plan(p.id)
  await call('crm_agreement_command', p.id, revised.updated_at, id(), 'price_template', { items_template: items('Lawn care', '92.25') })
  assert.equal((await visit(noted.id)).job_total, 92.25)
  assert.equal((await visit(noted.id)).notes, 'Gate code 1234')
  assert.equal((await visit(price.id)).job_total, 85.5)
  assert.equal((await visit(moved.id)).job_total, 92.25)
  assert.equal((await visit(arrival.id)).confirmed_time, '09:30')
  assert.equal((await visit(arrival.id)).job_total, 92.25)
})

test('removing an annotated cadence slot requires review and an explicit decision to retain it', async () => {
  const a = await setup()
  const note = await at(a.agreement_id, 14)
  const req = { mode: 'future', from: day(1), definition: definition(weekly(day(2))) }
  const before = await review(a.agreement_id, req)
  await call('crm_calendar_save_note', note.id, note.updated_at, id(), 'Call at the side gate')
  await assert.rejects(before.save(), /preview changed/)
  const blocked = await review(a.agreement_id, req)
  assert.ok(blocked.preview.conflicts.some(c => c.booking_id === note.id))
  await assert.rejects(blocked.save(), /resolve the visits/i)
  const keep = await review(a.agreement_id, { ...req, keep_unmatched: true })
  assert.equal(keep.preview.changes.find(c => c.booking_id === note.id).action, 'extra')
  await keep.save()
  assert.equal((await visit(note.id)).confirmed_date, day(14))
  assert.equal((await visit(note.id)).notes, 'Call at the side gate')
  const reintroduce = await review(a.agreement_id, { mode: 'future', from: day(1), definition: definition(weekly()),
    keep_unmatched: true })
  await reintroduce.save()
  assert.equal((await at(a.agreement_id, 14)).id, note.id)
  assert.equal((await visit(note.id)).notes, 'Call at the side gate')
})

test('resume restores pause-canceled visits with their own facts and keeps individual cancellations', async () => {
  const a = await setup()
  const note = await at(a.agreement_id, 7)
  const cancel = await at(a.agreement_id, 14)
  await call('crm_calendar_save_note', note.id, note.updated_at, id(), 'Side gate')
  let current = await visit(note.id)
  await call('crm_job_command', note.id, current.updated_at, id(), 'reschedule', { date: day(9), time: '09:30' })
  current = await visit(note.id)
  await call('crm_replace_job_items', note.id, current.updated_at, id(), items('Hand priced', '70.12'))
  await call('crm_job_command', cancel.id, cancel.updated_at, id(), 'cancel', {})
  const paused = await review(a.agreement_id, { mode: 'pause', from: today })
  await paused.save()
  assert.equal((await visit(note.id)).schedule_cancellation, 'pause')
  assert.equal((await visit(cancel.id)).schedule_cancellation, null)
  const resumed = await review(a.agreement_id, { mode: 'resume', from: day(7) })
  assert.equal(resumed.preview.changes.find(c => c.booking_id === note.id).action, 'restore')
  await resumed.save()
  current = await visit(note.id)
  assert.equal(current.status, 'confirmed')
  assert.equal(current.notes, 'Side gate')
  assert.equal(current.job_total, 70.12)
  assert.equal(current.confirmed_date, day(9))
  assert.equal(current.confirmed_time, '09:30')
  assert.equal((await visit(cancel.id)).status, 'canceled')
})

test('the editor rejects a nonexistent Austin clock time during preview', async () => {
  const c = await customer()
  const year = Number(today.slice(0, 4)) + 1
  const start = `${year}-03-08`
  const sunday = day((7 - new Date(`${start}T12:00:00Z`).getUTCDay()) % 7, start)
  await assert.rejects(call('crm_service_create', c.customer_id, { property_id: c.property_id,
    label_id: (await label('Lawn care')).id, first_on: sunday, price: '85', arrival: '02:30' }, actor),
  /does not exist in Austin/)
})

test('reviewed series move maps the displayed dates and stores the staff operation', async () => {
  const { agreement_id: agreementId, booking_id: first } = await setup()
  const future = await at(agreementId, 7)
  await call('crm_calendar_save_note', future.id, future.updated_at, id(), 'Use the east gate')
  const request = { booking_id: first, version: (await visit(first)).updated_at, date: day(2), time: 'Afternoon' }
  const preview = await call('crm_review_schedule_shift', agreementId, request, actor)
  assert.deepEqual(preview.conflicts, [])
  const proposed = preview.changes.find(change => change.booking_id === future.id)
  assert.deepEqual([proposed.old_on, proposed.on, proposed.price], [day(7), day(9), 85.5])
  assert.equal((await visit(future.id)).confirmed_date, day(7))
  const op = id()
  const apply = () => call('crm_review_schedule_shift', agreementId, request, actor, op, preview.preview)
  const result = await apply()
  assert.equal(result.booking_id, first)
  assert.deepEqual(await apply(), { ...result, duplicate: true })
  const moved = await visit(future.id)
  assert.equal(moved.confirmed_date, day(9))
  assert.equal(moved.notes, 'Use the east gate')
  assert.equal(moved.date_override, false)
  assert.deepEqual(await row('select staff_user_id,operation_id from agreement_schedule_revisions where id=$1', moved.schedule_revision_id),
    { staff_user_id: actor, operation_id: op })
})

test('complex schedule cannot be flattened through a legacy date-shift command', async () => {
  const annual = [{ start: '02-01', end: '03-01', rule: { frequency: 'biweekly', anchor_on: '2027-02-01' } }]
  const { agreement_id: agreementId, booking_id: first } = await setup({ definition: definition(weekly(), { annual }) })
  const before = await row('select to_jsonb(r) as revision from agreement_schedule_revisions r where agreement_id=$1', agreementId)
  const request = { booking_id: first, version: (await visit(first)).updated_at, date: day(1), time: 'Morning' }
  await assert.rejects(call('crm_shift_agreement', first, request.version, id(), request.date, request.time), /Use Edit schedule/)
  await assert.rejects(call('crm_review_schedule_shift', agreementId, request, actor), /Use Edit schedule/)
  assert.deepEqual(await row('select to_jsonb(r) as revision from agreement_schedule_revisions r where agreement_id=$1', agreementId), before)
  await call('crm_job_command', first, request.version, id(), 'reschedule', request)
  assert.equal((await visit(first)).confirmed_date, day(1))
})

test('reviewed move previews a retained collision beyond the generated window', async () => {
  const { agreement_id: agreementId, booking_id: first } = await setup({
    definition: definition({ frequency: 'biweekly', anchor_on: today }),
  })
  const future = await at(agreementId, 14)
  await call('crm_job_command', future.id, future.updated_at, id(), 'reschedule', { date: day(120) })
  const request = { booking_id: first, version: (await visit(first)).updated_at, date: day(8), time: 'Morning' }
  const preview = await call('crm_review_schedule_shift', agreementId, request, actor)
  assert.deepEqual(preview.conflicts, [{ booking_id: future.id, on: day(120), action: 'collision' }])
  await assert.rejects(call('crm_review_schedule_shift', agreementId, request, actor, id(), preview.preview), /Resolve the visits/)
  assert.equal((await visit(future.id)).confirmed_date, day(120))
  assert.equal((await visit(first)).confirmed_date, today)
})

test('projected time-only review does not materialize or move a date before save', async () => {
  const { agreement_id: agreementId } = await setup()
  const on = day(98)
  const projected = await row('select revision_id from crm_calendar_entries($1,$1) where agreement_id=$2', on, agreementId)
  const request = { revision_id: projected.revision_id, on, date: on, time: '14:15' }
  const preview = await call('crm_review_schedule_shift', agreementId, request, actor)
  assert.deepEqual([preview.first_on, preview.first_arrival, preview.first_price], [on, '14:15', 85.5])
  assert.ok(preview.dates.some(date => date.on === day(105) && date.arrival === '14:15'))
  assert.equal(await row('select id from bookings where agreement_id=$1 and occurrence_on=$2', agreementId, on), undefined)
  const op = id()
  const saved = await call('crm_review_schedule_shift', agreementId, request, actor, op, preview.preview)
  const actual = await visit(saved.booking_id)
  assert.deepEqual([actual.confirmed_date, actual.confirmed_time, actual.time_override], [on, '14:15', false])
  assert.deepEqual(await row('select staff_user_id,operation_id from agreement_schedule_revisions where id=$1', actual.schedule_revision_id),
    { staff_user_id: actor, operation_id: op })
})

test('itemized future price changes preserve individual and completed prices', async () => {
  const { agreement_id: agreementId, request } = await setup()
  const individual = await at(agreementId, 7)
  await call('crm_replace_job_items', individual.id, individual.updated_at, id(), items('Custom price', '85.50'))
  const future = await review(agreementId, { mode: 'future', from: day(7), definition: request.definition,
    items_template: [...items('Leaf and acorn cleanup', '260.25'), { kind: 'discount', description: 'Agreed discount', amount: '-10.25' }] })
  assert.ok(future.preview.dates.some(date => date.on === day(7) && date.price === 85.5))
  assert.ok(future.preview.dates.some(date => date.on === day(14) && date.price === 250))
  await future.save()
  assert.equal((await visit(individual.id)).job_total, 85.5)
  const regular = await at(agreementId, 14)
  assert.equal(regular.job_total, 250)
  assert.deepEqual((await db.query('select kind,description,amount::text from job_items where booking_id=$1 order by kind desc', [regular.id])).rows, [
    { kind: 'service', description: 'Leaf and acorn cleanup', amount: '260.25' },
    { kind: 'discount', description: 'Agreed discount', amount: '-10.25' },
  ])
})

test('migration conservatively protects an older ambiguous schedule exception', async () => {
  let target
  const upgraded = await freshDb({ beforeMigration: async (database, name) => {
    if (!name.endsWith('_crm_service_intent.sql')) return
    const customer = id(), property = id(), first = id()
    await database.query("insert into customers(id,name,phone) values($1,'Legacy Notes','5125550156')", [customer])
    await database.query("insert into properties(id,customer_id,address) values($1,$2,'Old Schedule Lane')", [property, customer])
    const { rows: [booking] } = await database.query(`insert into bookings(id,name,phone,address,customer_id,property_id,status,confirmed_date)
      values($1,'Legacy Notes','5125550156','Old Schedule Lane',$2,$3,'confirmed',$4) returning updated_at`, [first, customer, property, today])
    const { rows: [started] } = await database.query('select crm_start_agreement($1,$2,$3,$4) as result',
      [first, booking.updated_at, id(), { anchor_on: today, next_on: day(7), interval_unit: 'week', interval_count: 1, items_template: items('Lawn care', '85.50') }])
    const { rows: [legacy] } = await database.query("update bookings set notes='Old gate code' where agreement_id=$1 and occurrence_on=$2 returning id,schedule_state",
      [started.result.agreement_id, day(7)])
    assert.equal(legacy.schedule_state, 'exception')
    target = legacy.id
  } })
  try {
    const { rows: [actual] } = await upgraded.query('select notes,date_override,time_override,price_override,retain_visit from bookings where id=$1', [target])
    assert.deepEqual(actual, { notes: 'Old gate code', date_override: true, time_override: true, price_override: true, retain_visit: true })
  } finally {
    await upgraded.close()
  }
})

test('pending first visit must be confirmed before reviewing future schedule changes', async () => {
  const c = await customer()
  const firstOn = day(7)
  const { id: first, updated_at: version } = await row(`insert into bookings(name,phone,address,customer_id,property_id,status,preferred_date)
    values('Pending service','5125550156','111 Editor Lane',$1,$2,'pending',$3) returning id,updated_at`,
  c.customer_id, c.property_id, firstOn)
  const { agreement_id: agreementId } = await call('crm_start_agreement', first, version, id(),
    { anchor_on: firstOn, next_on: day(14), interval_unit: 'week', interval_count: 1, items_template: items('Lawn care', '85.50') })
  const request = { mode: 'future', from: firstOn, definition: definition(weekly(firstOn)) }
  await assert.rejects(review(agreementId, request), /Confirm the first visit/)
  await assert.rejects(review(agreementId, { mode: 'range', from: firstOn, through: day(14), rule: weekly(firstOn) }),
    /Confirm the first visit/)
  assert.equal((await visit(first)).status, 'pending')
  await call('crm_job_command', first, (await visit(first)).updated_at, id(), 'confirm', { date: firstOn, time: 'Morning' })
  assert.equal((await visit(first)).status, 'confirmed')
  assert.equal((await review(agreementId, request)).preview.conflicts.length, 0)
})

test('a backward series move cannot cross a bounded cadence override', async () => {
  const { agreement_id: agreementId } = await setup({ definition: definition({ frequency: 'biweekly', anchor_on: today }) })
  await (await review(agreementId, { mode: 'range', from: day(7), through: day(35), rule: weekly(day(7)) })).save()
  const selected = await at(agreementId, 42)
  const facts = () => row(`select
    (select to_jsonb(a) from recurring_agreements a where a.id=$1) as agreement,
    (select jsonb_agg(to_jsonb(r) order by r.id) from agreement_schedule_revisions r where r.agreement_id=$1) as revisions,
    (select jsonb_agg(to_jsonb(b) order by b.id) from bookings b where b.agreement_id=$1) as bookings`, agreementId)
  const before = await facts()
  const request = { booking_id: selected.id, version: selected.updated_at, date: day(30), time: 'Afternoon' }
  await assert.rejects(call('crm_review_schedule_shift', agreementId, request, actor), /Use Edit schedule/)
  await assert.rejects(call('crm_shift_agreement', selected.id, selected.updated_at, id(), request.date, request.time), /Use Edit schedule/)
  assert.deepEqual(await facts(), before)
  const timeOnly = { ...request, date: selected.confirmed_date }
  const preview = await call('crm_review_schedule_shift', agreementId, timeOnly, actor)
  await call('crm_review_schedule_shift', agreementId, timeOnly, actor, id(), preview.preview)
  const after = await facts()
  assert.deepEqual(after.bookings.map(b => [b.id, b.occurrence_on, b.confirmed_date]),
    before.bookings.map(b => [b.id, b.occurrence_on, b.confirmed_date]))
  assert.ok(after.revisions.some(r => r.starts_on === day(7) && r.ends_before === day(36) && r.definition.base.frequency === 'weekly'))
  assert.equal((await visit(selected.id)).confirmed_time, 'Afternoon')
})

test('series move preview matches the calendar with a moved visit and a moved then canceled visit', async () => {
  const { agreement_id: agreementId, booking_id: first } = await setup()
  const moved = await at(agreementId, 7)
  const canceled = await at(agreementId, 14)
  await call('crm_job_command', moved.id, moved.updated_at, id(), 'reschedule', { date: day(10), time: 'Afternoon' })
  await call('crm_job_command', canceled.id, canceled.updated_at, id(), 'reschedule', { date: day(17), time: 'Morning' })
  await call('crm_job_command', canceled.id, (await visit(canceled.id)).updated_at, id(), 'cancel', {})
  const request = { booking_id: first, version: (await visit(first)).updated_at, date: day(2), time: 'Morning' }
  const preview = await call('crm_review_schedule_shift', agreementId, request, actor)
  assert.deepEqual(preview.conflicts, [])
  assert.equal(preview.changes.find(change => change.booking_id === moved.id).on, day(10))
  assert.equal(preview.changes.find(change => change.booking_id === canceled.id).action, 'tombstone')
  const shown = [...preview.dates, ...preview.changes.filter(change => change.action !== 'tombstone')]
    .filter(visit => visit.on <= day(28)).map(visit => [visit.on, visit.price]).sort()
  assert.deepEqual(shown, [2, 10, 23].map(offset => [day(offset), 85.5]))
  await call('crm_review_schedule_shift', agreementId, request, actor, id(), preview.preview)
  const calendar = (await db.query(`select service_on::text,job_total::float as price
    from crm_calendar_entries($1,$2) where agreement_id=$3 order by service_on`, [day(2), day(28), agreementId])).rows
  assert.deepEqual(shown, calendar.map(visit => [visit.service_on, visit.price]))
  const saved = await visit(canceled.id)
  assert.deepEqual([saved.status, saved.occurrence_on, saved.confirmed_date], ['canceled', day(16), day(17)])
})

test('resuming before a pause-canceled future first visit restores its exact saved facts', async () => {
  const { agreement_id: agreementId, booking_id: first } = await setup({
    label_id: (await label('Leaf cleanup')).id, first_on: day(7), price: '250.00', definition: definition(weekly(day(7))),
  })
  const original = await visit(first)
  const individuallyCanceled = await at(agreementId, 14)
  await call('crm_job_command', individuallyCanceled.id, individuallyCanceled.updated_at, id(), 'cancel', {})
  await (await review(agreementId, { mode: 'pause', from: today })).save()
  assert.deepEqual([(await visit(first)).status, (await visit(first)).schedule_cancellation], ['canceled', 'pause'])
  const resume = await review(agreementId, { mode: 'resume', from: day(1) })
  const planned = resume.preview.changes.find(change => change.booking_id === first)
  assert.deepEqual([planned.action, planned.on, planned.arrival, planned.price], ['restore', day(7), 'Morning', 250])
  assert.equal((await visit(first)).status, 'canceled')
  const saved = await resume.save()
  assert.deepEqual(await resume.save(), { ...saved, duplicate: true })
  const restored = await visit(first)
  assert.deepEqual(restored, { ...original, updated_at: restored.updated_at, lifecycle_note: 'Schedule visit restored' })
  const actual = (await db.query(`select booking_id,service_on::text,job_total::float as price
    from crm_calendar_entries($1,$2) where agreement_id=$3 order by service_on`, [day(1), day(21), agreementId])).rows
  assert.deepEqual(actual.map(visit => [visit.service_on, visit.price]), [[day(7), 250], [day(21), 250]])
  assert.equal(actual[0].booking_id, first)
  assert.equal((await visit(individuallyCanceled.id)).status, 'canceled')
})

test('bounded skip can cancel the first visit before recurrence starts without reviving it on resume', async () => {
  const { agreement_id: agreementId, booking_id: first } = await setup({
    label_id: (await label('Leaf cleanup')).id, first_on: day(7), price: '250.00', definition: definition(weekly(day(7))),
  })
  const original = await visit(first)
  const skip = await review(agreementId, { mode: 'range', from: day(1), through: day(7), rule: { frequency: 'paused' } })
  const planned = skip.preview.changes.find(change => change.booking_id === first)
  assert.deepEqual([planned.action, planned.on, planned.price], ['cancel', day(7), 250])
  await skip.save()
  const canceled = await visit(first)
  assert.deepEqual([canceled.status, canceled.schedule_cancellation, canceled.job_total, canceled.accepted_quote_snapshot],
    ['canceled', 'range', original.job_total, original.accepted_quote_snapshot])
  assert.equal((await at(agreementId, 14)).status, 'confirmed')
  await (await review(agreementId, { mode: 'pause', from: today })).save()
  const resume = await review(agreementId, { mode: 'resume', from: day(1) })
  assert.ok(!resume.preview.changes.some(change => change.booking_id === first && change.action === 'restore'))
  await resume.save()
  assert.equal((await visit(first)).status, 'canceled')
  assert.equal((await visit(first)).schedule_cancellation, 'range')
  assert.equal((await at(agreementId, 14)).status, 'confirmed')
})

test('bounded skip and pause respect protected first visits and individual cancellations', async () => {
  for (const protection of ['moved', 'paid', 'completed', 'canceled', 'skipped']) {
    const { agreement_id: agreementId, booking_id: first } = await setup({
      first_on: day(7), definition: definition(weekly(day(7))),
    })
    const { updated_at } = await visit(first)
    if (protection === 'paid') await call('record_job_payment', first, id(), '85.50', today, 'Cash', 'manual')
    else if (protection === 'completed') await call('complete_job', first, updated_at, id(), today)
    else {
      const action = { moved: 'reschedule', canceled: 'cancel', skipped: 'skip' }[protection]
      await call('crm_job_command', first, updated_at, id(), action, protection === 'moved' ? { date: day(9), time: '09:30' } : {})
    }
    const before = await visit(first)
    const skip = await review(agreementId, { mode: 'range', from: day(6), through: day(12), rule: { frequency: 'paused' } })
    assert.ok(!skip.preview.changes.some(change => change.booking_id === first && change.action !== 'keep'), protection)
    await skip.save()
    assert.deepEqual(await visit(first), before, protection)
    const pause = await review(agreementId, { mode: 'pause', from: today })
    if (protection === 'paid') {
      assert.ok(pause.preview.conflicts.some(change => change.booking_id === first))
      await assert.rejects(pause.save(), /Resolve the visits/)
    } else if (protection === 'canceled' || protection === 'skipped') {
      await pause.save()
      const resume = await review(agreementId, { mode: 'resume', from: day(1) })
      assert.ok(!resume.preview.changes.some(change => change.booking_id === first && change.action === 'restore'))
      await resume.save()
      assert.deepEqual(await visit(first), before, protection)
    }
  }
})
