import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { freshDb } from './pglite-db.mjs'

let db
const recipients = ['+15125550101', '+15125550102']
const draft = { address: '9 Quote Lane, Austin, TX', sections: [], freq: 'onetime', calculatedPrice: 83.55 }
const regularItems = [{ kind: 'service', description: 'Lawn care', amount: '83.55' },
  { kind: 'service', description: 'Bagging', amount: '10.25' }]
const firstItems = [...regularItems, { kind: 'discount', description: 'Introductory mowing discount', amount: '-25.06' }]
const terms = { draft, address: draft.address, sqFt: 1800, mode: 'choices', mowing: true,
  rows: [{ freq: 'onetime', when: 'After leaves clear', firstItems, regularItems, perVisitCents: 9380, firstVisitCents: 6874 }] }
const message = { to: 'customer@example.test', subject: 'Quote', html: '<p>Generated quote</p>' }

before(async () => { db = await freshDb() })
after(async () => db?.close())

async function lead() {
  const { rows: [row] } = await db.query("insert into leads(name,phone,email,address,quote_draft,attribution,gclid) values ('Quote fixture','5125550199','customer@example.test',$1,$2,$3,'first-click') returning id,updated_at::text",
    [draft.address, draft, { utm_source: 'fixture' }])
  return row
}

async function prepare(l, { id = randomUUID(), replaces = null, snapshot = terms, email = message } = {}) {
  const { rows: [{ value }] } = await db.query('select crm_prepare_sent_offer($1,$2,$3,$4,$5,$6,$7) value',
    [l.id, l.updated_at, id, replaces, snapshot, email, email.to])
  return value
}

async function finish(l, id, state = 'sent', provider = state === 'sent' ? randomUUID() : null) {
  const { rows: [{ value }] } = await db.query('select crm_finish_sent_offer($1,$2,$3,$4,$5) value',
    [l.id, id, state, provider, 'staff@example.test'])
  return value
}

async function accept(l, offer, hash = 'hash-v1', extra = {}) {
  const { rows: [{ value }] } = await db.query('select crm_accept_sent_offer($1,$2,$3,$4,$5) value',
    [l.id, offer?.id ?? null, hash, { frequency: offer ? 'onetime' : null, arrival: 'Morning', notes: 'Gate', ...extra }, recipients])
  return value
}

test('preview versions cannot drift, an ambiguous send stays open, and retries preserve the frozen request', async () => {
  const l = await lead()
  const o = await prepare(l)
  assert.equal(o.new_attempt, true)
  assert.equal((await finish(l, o.id, 'unknown')).state, 'unknown')
  assert.equal((await finish(l, o.id, 'failed')).state, 'unknown')
  await assert.rejects(prepare(l), /Check the previous email attempt/)
  await assert.rejects(accept(l, o), /no longer open/)
  const replay = await prepare(l, { id: o.id })
  assert.deepEqual(replay.terms, terms)
  assert.deepEqual(replay.message, message)
  await assert.rejects(prepare(l, { id: o.id, email: { ...message, subject: 'Changed' } }), /Send attempt changed/)
  assert.equal((await finish(l, o.id)).state, 'sent')
  assert.equal((await finish(l, o.id, 'unknown')).state, 'sent')
  await assert.rejects(db.query("update sent_offers set terms = '{}' where id=$1", [o.id]), /immutable/)
  await db.query("update leads set quote_draft=$2, updated_at=clock_timestamp() + interval '1 second' where id=$1",
    [l.id, { ...draft, calculatedPrice: 145 }])
  await assert.rejects(prepare(l, { replaces: o.id }), /Review the quote again/)
  assert.equal((await db.query('select terms from sent_offers where id=$1', [o.id])).rows[0].terms.rows[0].firstVisitCents, 6874)
})

test('a version creates one pending request with exact items, immutable terms, attribution and original alerts', async () => {
  const l = await lead()
  const o = await prepare(l)
  await finish(l, o.id)
  await assert.rejects(accept(l, o, 'wrong-option', { frequency: 'weekly' }), /Choose the quoted service/)
  const first = await accept(l, o)
  assert.equal(first.duplicate, false)
  const again = await accept(l, o)
  assert.deepEqual(again, { lead_id: l.id, booking_id: first.booking_id, event_id: first.event_id, duplicate: true })
  await assert.rejects(accept(l, o, 'different'), /request is already saved/)
  const { rows: [visit] } = await db.query('select * from bookings where id=$1', [first.booking_id])
  assert.equal(visit.status, 'pending')
  assert.equal(visit.confirmed_date, null)
  assert.equal(visit.job_total, '68.74')
  assert.deepEqual(visit.accepted_quote_snapshot.rows, terms.rows)
  assert.deepEqual(visit.attribution, { utm_source: 'fixture' })
  assert.equal(visit.gclid, 'first-click')
  assert.equal(visit.one_time, true)
  const { rows: [sums] } = await db.query('select sum(amount) total, count(*) count from job_items where booking_id=$1', [visit.id])
  assert.deepEqual(sums, { total: '68.74', count: 3 })
  const { rows: [alerts] } = await db.query('select count(*) count from staff_alerts where event_id=$1', [first.event_id])
  assert.equal(alerts.count, 4)
  assert.equal((await db.query('select accepted_booking_id from sent_offers where id=$1', [o.id])).rows[0].accepted_booking_id, visit.id)
})

test('known rejection retains the old offer, a successful revision replaces it, and acceptance beats an in-flight revision', async () => {
  const l = await lead()
  const original = await prepare(l)
  l.updated_at = (await finish(l, original.id)).updated_at
  const failed = await prepare(l, { replaces: original.id })
  await finish(l, failed.id, 'failed')
  assert.equal((await db.query('select replaced_by from sent_offers where id=$1', [original.id])).rows[0].replaced_by, null)
  const revised = await prepare(l, { replaces: original.id })
  const sent = await finish(l, revised.id)
  assert.equal(sent.state, 'sent')
  l.updated_at = sent.updated_at
  assert.equal((await db.query('select replaced_by from sent_offers where id=$1', [original.id])).rows[0].replaced_by, revised.id)
  await assert.rejects(accept(l, original), /no longer open/)
  const inFlight = await prepare(l, { replaces: revised.id })
  const request = await accept(l, revised)
  assert.equal((await finish(l, inFlight.id)).state, 'review')
  await assert.rejects(accept(l, inFlight), /no longer open/)
  const { rows: [row] } = await db.query('select replaced_by,accepted_booking_id from sent_offers where id=$1', [revised.id])
  assert.deepEqual(row, { replaced_by: null, accepted_booking_id: request.booking_id })
})

test('an older lead link continues as a review request without accepting the mutable draft', async () => {
  const l = await lead()
  const request = await accept(l, null)
  const { rows: [visit] } = await db.query('select status,job_total,accepted_quote_snapshot from bookings where id=$1', [request.booking_id])
  assert.deepEqual(visit, { status: 'pending', job_total: null,
    accepted_quote_snapshot: { address: draft.address, source: 'legacy_quote_review' } })
  assert.equal((await accept(l, null)).booking_id, request.booking_id)
  await assert.rejects(accept(l, null, 'other'), /request is already saved/)
})

test('public website intake still creates a preferred-date request after adding visit intent columns', async () => {
  const booking = { name: 'Website fixture', phone: '5125550198', address: draft.address,
    price_per_visit: 80, first_visit_price: 56, preferred_date: '2027-03-06' }
  const args = ['website-booking', randomUUID(), 'website-payload', { name: booking.name, phone: booking.phone, address: booking.address,
    attribution: { utm_source: 'test-website' } }, booking, null, recipients]
  const { rows: [{ value: result }] } = await db.query('select record_intake_v3($1,$2,$3,$4,$5,$6,$7) value', args)
  const { rows: [row] } = await db.query('select status,confirmed_date,preferred_date::text,date_override,time_override,price_override,retain_visit,attribution from bookings where id=$1', [result.booking_id])
  assert.deepEqual(row, { status: 'pending', confirmed_date: null, preferred_date: '2027-03-06', date_override: false,
    time_override: false, price_override: false, retain_visit: false, attribution: { utm_source: 'test-website' } })
  const { rows: [{ value: duplicate }] } = await db.query('select record_intake_v3($1,$2,$3,$4,$5,$6,$7) value', args)
  assert.equal(duplicate.booking_id, result.booking_id)
  assert.equal(duplicate.duplicate, true)
})
