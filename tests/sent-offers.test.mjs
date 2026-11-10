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

let fixturePhone = 5125550100
async function lead(phone = String(fixturePhone++)) {
  const { rows: [row] } = await db.query("insert into leads(name,phone,email,address,quote_draft,attribution,gclid) values ('Quote fixture',$4,'customer@example.test',$1,$2,$3,'first-click') returning id,updated_at::text",
    [draft.address, draft, { utm_source: 'fixture' }, phone])
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

const day = offset => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const actor = randomUUID()
async function confirmInput(leadId, bookingId, change = {}) {
  const { rows: [versions] } = await db.query('select b.updated_at::text as visit,l.updated_at::text as lead from bookings b join leads l on l.id=b.lead_id where b.id=$1 and l.id=$2',
    [bookingId, leadId])
  const request = { date: day(4), arrival: 'Morning', customer_id: null, property_id: null, name: 'Agreed customer',
    address: draft.address, staff_user_id: actor, ...change }
  const operation = randomUUID()
  return () => db.query('select crm_confirm_first_visit($1,$2,$3,$4,$5) as result',
    [bookingId, versions.visit, versions.lead, operation, request]).then(res => res.rows[0].result)
}

test('an accepted emailed series confirms its exact request once, with a labeled independent schedule', async () => {
  const l = await lead()
  const o = await prepare(l, { snapshot: { ...terms, rows: [{ ...terms.rows[0], freq: 'weekly' }] } })
  await finish(l, o.id)
  const pending = await accept(l, o, 'agreed-weekly', { frequency: 'weekly', date: day(2) })
  const save = await confirmInput(l.id, pending.booking_id)
  const result = await save()
  assert.equal(result.booking_id, pending.booking_id)
  assert.ok(result.customer_id && result.property_id && result.agreement_id)
  assert.deepEqual(await save(), { ...result, duplicate: true })
  const { rows: [v] } = await db.query('select status,confirmed_date::text,job_total,accepted_quote_snapshot,attribution from bookings where id=$1', [result.booking_id])
  assert.equal(v.status, 'confirmed')
  assert.equal(v.confirmed_date, day(4))
  assert.equal(v.job_total, '68.74')
  assert.deepEqual(v.accepted_quote_snapshot.rows[0].firstItems, firstItems)
  assert.deepEqual(v.attribution, { utm_source: 'fixture' })
  const { rows: [a] } = await db.query('select price_per_visit,semantic_key from recurring_agreements join service_labels on service_label_id=service_labels.id where recurring_agreements.id=$1', [result.agreement_id])
  assert.deepEqual(a, { price_per_visit: '93.80', semantic_key: 'mowing' })
  const { rows: future } = await db.query("select job_total from bookings where agreement_id=$1 and id <> $2 and status='confirmed'", [result.agreement_id, result.booking_id])
  assert.ok(future.length > 1 && future.every(row => row.job_total === '93.80'))
  assert.equal((await db.query('select count(*)::int as count from staff_alerts where event_id=$1', [pending.event_id])).rows[0].count, 4)
})

test('an existing payment conflict rolls back the new customer and property while retaining the request', async () => {
  const l = await lead()
  const o = await prepare(l)
  await finish(l, o.id)
  const pending = await accept(l, o)
  await db.query("update job_items set amount=80 where booking_id=$1 and description='Lawn care'", [pending.booking_id])
  await db.query("update bookings set payment_link='https://example.test/already-shared' where id=$1", [pending.booking_id])
  const counts = async () => (await db.query('select (select count(*) from customers) customers,(select count(*) from properties) properties')).rows[0]
  const before = await counts()
  const save = await confirmInput(l.id, pending.booking_id, { reviewed_terms: true })
  await assert.rejects(save, /Review the existing payment or payment link/)
  assert.deepEqual(await counts(), before)
  const { rows: [visit] } = await db.query('select status,customer_id,property_id,payment_link,job_total from bookings where id=$1', [pending.booking_id])
  assert.deepEqual(visit, { status: 'pending', customer_id: null, property_id: null,
    payment_link: 'https://example.test/already-shared', job_total: '68.74' })
})

test('website overgrowth and rounding stay in the accepted first visit, while recurring work uses regular price', async () => {
  const price = { name: 'Web quote', phone: '5125550191', address: draft.address, frequency: 'Bi-weekly',
    price_per_visit: 85, first_visit_price: 70, overgrowth_fee: 15, preferred_date: day(2) }
  const { rows: [{ value: request }] } = await db.query('select record_intake_v3($1,$2,$3,$4,$5,$6,$7) value',
    ['website-booking', randomUUID(), 'web-agreed', { name: price.name, phone: price.phone, address: price.address }, price, null, recipients])
  const before = await savedVisit(request.booking_id)
  assert.equal(before.accepted_quote_snapshot.total, 70)
  await db.query('select crm_replace_job_items($1,$2,$3,$4)', [before.id, before.updated_at, randomUUID(),
    JSON.stringify([{ kind: 'service', description: 'Draft adjustment', amount: '110.00' }])])
  await assert.rejects(await confirmInput(request.lead_id, request.booking_id), /Review the original quoted work/)
  const result = await (await confirmInput(request.lead_id, request.booking_id, { reviewed_terms: true }))()
  const { rows: [visit] } = await db.query('select job_total,price_per_visit,first_visit_price,accepted_quote_snapshot from bookings where id=$1', [result.booking_id])
  assert.equal(visit.job_total, '70.00')
  assert.equal(visit.price_per_visit, 85)
  assert.equal(visit.first_visit_price, 70)
  assert.deepEqual(visit.accepted_quote_snapshot.items.map(item => [item.description, item.amount]),
    [['Lawn care','85'],['First-visit overgrowth','15'],['Introductory mowing discount','-30']])
  assert.equal((await db.query('select price_per_visit from recurring_agreements where id=$1', [result.agreement_id])).rows[0].price_per_visit, '85.00')
})

test('a phone agreement is one durable request until the same reviewed confirmation links it', async () => {
  const l = await lead()
  const args = [l.id, randomUUID(), { price_cents: 9380, frequency: 'onetime', first_visit_on: day(2) },
    { source: 'phone_call', frequency: 'onetime', items: firstItems, regular_items: regularItems, mowing: true }, 'staff@example.test']
  const log = () => db.query('select crm_record_booked_call($1,$2,$3,$4,$5) value', args).then(res => res.rows[0].value)
  const pending = await log()
  assert.equal(pending.board_column, 'booking_request')
  assert.equal(pending.request_pending, true)
  assert.deepEqual(await log(), { ...pending, duplicate: true })
  const { rows: [before] } = await db.query('select status,customer_id,confirmed_date,job_total from bookings where id=$1', [pending.booking_id])
  assert.deepEqual(before, { status: 'pending', customer_id: null, confirmed_date: null, job_total: '68.74' })
  const result = await (await confirmInput(l.id, pending.booking_id))()
  assert.equal(result.agreement_id, null)
  assert.ok(result.customer_id && result.property_id)
  assert.equal((await db.query('select count(*)::int as count from staff_alerts s join intake_events e on s.event_id=e.id where e.lead_id=$1', [l.id])).rows[0].count, 0)
})

test('legacy multi-row sent work remains fully visible in review and cannot pick the first row implicitly', async () => {
  const l = await lead()
  const rows = [terms.rows[0], { ...terms.rows[0], freq: 'weekly', when: 'Later in the year' }]
  const o = await prepare(l, { snapshot: { ...terms, rows } })
  await finish(l, o.id)
  const pending = await accept(l, o, 'legacy-multi', { frequency: null })
  const { rows: [visit] } = await db.query('select status,job_total,accepted_quote_snapshot from bookings where id=$1', [pending.booking_id])
  assert.equal(visit.status, 'pending')
  assert.equal(visit.job_total, null)
  assert.deepEqual(visit.accepted_quote_snapshot.rows, rows)
  await assert.rejects(await confirmInput(l.id, pending.booking_id, { reviewed_terms: true }), /multiple promised services/)
  assert.equal((await db.query('select status from bookings where id=$1', [pending.booking_id])).rows[0].status, 'pending')
})

const sqlValue = async (statement, args = []) => (await db.query(statement, args)).rows[0]
const savedVisit = id => sqlValue('select id,updated_at::text,confirmed_date::text,status,job_total,payment_link,accepted_quote_snapshot,price_override from bookings where id=$1', [id])
const promo = customer => sqlValue('select source_booking_id,allocated_booking_id,consumed_on::text from crm_intro_grants where customer_id=$1', [customer])
const complete = (visit, on, review = null, op = randomUUID()) => sqlValue('select complete_job($1,$2,$3,$4,$5) value', [visit.id, visit.updated_at, op, on, review])
const jobChange = (visit, action, payload = {}) => sqlValue('select crm_job_command($1,$2,$3,$4,$5) value', [visit.id, visit.updated_at, randomUUID(), action, payload])
const scheduleEdit = async (agreement, edit) => {
  const { updated_at: version } = await sqlValue('select updated_at::text from recurring_agreements where id=$1', [agreement])
  const { value: preview } = await sqlValue('select crm_service_edit($1,$2,$3,$4) value', [agreement, version, edit, actor])
  const { value: result } = await sqlValue('select crm_service_edit($1,$2,$3,$4,$5,$6) value', [agreement, version, edit, actor, randomUUID(), preview.preview])
  return { preview, result }
}
const appointment = (agreement, offset) => sqlValue('select id from bookings where agreement_id=$1 and occurrence_on=$2', [agreement, day(offset)]).then(v => savedVisit(v.id))
async function confirmedPromotion(freq = 'weekly', confirm = {}, snapshot = terms) {
  const l = await lead()
  const o = await prepare(l, { snapshot: { ...snapshot, rows: [{ ...snapshot.rows[0], freq }] } })
  await finish(l, o.id)
  const pending = await accept(l, o, 'agreed-intro', { frequency: freq, date: day(2) })
  return (await confirmInput(l.id, pending.booking_id, confirm))()
}
async function newService(customerId, request) {
  const { value: preview } = await sqlValue('select crm_service_create($1,$2,$3) value', [customerId, request, actor])
  const op = randomUUID()
  const save = () => sqlValue('select crm_service_create($1,$2,$3,$4,$5) value', [customerId, request, actor, op, preview.preview]).then(r => r.value)
  return { preview, save }
}
const mowingId = async () => (await sqlValue("select id from service_labels where semantic_key='mowing' and retired_at is null")).id
const recurring = (frequency, anchor_on) => ({ version: 1, base: { frequency, anchor_on } })

test('reschedule preserves the exact intro, skip moves it once, and later completion waits for an unresolved earlier mow', async () => {
  const agreement = await confirmedPromotion()
  const original = await savedVisit(agreement.booking_id)
  const later = await appointment(agreement.agreement_id, 18)
  await assert.rejects(complete(later, day(18)), error =>
    error.code === 'PT422' && JSON.parse(error.detail).earlierVisitId === original.id)
  await jobChange(original, 'reschedule', { date: day(5), time: 'Afternoon' })
  const moved = await savedVisit(original.id)
  assert.equal(moved.job_total, '68.74')
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, original.id)
  await jobChange(moved, 'skip')
  const next = await appointment(agreement.agreement_id, 11)
  assert.equal(next.job_total, '68.74')
  assert.equal((await savedVisit(later.id)).job_total, '93.80')
  assert.equal((await savedVisit(original.id)).status, 'skipped')
  assert.deepEqual((await savedVisit(original.id)).accepted_quote_snapshot, original.accepted_quote_snapshot)
  assert.deepEqual(await promo(agreement.customer_id), { source_booking_id: original.id, allocated_booking_id: next.id, consumed_on: null })
  const op = randomUUID()
  await complete(next, day(11), null, op)
  assert.equal((await complete(next, day(11), null, op)).value.duplicate, true)
  await complete(await savedVisit(later.id), day(18))
  assert.equal((await promo(agreement.customer_id)).consumed_on, day(11))
  assert.equal((await savedVisit(later.id)).job_total, '93.80')
})

test('pause and later resume retain the unused price and transfer it to the first restored eligible visit', async () => {
  const agreement = await confirmedPromotion()
  const source = await savedVisit(agreement.booking_id)
  const before = await appointment(agreement.agreement_id, 11)
  await scheduleEdit(agreement.agreement_id, { mode: 'pause', from: day(0) })
  assert.equal((await savedVisit(source.id)).status, 'canceled')
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, source.id)
  const { preview } = await scheduleEdit(agreement.agreement_id, { mode: 'resume', from: day(6) })
  assert.deepEqual(preview.intro_transfer, { to_on: day(11), standard_price: 93.80, intro_price: 68.74 })
  assert.equal(preview.dates.find(date => date.on === day(11)).price, 68.74)
  const restored = await appointment(agreement.agreement_id, 11)
  assert.equal(restored.id, before.id)
  assert.equal(restored.job_total, '68.74')
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, restored.id)
  assert.equal((await savedVisit(source.id)).job_total, '68.74')
  assert.equal((await appointment(agreement.agreement_id, 18)).job_total, '93.80')
})

test('a backdated actual mow prompts a reviewed completion and keeps both paid and completed amounts', async () => {
  const agreement = await confirmedPromotion()
  const first = await savedVisit(agreement.booking_id)
  const later = await appointment(agreement.agreement_id, 11)
  await complete(first, day(5))
  await db.query('select record_job_payment($1,$2,$3,$4,$5,$6)', [first.id, randomUUID(), 68.74, day(5), 'cash', 'manual'])
  let review
  await assert.rejects(complete(later, day(3)), error => {
    review = JSON.parse(error.detail)
    return error.code === 'PT422' && review.allocatedAmount === 68.74 && review.visitAmount === 93.80 && !!review.token
  })
  assert.equal((await savedVisit(later.id)).status, 'confirmed')
  await assert.rejects(complete(later, day(2), review.token), error => error.code === 'PT422')
  await complete(later, day(3), review.token)
  assert.equal((await savedVisit(first.id)).job_total, '68.74')
  assert.equal((await savedVisit(later.id)).job_total, '93.80')
  assert.equal((await promo(agreement.customer_id)).consumed_on, day(5))
  assert.equal((await sqlValue('select amount from job_payments where booking_id=$1', [first.id])).amount, '68.74')
})

test('a shared payment link prevents promo transfer even after the linked visit is skipped', async () => {
  const agreement = await confirmedPromotion()
  await db.query("update bookings set payment_link='https://example.test/live' where id=$1", [agreement.booking_id])
  await jobChange(await savedVisit(agreement.booking_id), 'skip')
  const later = await appointment(agreement.agreement_id, 11)
  assert.equal(later.job_total, '93.80')
  await assert.rejects(complete(later, day(11)), error => error.code === 'PT422'
    && /payment or payment link/.test(error.message) && JSON.parse(error.detail).allocatedAmount === 68.74)
  const first = await savedVisit(agreement.booking_id)
  assert.equal(first.payment_link, 'https://example.test/live')
  assert.equal(first.job_total, '68.74')
  assert.equal((await promo(agreement.customer_id)).consumed_on, null)
})

test('an accepted one-off keeps the exact unused intro when it becomes a schedule, without discounting custom or returning work', async () => {
  const first = await confirmedPromotion('onetime')
  const source = await savedVisit(first.booking_id)
  const booked = await newService(first.customer_id, { source_id: source.id, source_version: source.updated_at,
    property_id: first.property_id, label_id: await mowingId(), price: '78.00', arrival: 'Morning',
    first_on: day(4), definition: recurring('weekly', day(4)) })
  assert.equal(booked.preview.first_price, 68.74)
  assert.equal(booked.preview.dates[0].price, 78)
  const result = await booked.save()
  assert.equal(result.booking_id, source.id)
  await jobChange(await savedVisit(source.id), 'skip')
  const next = await appointment(result.agreement_id, 11)
  assert.equal(next.job_total, '68.74')
  await complete(next, day(11))
  const second = await newService(first.customer_id, { property_id: first.property_id, label_id: await mowingId(),
    price: '82.00', arrival: 'Morning', first_on: day(20), definition: recurring('biweekly', day(20)) })
  assert.equal(second.preview.first_price, 82)
  const newPlan = await second.save()
  assert.equal((await savedVisit(newPlan.booking_id)).job_total, '82.00')
  assert.equal((await sqlValue('select crm_intro_customer_eligible($1) eligible', [first.customer_id])).eligible, false)
  assert.equal((await promo(first.customer_id)).consumed_on, day(11))
  const cleanup = await sqlValue("select id from service_labels where name='Leaf cleanup'")
  const extra = await newService(first.customer_id, { property_id: first.property_id, label_id: cleanup.id, price: '250.00',
    arrival: 'Morning', first_on: day(20), definition: null })
  assert.equal((await savedVisit((await extra.save()).booking_id)).job_total, '250.00')
})

test('a later independent series may explicitly carry an unused quote without copying its ongoing price', async () => {
  const first = await confirmedPromotion('biweekly')
  await scheduleEdit(first.agreement_id, { mode: 'end', from: day(0) })
  const candidate = await sqlValue('select * from crm_intro_continuation($1)', [first.customer_id])
  assert.equal(candidate.source_id, first.booking_id)
  const booked = await newService(first.customer_id, { intro_source_id: candidate.source_id,
    property_id: first.property_id, label_id: await mowingId(), price: '78.00', arrival: 'Morning',
    first_on: day(120), definition: recurring('weekly', day(120)) })
  assert.equal(booked.preview.first_price, 68.74)
  assert.equal(booked.preview.intro_continuation.regular_price, 78)
  const second = await booked.save()
  assert.deepEqual(await booked.save(), { ...second, duplicate: true })
  assert.notEqual(second.agreement_id, first.agreement_id)
  assert.equal((await savedVisit(second.booking_id)).job_total, '68.74')
  const following = await entries(second.agreement_id, 120, 128)
  assert.deepEqual(following.map(row => [row.cadence_on, row.booking_id, row.price]),
    [[day(120), second.booking_id, 68.74], [day(127), null, 78]])
  await sqlValue('select crm_reconcile_schedule($1,$2)', [second.agreement_id, day(120)])
  assert.equal((await appointment(second.agreement_id, 127)).job_total, '78.00')
  assert.equal((await sqlValue('select price_per_visit from recurring_agreements where id=$1', [first.agreement_id])).price_per_visit, '93.80')
  assert.equal((await savedVisit(first.booking_id)).job_total, '68.74')
  assert.equal((await promo(first.customer_id)).allocated_booking_id, second.booking_id)
})

test('restoring a formerly discounted date keeps one intro and reviews a changed first actual mow', async () => {
  const agreement = await confirmedPromotion()
  await scheduleEdit(agreement.agreement_id, { mode: 'range', from: day(1), through: day(4), rule: { frequency: 'paused' } })
  assert.equal((await appointment(agreement.agreement_id, 11)).job_total, '68.74')
  await scheduleEdit(agreement.agreement_id, { mode: 'pause', from: day(0) })
  await scheduleEdit(agreement.agreement_id, { mode: 'resume', from: day(13) })
  assert.equal((await appointment(agreement.agreement_id, 18)).job_total, '68.74')
  const { preview } = await scheduleEdit(agreement.agreement_id, {
    mode: 'future', from: day(10), definition: recurring('weekly', day(4)),
  })
  assert.equal(preview.dates.find(date => date.on === day(11)).price, 93.80)
  assert.equal(preview.dates.find(date => date.on === day(18)).price, 68.74)
  const restored = await appointment(agreement.agreement_id, 11)
  const allocated = await appointment(agreement.agreement_id, 18)
  assert.equal(restored.job_total, '93.80')
  assert.equal(allocated.job_total, '68.74')
  let review
  await assert.rejects(complete(restored, day(11)), error => {
    review = JSON.parse(error.detail)
    return error.code === 'PT422' && review.move && review.visitAmount === 93.80 && review.replacementAmount === 93.80
  })
  await complete(restored, day(11), review.token)
  assert.equal((await savedVisit(restored.id)).job_total, '68.74')
  assert.equal((await savedVisit(allocated.id)).job_total, '93.80')
  assert.equal((await promo(agreement.customer_id)).consumed_on, day(11))
})

test('a canceled acceptance cannot be replaced through the staff Book visit command', async () => {
  const l = await lead()
  const o = await prepare(l)
  await finish(l, o.id)
  const pending = await accept(l, o)
  await jobChange(await savedVisit(pending.booking_id), 'cancel')
  const { updated_at } = await sqlValue('select updated_at::text from leads where id=$1', [l.id])
  await assert.rejects(sqlValue('select crm_staff_quote_request($1,$2,$3,$4,$5)', [l.id, updated_at, randomUUID(),
    { offer_id: o.id }, 'staff@example.test']), /already has an acceptance/)
  assert.equal((await sqlValue('select accepted_booking_id from sent_offers where id=$1', [o.id])).accepted_booking_id, pending.booking_id)
  assert.equal((await sqlValue('select count(*)::int as count from bookings where lead_id=$1', [l.id])).count, 1)
})

test('the intro migration preserves older completed money, accepted terms, and attribution without inferring a consumed grant', async () => {
  const old = { lead: randomUUID(), booking: randomUUID(), customer: randomUUID(), property: randomUUID(), offer: randomUUID() }
  const historic = '{"source":"sent_offer","mowing":true,"rows":[{"freq":"weekly","when":"From March"},{"freq":"monthly","when":"Winter"}]}'
  const before = async connection => {
    const { rows: [snapshot] } = await connection.query(`select to_jsonb(b) - 'intro_parked_price' - 'extra_for_agreement_id' as visit,
      (select jsonb_agg(to_jsonb(i) order by i.id) from job_items i where i.booking_id = b.id) as items,
      (select jsonb_agg(to_jsonb(p) order by p.id) from job_payments p where p.booking_id = b.id) as payments,
      (select to_jsonb(o) from sent_offers o where o.id = $2) as offer from bookings b where b.id = $1`, [old.booking, old.offer])
    return snapshot
  }
  let frozen
  const upgraded = await freshDb({ beforeMigration: async (connection, name) => {
    if (!name.endsWith('_crm_intro_entitlement.sql')) return
    await connection.query("insert into customers(id,name,phone) values($1,'Historical Fixture','5125550198')", [old.customer])
    await connection.query('insert into properties(id,customer_id,address) values($1,$2,$3)', [old.property, old.customer, draft.address])
    await connection.query("insert into leads(id,name,phone,address) values($1,'Historical Fixture','5125550198',$2)", [old.lead, draft.address])
    await connection.query(`insert into bookings(id,lead_id,customer_id,property_id,name,phone,address,status,job_total,
      confirmed_date,completed_at,notes,accepted_quote_snapshot,attribution,payment_link)
      values($1,$2,$3,$4,'Historical Fixture','5125550198',$5,'completed',93.80,'2025-01-01','2025-01-01T12:00Z',
        'Keep historical note',$6,'{"utm_source":"older-fixture"}','https://example.test/old-payment')`,
      [old.booking, old.lead, old.customer, old.property, draft.address, historic])
    await connection.query("insert into job_items(booking_id,kind,description,amount) values($1,'service','Saved work',93.80)", [old.booking])
    await connection.query("select record_job_payment($1,$2,93.80,'2025-01-01','cash','manual')", [old.booking, randomUUID()])
    await connection.query(`insert into sent_offers(id,lead_id,version,terms,message,recipient,state,provider_id,sent_at,accepted_booking_id)
      values($1,$2,1,$3,'{}','historical@example.test','sent','historical-fixture','2025-01-01T12:00Z',$4)`,
      [old.offer, old.lead, historic, old.booking])
    frozen = await before(connection)
  } })
  try {
    assert.deepEqual(await before(upgraded), frozen)
    assert.equal((await upgraded.query('select count(*)::int as count from crm_intro_grants')).rows[0].count, 0)
    assert.equal((await upgraded.query('select crm_intro_customer_eligible($1) eligible', [old.customer])).rows[0].eligible, false)
  } finally { await upgraded.close() }
})

test('a quoted $250 monthly cleanup keeps the exact items and label through confirmation and generation', async () => {
  const l = await lead()
  const items = [{ kind: 'service', description: 'Leaf cleanup', amount: '250.00' }]
  const o = await prepare(l, { snapshot: { ...terms, mowing: false,
    rows: [{ freq: 'monthly', when: 'Start when leaves fall', firstItems: items, regularItems: items, perVisitCents: 25000, firstVisitCents: null }] } })
  await finish(l, o.id)
  const pending = await accept(l, o, 'monthly-cleanup', { frequency: 'monthly', date: day(2) })
  const label = await sqlValue("select id from service_labels where name='Leaf cleanup'")
  const save = await confirmInput(l.id, pending.booking_id, { label_id: label.id })
  const result = await save()
  const schedule = await sqlValue('select service_label_id,interval_unit,interval_count,items_template from recurring_agreements where id=$1', [result.agreement_id])
  assert.deepEqual(schedule, { service_label_id: label.id, interval_unit: 'month', interval_count: 1, items_template: items })
  const prices = (await db.query('select job_total from bookings where agreement_id=$1', [result.agreement_id])).rows
  assert.ok(prices.length > 1 && prices.every(visit => visit.job_total === '250.00'))
  assert.equal(await promo(result.customer_id), undefined)
  assert.deepEqual((await savedVisit(result.booking_id)).accepted_quote_snapshot.items, items)
})

test('confirmation reviews a differing existing property and preserves the original quoted address', async () => {
  const l = await lead()
  const o = await prepare(l)
  await finish(l, o.id)
  const request = await accept(l, o)
  const customer = await sqlValue("insert into customers(name,phone) values('Reviewed property','5125550196') returning id")
  const savedAddress = draft.address + ' 78704'
  const property = await sqlValue('insert into properties(customer_id,address) values($1,$2) returning id', [customer.id, savedAddress])
  const identity = { customer_id: customer.id, property_id: property.id }
  await assert.rejects(await confirmInput(l.id, request.booking_id, identity), /Review both the quoted and selected property/)
  await assert.rejects(await confirmInput(l.id, request.booking_id, { ...identity, reviewed_property_address: 'Old address' }),
    /Review both the quoted and selected property/)
  const result = await (await confirmInput(l.id, request.booking_id, { ...identity, reviewed_property_address: savedAddress }))()
  assert.equal(result.customer_id, customer.id)
  assert.equal(result.property_id, property.id)
  const booking = await sqlValue('select address,accepted_quote_snapshot from bookings where id=$1', [result.booking_id])
  assert.equal(booking.address, savedAddress)
  assert.equal(booking.accepted_quote_snapshot.address, draft.address)
})

test('an unlinked same-phone suggestion requires review and preserves a returning customer’s promised price', async () => {
  const phone = '5125550197'
  const customer = await sqlValue("insert into customers(name,phone) values('Returning mower','+1 (512) 555-0197') returning id")
  const property = await sqlValue('insert into properties(customer_id,address) values($1,$2) returning id', [customer.id, draft.address])
  await db.query(`insert into bookings(name,phone,address,status,customer_id,property_id,service_label_id,confirmed_date,completed_at)
    values('Returning mower',$1,$2,'completed',$3,$4,$5,'2025-03-01','2025-03-01T13:00Z')`,
    [phone, draft.address, customer.id, property.id, await mowingId()])
  const l = await lead(phone)
  assert.equal((await sqlValue('select crm_intro_lead_eligibility($1) as status', [l.id])).status, 'review')
  const offer = await prepare(l)
  await finish(l, offer.id)
  const pending = await accept(l, offer)
  const identity = { customer_id: customer.id, property_id: property.id }
  await assert.rejects(await confirmInput(l.id, pending.booking_id, identity), /Review the customer’s introductory price/)
  const result = await (await confirmInput(l.id, pending.booking_id, { ...identity, reviewed_intro: true }))()
  assert.equal(result.customer_id, customer.id)
  assert.equal((await savedVisit(pending.booking_id)).job_total, '68.74')
  assert.equal(await promo(customer.id), undefined)
  assert.equal((await sqlValue('select crm_intro_lead_eligibility($1) as status', [l.id])).status, 'ineligible')
  const audit = await sqlValue("select request from crm_operations where action='confirm_first_visit' and target_id=$1", [pending.booking_id])
  assert.equal(audit.request.reviewed_intro, true)
})

test('a reviewed possible match can still create an independent new customer and first-mow grant', async () => {
  const phone = '5125550195'
  const other = await sqlValue("insert into customers(name,phone) values('Other household',$1) returning id", [phone])
  const l = await lead(phone)
  assert.equal((await sqlValue('select crm_intro_lead_eligibility($1) as status', [l.id])).status, 'review')
  const offer = await prepare(l)
  await finish(l, offer.id)
  const pending = await accept(l, offer)
  await assert.rejects(await confirmInput(l.id, pending.booking_id), /Review the customer’s introductory price/)
  const result = await (await confirmInput(l.id, pending.booking_id, { reviewed_intro: true }))()
  assert.notEqual(result.customer_id, other.id)
  assert.equal((await promo(result.customer_id)).allocated_booking_id, pending.booking_id)
})

async function expiredAttempt(l, replaces = null) {
  const id = randomUUID()
  await db.query(`insert into sent_offers(id,lead_id,version,terms,message,recipient,state,created_at,replaces_id)
    values($1,$2,$3,$4,$5,$6,'unknown',now()-interval '24 hours',$7)`,
    [id, l.id, replaces ? 2 : 1, terms, message, message.to, replaces])
  return id
}
function deliveryReview(l, id, options = {}) {
  const op = options.operationId ?? randomUUID()
  const evidence = options.evidence ?? 'Reviewed the original Resend request and response.'
  return () => sqlValue('select crm_review_expired_sent_offer($1,$2,$3,$4,$5,$6,$7) as value',
    [l.id, id, op, evidence, options.providerId ?? null, options.sentAt ?? null, 'staff@example.test']).then(row => row.value)
}

test('staff can close an expired unknown attempt, preserve evidence, and prepare a fresh version', async () => {
  const l = await lead()
  const expired = await expiredAttempt(l)
  await assert.rejects(prepare(l), /Check the previous email attempt/)
  await assert.rejects(deliveryReview(l, expired, { evidence: ' ' }), /Record the provider evidence/)
  const review = deliveryReview(l, expired)
  const closed = await review()
  assert.equal(closed.state, 'closed')
  assert.deepEqual(await review(), { ...closed, duplicate: true })
  const facts = await sqlValue('select state,terms,message,sent_at,provider_id from sent_offers where id=$1', [expired])
  assert.deepEqual(facts, { state: 'closed', terms, message, sent_at: null, provider_id: null })
  assert.equal((await finish(l, expired)).state, 'closed')
  await assert.rejects(accept(l, { id: expired }), /no longer open/)
  l.updated_at = closed.updated_at
  const fresh = await prepare(l)
  assert.equal(fresh.version, 2)
  const audit = await sqlValue("select actor_email,data from lead_activities where lead_id=$1 and outcome='delivery_review'", [l.id])
  assert.equal(audit.actor_email, 'staff@example.test')
  assert.equal(audit.data.offer_id, expired)
})

test('staff verification keeps the provider timestamp and preserves an earlier acceptance', async () => {
  const l = await lead()
  const original = await prepare(l)
  await finish(l, original.id)
  const expired = await expiredAttempt(l, original.id)
  const earlier = await accept(l, original)
  const providerId = randomUUID()
  const sentAt = (await sqlValue("select (created_at+interval '1 second')::text as sent from sent_offers where id=$1", [expired])).sent
  const resolution = await deliveryReview(l, expired, { providerId, sentAt })()
  assert.equal(resolution.state, 'review')
  const facts = await sqlValue('select sent_at::text,provider_id from sent_offers where id=$1', [expired])
  assert.deepEqual(facts, { sent_at: sentAt, provider_id: providerId })
  const first = await sqlValue('select accepted_booking_id,replaced_by from sent_offers where id=$1', [original.id])
  assert.deepEqual(first, { accepted_booking_id: earlier.booking_id, replaced_by: null })
  await assert.rejects(accept(l, { id: expired }), /no longer open/)
})

test('manual delivery review waits until the safe retry window expires', async () => {
  const l = await lead()
  const o = await prepare(l)
  await finish(l, o.id, 'unknown')
  await assert.rejects(deliveryReview(l, o.id), /still has a safe retry window/)
  assert.equal((await sqlValue('select state from sent_offers where id=$1', [o.id])).state, 'unknown')
})

const entries = async (agreementId, from, to = from) => (await db.query(`select booking_id,revision_id,cadence_on::text,job_total::float as price
  from crm_calendar_entries($1,$2) where agreement_id=$3 order by cadence_on`, [day(from), day(to), agreementId])).rows
async function winterResume(result) {
  await scheduleEdit(result.agreement_id, { mode: 'pause', from: day(0) })
  return scheduleEdit(result.agreement_id, { mode: 'resume', from: day(120) })
}
const project = (agreement, row) => sqlValue('select crm_calendar_projected_items($1,$2,$3) value',
  [agreement, row.revision_id, row.cadence_on]).then(r => r.value)
const projectedAction = (agreement, row, action, payload, op = randomUUID()) =>
  sqlValue('select crm_calendar_edit_occurrence($1,$2,$3,$4,$5,$6) value',
    [agreement, row.revision_id, row.cadence_on, op, action, payload]).then(r => r.value)

test('distant resume preview, Calendar and detail agree with later bounded materialization', async () => {
  const agreement = await confirmedPromotion()
  const id = agreement.agreement_id
  const { preview } = await winterResume(agreement)
  assert.deepEqual(preview.intro_transfer, { to_on: day(123), standard_price: 93.80, intro_price: 68.74 })
  assert.equal(preview.dates[0].price, 68.74)
  const nextDate = () => sqlValue('select next_on from crm_schedule_next_dates($1,$2)', [[id], day(0)])
  assert.equal((await nextDate()).next_on.toISOString().slice(0, 10), day(123))
  const projected = await entries(id, 120, 133)
  assert.deepEqual(projected.map(row => [row.booking_id, row.cadence_on, row.price]),
    [[null, day(123), 68.74], [null, day(130), 93.80]])
  assert.deepEqual(await project(id, projected[0]), { items: firstItems, total: 68.74 })
  assert.equal((await entries(id, 130))[0].price, 93.80)
  let attentionVisit
  for (let offset = 0; ; offset += 25) {
    const { page } = await sqlValue("select crm_calendar_attention_page($1,'overdue',25,$2) as page", [day(124), offset])
    attentionVisit = page.rows.find(row => row.agreement_id === id && row.cadence_on === day(123))
    if (attentionVisit || page.rows.length < 25) break
  }
  assert.equal(attentionVisit?.job_total, 68.74)
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, agreement.booking_id)

  await sqlValue('select crm_reconcile_schedule($1,$2)', [id, day(120)])
  const saved = await entries(id, 120, 133)
  assert.ok(saved.every(row => row.booking_id))
  assert.equal((await nextDate()).next_on.toISOString().slice(0, 10), day(123))
  assert.deepEqual(saved.map(({ cadence_on, price }) => [cadence_on, price]),
    projected.map(({ cadence_on, price }) => [cadence_on, price]))
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, saved[0].booking_id)
})

test('a distant projected action charges the reviewed amount and cannot jump an earlier projected mow', async () => {
  const agreement = await confirmedPromotion()
  const id = agreement.agreement_id
  await winterResume(agreement)
  const [first, later] = await entries(id, 120, 133)
  await assert.rejects(projectedAction(id, later, 'complete', { date: later.cadence_on, expected_items: regularItems }), error =>
    error.code === 'PT422' && JSON.parse(error.detail).earlierOccurrence.on === first.cadence_on)
  assert.equal((await entries(id, 130))[0].booking_id, null)
  const bookedLater = await projectedAction(id, later, 'payment_link', { expected_items: regularItems })
  assert.equal((await savedVisit(bookedLater.booking_id)).job_total, '93.80')
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, agreement.booking_id)
  assert.equal((await entries(id, 123))[0].booking_id, null)
  const op = randomUUID()
  const bookedFirst = await projectedAction(id, first, 'payment_link', { expected_items: firstItems }, op)
  assert.equal((await savedVisit(bookedFirst.booking_id)).job_total, '68.74')
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, bookedFirst.booking_id)
  assert.deepEqual(await projectedAction(id, first, 'payment_link', { expected_items: firstItems }, op),
    { ...bookedFirst, duplicate: true })
})

const basicItems = [{ kind: 'service', description: 'Lawn care', amount: '80.00' }]
const basicPromo = [...basicItems, { kind: 'discount', description: 'Introductory mowing discount', amount: '-24.00' }]
const basicOffer = { ...terms, rows: [{ ...terms.rows[0], regularItems: basicItems, firstItems: basicPromo,
  perVisitCents: 8000, firstVisitCents: 5600 }] }
const extraFor = async (agreement, first_on, price = '78.00') => (await newService(agreement.customer_id, {
  related_agreement_id: agreement.agreement_id, property_id: agreement.property_id, label_id: await mowingId(),
  first_on, price, arrival: 'Morning', definition: null,
})).save()

test('earlier explicitly related extra keeps its custom price until compatible intro review and invalidates a stale projected amount', async () => {
  const agreement = await confirmedPromotion('weekly', {}, basicOffer)
  const id = agreement.agreement_id
  await winterResume(agreement)
  const [first] = await entries(id, 123)
  assert.equal(first.price, 56)
  const extra = await extraFor(agreement, day(116))
  assert.equal((await savedVisit(extra.booking_id)).job_total, '78.00')
  assert.equal((await entries(id, 123))[0].price, 80)
  await assert.rejects(projectedAction(id, first, 'payment_link', { expected_items: basicPromo }),
    /Visit changed since it was opened/)
  assert.equal((await entries(id, 123))[0].booking_id, null)
  await assert.rejects(projectedAction(id, first, 'complete', { date: day(123), expected_items: basicItems }),
    error => error.code === 'PT422' && JSON.parse(error.detail).earlierVisitId === extra.booking_id)

  const before = await savedVisit(extra.booking_id)
  let review
  await assert.rejects(complete(before, day(116)), error => {
    review = JSON.parse(error.detail)
    return error.code === 'PT422' && review.visitAmount === 78 && review.introAmount === 56 && review.move
  })
  await complete(before, day(116), review.token)
  const done = await savedVisit(extra.booking_id)
  assert.equal(done.job_total, '56.00')
  assert.deepEqual(done.accepted_quote_snapshot, before.accepted_quote_snapshot)
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, extra.booking_id)
  assert.equal((await entries(id, 123))[0].price, 80)
})

const mismatchedExtra = async () => {
  const agreement = await confirmedPromotion()
  await winterResume(agreement)
  const extra = await extraFor(agreement, day(116))
  return { agreement, visit: await savedVisit(extra.booking_id) }
}

const completionOptions = async (visit, on = day(116)) => {
  let detail
  await assert.rejects(complete(visit, on), error => {
    detail = JSON.parse(error.detail)
    return error.code === 'PT422' && !!detail.extraReview
  })
  return detail.extraReview
}
const reviewedComplete = (visit, token, op = randomUUID(), staff = actor, on = day(116)) =>
  sqlValue('select complete_job($1,$2,$3,$4,$5,$6) value', [visit.id, visit.updated_at, op, on, token, staff]).then(r => r.value)
const introOutcome = customer => sqlValue('select replaced_by_booking_id,consumed_on::text from crm_intro_grants where customer_id=$1', [customer])
const visitItems = id => db.query('select kind,description,amount::text from job_items where booking_id=$1 order by created_at,id', [id]).then(r => r.rows)

test('reviewed replacement completes the agreed $78 work and keeps the original $68.74 canceled history', async () => {
  const { agreement, visit } = await mismatchedExtra()
  const id = agreement.agreement_id
  const original = await savedVisit(agreement.booking_id)
  const priorItems = await visitItems(original.id)
  const actualItems = await visitItems(visit.id)
  const [next] = await entries(id, 123)
  await assert.rejects(projectedAction(id, next, 'complete', { date: day(123), expected_items: regularItems }),
    error => error.code === 'PT422' && JSON.parse(error.detail).earlierVisitId === visit.id)
  const options = await completionOptions(visit)
  assert.deepEqual(options.originalItems, firstItems)
  assert.deepEqual(options.visitItems, actualItems)
  assert.equal(options.originalAmount, 68.74)
  assert.equal(options.visitAmount, 78)
  assert.equal(options.restoredAmount, null)
  assert.ok(options.replaceToken && options.separateToken && options.replaceToken !== options.separateToken)
  await assert.rejects(reviewedComplete(visit, options.replaceToken, randomUUID(), null), /staff review/i)
  const operation = randomUUID()
  const result = await reviewedComplete(visit, options.replaceToken, operation)
  assert.equal(result.intro_resolution.disposition, 'replaced')
  assert.deepEqual(await reviewedComplete(visit, options.replaceToken, operation), { ...result, duplicate: true })
  await assert.rejects(reviewedComplete(visit, options.replaceToken, operation, randomUUID()), error => error.code === '23505')
  assert.deepEqual(await introOutcome(agreement.customer_id), { replaced_by_booking_id: visit.id, consumed_on: day(116) })
  const done = await savedVisit(visit.id)
  assert.equal(done.status, 'completed')
  assert.equal(done.job_total, '78.00')
  assert.deepEqual(done.accepted_quote_snapshot, visit.accepted_quote_snapshot)
  assert.deepEqual(await visitItems(visit.id), actualItems)
  const after = await savedVisit(original.id)
  assert.equal(after.status, 'canceled')
  assert.equal(after.job_total, '68.74')
  assert.deepEqual(after.accepted_quote_snapshot, original.accepted_quote_snapshot)
  assert.deepEqual(await visitItems(original.id), priorItems)
  const { request, result: receipt } = await sqlValue('select request,result from crm_operations where id=$1', [operation])
  assert.equal(request.staff_user_id, actor)
  assert.deepEqual(receipt.intro_resolution, { disposition: 'replaced', source_booking_id: original.id,
    prior_booking_id: original.id, completed_booking_id: visit.id, original_items: firstItems, original_amount: 68.74,
    visit_items: actualItems, visit_amount: 78, restored_amount: null })
  assert.equal((await entries(id, 123))[0].price, 93.80)
  await projectedAction(id, next, 'complete', { date: day(123), expected_items: regularItems })
  assert.equal((await entries(id, 123))[0].price, 93.80)
  assert.equal((await introOutcome(agreement.customer_id)).replaced_by_booking_id, visit.id)
})

test('reviewed separate work keeps the intro for later and protects existing payment facts', async () => {
  const { agreement, visit } = await mismatchedExtra()
  const original = await savedVisit(agreement.booking_id)
  await db.query("update bookings set payment_link='https://example.test/original' where id=$1", [original.id])
  await db.query('select record_job_payment($1,$2,$3,$4,$5,$6)', [visit.id, randomUUID(), 78, day(116), 'cash', 'manual'])
  const options = await completionOptions(visit)
  assert.equal(options.replaceToken, null)
  assert.match(options.replaceBlocked, /payment/i)
  assert.ok(options.separateToken)
  const done = await reviewedComplete(visit, options.separateToken)
  assert.equal(done.intro_resolution.disposition, 'separate_work')
  assert.deepEqual(await introOutcome(agreement.customer_id), { replaced_by_booking_id: null, consumed_on: null })
  assert.equal((await savedVisit(visit.id)).job_total, '78.00')
  assert.equal((await sqlValue('select amount from job_payments where booking_id=$1', [visit.id])).amount, '78.00')
  assert.equal((await savedVisit(original.id)).payment_link, 'https://example.test/original')
  assert.equal((await entries(agreement.agreement_id, 123))[0].price, 93.80)
})

test('replacement restores an open unprotected allocation without touching a paid extra', async () => {
  const agreement = await confirmedPromotion()
  const extra = await extraFor(agreement, day(2))
  const original = await savedVisit(agreement.booking_id)
  const visit = await savedVisit(extra.booking_id)
  await db.query('select record_job_payment($1,$2,$3,$4,$5,$6)', [visit.id, randomUUID(), 78, day(2), 'cash', 'manual'])
  await db.query("update bookings set payment_link='https://example.test/actual' where id=$1", [visit.id])
  const paidVisit = await savedVisit(visit.id)
  const options = await completionOptions(paidVisit, day(2))
  assert.equal(options.restoredAmount, 93.80)
  await reviewedComplete(paidVisit, options.replaceToken, randomUUID(), actor, day(2))
  assert.equal((await savedVisit(visit.id)).job_total, '78.00')
  assert.equal((await savedVisit(visit.id)).payment_link, 'https://example.test/actual')
  assert.equal((await sqlValue('select amount from job_payments where booking_id=$1', [visit.id])).amount, '78.00')
  const restored = await savedVisit(original.id)
  assert.equal(restored.job_total, '93.80')
  assert.deepEqual(restored.accepted_quote_snapshot, original.accepted_quote_snapshot)
  assert.deepEqual((await visitItems(original.id)).sort((a, b) => a.description.localeCompare(b.description)), [regularItems[1], regularItems[0]])
  await complete(restored, day(4))
})

test('a stale replacement cannot release a newly protected introductory amount', async () => {
  const { agreement, visit } = await mismatchedExtra()
  const options = await completionOptions(visit)
  await assert.rejects(reviewedComplete(visit, options.replaceToken, randomUUID(), actor, day(115)),
    error => error.code === 'PT422')
  const edited = [{ kind: 'service', description: 'Back lawn only', amount: '78.00' }]
  await sqlValue('select crm_replace_job_items($1,$2,$3,$4) value', [visit.id, visit.updated_at, randomUUID(), JSON.stringify(edited)])
  const current = await savedVisit(visit.id)
  await assert.rejects(reviewedComplete(current, options.replaceToken), error => error.code === 'PT422')
  const latest = await completionOptions(current)
  assert.deepEqual(latest.visitItems, edited)
  await db.query('select record_job_payment($1,$2,$3,$4,$5,$6)', [agreement.booking_id, randomUUID(), 68.74, day(4), 'cash', 'manual'])
  await assert.rejects(reviewedComplete(current, latest.replaceToken), error => {
    const refreshed = JSON.parse(error.detail).extraReview
    return error.code === 'PT422' && refreshed.replaceToken === null && /payment/i.test(refreshed.replaceBlocked)
  })
  assert.equal((await savedVisit(visit.id)).status, 'confirmed')
  assert.equal((await savedVisit(agreement.booking_id)).job_total, '68.74')
  assert.deepEqual(await introOutcome(agreement.customer_id), { replaced_by_booking_id: null, consumed_on: null })
})

test('an explicitly separate completed visit leaves the next eligible projected mow at the intro price', async () => {
  const { agreement, visit } = await mismatchedExtra()
  const items = [{ kind: 'service', description: 'Leaf cleanup', amount: '78.00' }]
  await sqlValue('select crm_replace_job_items($1,$2,$3,$4) value', [visit.id, visit.updated_at, randomUUID(), JSON.stringify(items)])
  const actual = await savedVisit(visit.id)
  const review = await completionOptions(actual)
  const result = await reviewedComplete(actual, review.separateToken)
  assert.deepEqual(result.intro_resolution.visit_items, items)
  assert.equal((await savedVisit(visit.id)).status, 'completed')
  const [next] = await entries(agreement.agreement_id, 123)
  assert.equal(next.price, 68.74)
  await projectedAction(agreement.agreement_id, next, 'complete', { date: day(123), expected_items: firstItems })
  assert.deepEqual(await introOutcome(agreement.customer_id), { replaced_by_booking_id: null, consumed_on: day(123) })
})

test('reviewed separate work immediately restores the intro to an already saved eligible mow', async () => {
  const { agreement, visit } = await mismatchedExtra()
  const id = agreement.agreement_id
  await sqlValue('select crm_reconcile_schedule($1,$2)', [id, day(120)])
  const [before] = await entries(id, 123)
  assert.ok(before.booking_id)
  assert.equal(before.price, 93.80)
  const review = await completionOptions(visit)
  await reviewedComplete(visit, review.separateToken)
  const [after] = await entries(id, 123)
  assert.equal(after.booking_id, before.booking_id)
  assert.equal(after.price, 68.74)
  assert.equal((await promo(agreement.customer_id)).allocated_booking_id, before.booking_id)
})

test('reviewed separate work completes while a later saved price remains protected', async () => {
  const { agreement, visit } = await mismatchedExtra()
  await sqlValue('select crm_reconcile_schedule($1,$2)', [agreement.agreement_id, day(120)])
  const [next] = await entries(agreement.agreement_id, 123)
  await db.query("update bookings set payment_link='https://example.test/next' where id=$1", [next.booking_id])
  const review = await completionOptions(visit)
  await reviewedComplete(visit, review.separateToken)
  assert.equal((await savedVisit(visit.id)).status, 'completed')
  const protectedNext = await savedVisit(next.booking_id)
  assert.equal(protectedNext.job_total, '93.80')
  assert.equal(protectedNext.payment_link, 'https://example.test/next')
  assert.deepEqual(await introOutcome(agreement.customer_id), { replaced_by_booking_id: null, consumed_on: null })
})

test('a pause-canceled first visit returns at its standard amount after an agreed replacement', async () => {
  const agreement = await confirmedPromotion()
  const id = agreement.agreement_id
  await scheduleEdit(id, { mode: 'pause', from: day(0) })
  const extra = await extraFor(agreement, day(2))
  const visit = await savedVisit(extra.booking_id)
  const options = await completionOptions(visit, day(2))
  await reviewedComplete(visit, options.replaceToken, randomUUID(), actor, day(2))
  const original = await savedVisit(agreement.booking_id)
  assert.equal(original.job_total, '68.74')
  const { preview } = await scheduleEdit(id, { mode: 'resume', from: day(0) })
  assert.equal(preview.changes.find(change => change.booking_id === original.id).price, 93.80)
  assert.equal((await savedVisit(original.id)).job_total, '93.80')
  assert.deepEqual((await savedVisit(original.id)).accepted_quote_snapshot, original.accepted_quote_snapshot)
})

test('a related extra with different items and an old shared payment link stay price-protected', async () => {
  const agreement = await confirmedPromotion()
  const id = agreement.agreement_id
  await winterResume(agreement)
  const extra = await extraFor(agreement, day(116))
  const visit = await savedVisit(extra.booking_id)
  await assert.rejects(complete(visit, day(116)), error => error.code === 'PT422'
    && /different work items/.test(error.message) && !JSON.parse(error.detail).token)
  assert.equal((await savedVisit(extra.booking_id)).job_total, '78.00')
  await jobChange(await savedVisit(extra.booking_id), 'cancel')
  await db.query("update bookings set payment_link='https://example.test/old-link' where id=$1", [agreement.booking_id])
  assert.equal((await entries(id, 123))[0].price, 93.80)
  await sqlValue('select crm_reconcile_schedule($1,$2)', [id, day(120)])
  assert.equal((await entries(id, 123))[0].price, 93.80)
  const source = await savedVisit(agreement.booking_id)
  assert.equal(source.job_total, '68.74')
  assert.equal(source.payment_link, 'https://example.test/old-link')
})
