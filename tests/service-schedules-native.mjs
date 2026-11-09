import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { getPortalBookings } from '../app/portal/bookings.ts'

// Use this checkout's local stack, never the app's environment or a linked project.
const status = execFileSync('supabase', ['status', '--env', '--output-format', 'text'], { encoding: 'utf8' })
const config = Object.fromEntries(Array.from(status.matchAll(/^([A-Z_]+)='?(.*?)'?$/gm), match => [match[1], match[2]]))
const url = new URL(config.API_URL)
assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname), 'local API required')
assert.ok(config.SECRET_KEY && config.PUBLISHABLE_KEY, 'local test keys required')
const client = key => createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false } })
const admin = client(config.SECRET_KEY)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const day = offset => {
  const date = new Date(`${today}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
async function data(request) {
  const result = await request
  if (result.error) throw new Error(result.error.message)
  return result.data
}

test('two native reconciliation requests create one visit per cadence slot', async () => {
  const customerId = randomUUID()
  const propertyId = randomUUID()
  const firstId = randomUUID()
  const operationId = randomUUID()
  const items = [{ kind: 'service', description: 'Lawn care', amount: '85.50' }]
  const visit = { id: firstId, name: 'Schedule race test', phone: '5125550119', address: '1 Test Lane',
    customer_id: customerId, property_id: propertyId, status: 'confirmed', confirmed_date: today }
  try {
    await data(admin.from('customers').insert({ id: customerId, name: visit.name, phone: visit.phone }))
    await data(admin.from('properties').insert({ id: propertyId, customer_id: customerId, address: visit.address }))
    const first = await data(admin.from('bookings').insert(visit).select('updated_at').single())
    const started = await data(admin.rpc('crm_start_agreement', {
      p_booking_id: firstId, p_expected_updated_at: first.updated_at, p_operation_id: operationId,
      p_config: { anchor_on: today, next_on: day(7), interval_unit: 'week', interval_count: 1, items_template: items },
    }))
    const args = { p_agreement_id: started.agreement_id, p_today: day(100) }
    // Separate HTTP requests use independent database transactions.
    const results = await Promise.allSettled([admin, client(config.SECRET_KEY)].map(worker =>
      data(worker.rpc('crm_reconcile_schedule', args))))
    assert.deepEqual(results, [
      { status: 'fulfilled', value: day(190) },
      { status: 'fulfilled', value: day(190) },
    ])
    const saved = await data(admin.from('bookings').select('id, occurrence_on, job_total')
      .eq('agreement_id', started.agreement_id).order('occurrence_on'))
    assert.deepEqual(saved.map(row => row.occurrence_on), Array.from({ length: 28 }, (_, i) => day(i * 7)))
    assert.ok(saved.slice(1).every(row => row.job_total === 85.5))
    const savedIds = saved.slice(1).map(row => row.id)
    const lines = await data(admin.from('job_items').select('booking_id, amount').in('booking_id', savedIds))
    assert.deepEqual(lines.map(row => row.booking_id).sort(), savedIds.sort())
    assert.ok(lines.every(row => row.amount === 85.5))

    const agreement = await data(admin.from('recurring_agreements').select('updated_at')
      .eq('id', started.agreement_id).single())
    await data(admin.rpc('crm_agreement_command', {
      p_agreement_id: started.agreement_id, p_expected_updated_at: agreement.updated_at,
      p_operation_id: randomUUID(), p_action: 'price_template',
      p_payload: { items_template: [{ ...items[0], amount: '91.27' }] },
    }))
    const repriced = await data(admin.from('bookings').select('job_total, schedule_state').eq('id', saved[1].id).single())
    assert.deepEqual(repriced, { job_total: 91.27, schedule_state: 'generated' })
  } finally {
    // Test-only teardown needs database-owner privileges because the app cannot delete revisions.
    execFileSync('supabase', ['db', 'query', '--local', `do $$
    begin
      update public.recurring_agreements set schedule_source_booking_id = null where customer_id = '${customerId}';
      delete from public.crm_operations where id = '${operationId}'
        or target_id in (select id from public.bookings where customer_id = '${customerId}')
        or target_id in (select id from public.recurring_agreements where customer_id = '${customerId}');
      delete from public.job_items where booking_id in (select id from public.bookings where customer_id = '${customerId}');
      delete from public.bookings where customer_id = '${customerId}';
      delete from public.agreement_schedule_revisions where agreement_id in (
        select id from public.recurring_agreements where customer_id = '${customerId}');
      delete from public.recurring_agreements where customer_id = '${customerId}';
      delete from public.properties where id = '${propertyId}';
      delete from public.customers where id = '${customerId}';
    end $$;`], { stdio: 'pipe' })
  }
})

test('portal reads keep owned overdue, upcoming, pending and completed visits in scope', async () => {
  const owned = 'customer@example.test'
  const unrelated = 'outsider@example.test'
  const fixture = (email, status, actual, preferred) => ({
    id: randomUUID(), name: 'Portal schedule test', phone: '5125550119', address: '2 Test Lane',
    email, status, confirmed_date: actual, preferred_date: preferred,
  })
  const overdue = fixture(owned, 'confirmed', day(-2), day(8))
  const upcoming = fixture(owned, 'confirmed', today, day(-8))
  const later = fixture(owned, 'confirmed', day(2), today)
  const pending = fixture(owned, 'pending', null, today)
  const completed = fixture(owned, 'completed', day(-1), day(-1))
  const outsider = fixture(unrelated, 'confirmed', null, day(-1))
  const visits = [overdue, upcoming, later, pending, completed, outsider]
  async function signIn(email) {
    const customer = client(config.PUBLISHABLE_KEY)
    await data(customer.auth.signInWithPassword({ email, password: 'password123' }))
    return customer
  }
  try {
    await data(admin.from('bookings').insert(visits))
    const [customer, other] = await Promise.all([signIn(owned), signIn(unrelated)])
    const ownResult = await getPortalBookings(customer, today)
    assert.equal(ownResult.upcoming.id, upcoming.id)
    assert.equal(ownResult.overdue.id, overdue.id)
    assert.deepEqual(ownResult.bookings.map(row => row.id).sort(), [pending.id, completed.id].sort())
    const otherResult = await getPortalBookings(other, today)
    assert.equal(otherResult.upcoming, null)
    assert.equal(otherResult.overdue.id, outsider.id)
    assert.deepEqual(otherResult.bookings, [])
  } finally {
    await data(admin.from('bookings').delete().in('id', visits.map(visit => visit.id)))
  }
})
