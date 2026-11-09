import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { freshDb } from './pglite-db.mjs'

let db
before(async () => { db = await freshDb() })
after(async () => { await db?.close() })

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const day = offset => {
  const date = new Date(`${today}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

async function createPlan() {
  const customer = randomUUID(), property = randomUUID(), visit = randomUUID()
  await db.query("insert into customers(id,name,phone) values($1,'Noah Park','5125550184')", [customer])
  await db.query("insert into properties(id,customer_id,address) values($1,$2,'303 Crescent Field Drive')", [property, customer])
  const { rows: [first] } = await db.query(`insert into bookings(id,customer_id,property_id,name,phone,address,status,
    confirmed_date,job_total) values($1,$2,$3,'Noah Park','5125550184','303 Crescent Field Drive','confirmed',$4,64)
    returning updated_at::text`, [visit, customer, property, today])
  const { rows: [{ result }] } = await db.query('select crm_start_agreement($1,$2,$3,$4) result', [
    visit, first.updated_at, randomUUID(), { anchor_on: today, next_on: day(7), interval_unit: 'week', interval_count: 1,
      items_template: [{ kind: 'service', description: 'Lawn care', amount: '64.00' }] },
  ])
  return { agreement: result.agreement_id, customer, property }
}

async function projection(agreement, on) {
  const { rows } = await db.query('select * from crm_calendar_entries($1,$1) where agreement_id=$2', [on, agreement])
  return rows[0]
}

test('projected edits are atomic, retry-safe, and revision-bound through the public staff command', async () => {
  const { agreement } = await createPlan()
  const on = day(98)
  const projected = await projection(agreement, on)
  assert.equal(projected.booking_id, null)
  const change = async (operation, action, payload, date = on) => {
    const { rows: [{ result }] } = await db.query('select crm_calendar_edit_occurrence($1,$2,$3,$4,$5,$6) result',
      [agreement, projected.revision_id, date, operation, action, payload])
    return result
  }
  const operation = randomUUID()
  await assert.rejects(change(operation, 'reschedule', { date: today }), /already has a visit/)
  assert.equal((await projection(agreement, on)).booking_id, null)
  const edited = await change(operation, 'notes', { note: 'Call before entering.' })
  assert.equal((await projection(agreement, on)).booking_id, edited.booking_id)
  assert.deepEqual(await change(operation, 'notes', { note: 'Call before entering.' }), { ...edited, duplicate: true })
  const { rows: [saved] } = await db.query('select notes,job_total,updated_at::text from bookings where id=$1', [edited.booking_id])
  assert.equal(saved.notes, 'Call before entering.')
  assert.equal(Number(saved.job_total), 64)
  await assert.rejects(change(randomUUID(), 'notes', { note: 'Stale projected edit' }), /changed since/)
  await db.query('select crm_calendar_save_note($1,$2,$3,$4)', [edited.booking_id, saved.updated_at, randomUUID(), 'A newer note'])
  await assert.rejects(db.query('select crm_calendar_save_note($1,$2,$3,$4)',
    [edited.booking_id, saved.updated_at, randomUUID(), 'Stale note']), /changed since/)
  const { rows: [version] } = await db.query('select updated_at::text from recurring_agreements where id=$1', [agreement])
  await db.query("select crm_agreement_command($1,$2,$3,'price_template',$4)", [agreement, version.updated_at, randomUUID(),
    { items_template: [{ kind: 'service', description: 'Lawn care', amount: '65.00' }] }])
  await assert.rejects(change(randomUUID(), 'notes', { note: 'Old revision' }, day(105)), /Schedule changed/)
})

test('attention pages match counts for pending requests, overdue gaps and an unpersisted schedule conflict', async () => {
  const { agreement, customer, property } = await createPlan()
  const { rows: [{ id: moved }] } = await db.query(
    'select id from bookings where agreement_id=$1 and occurrence_on=$2', [agreement, day(14)])
  await db.query('update bookings set confirmed_date=$1,preferred_date=$1 where id=$2', [day(105), moved])
  await db.query(`insert into bookings(id,customer_id,property_id,name,phone,address,status)
    values($1,$2,$3,'Noah Park','5125550184','303 Crescent Field Drive','pending')`, [randomUUID(), customer, property])
  const at = day(112)
  const { rows: [{ counts }] } = await db.query('select crm_calendar_attention($1) counts', [at])
  for (const kind of ['schedule_review', 'overdue', 'needs_scheduling']) {
    const { rows: [{ page }] } = await db.query('select crm_calendar_attention_page($1,$2,50,0) page', [at, kind])
    assert.deepEqual(page.counts, counts)
    if (kind === 'overdue' && counts[kind] > 50) {
      const { rows: [{ overflow }] } = await db.query('select crm_calendar_attention_page($1,$2,50,50) overflow', [at, kind])
      assert.equal(page.rows.length + overflow.rows.length, counts[kind])
    } else assert.equal(page.rows.length, counts[kind])
    if (kind === 'schedule_review') {
      const row = page.rows.find(row => row.agreement_id === agreement)
      assert.equal(row.booking_id, moved)
      assert.match(row.reason, new RegExp(day(105)))
    }
    if (kind === 'overdue') {
      assert.ok(page.rows.some(row => row.agreement_id === agreement && row.cadence_on === day(91) && row.booking_id === null))
    }
    if (kind === 'needs_scheduling') assert.ok(page.rows.some(row => row.customer_id === customer && row.service_on === null))
  }
})
