import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { getPortalBookings } from '../app/portal/bookings.ts'
import { saveVisitPaymentLink } from '../lib/visit-payment-link.ts'

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

async function withNativeSchedule(run) {
  const customerId = randomUUID()
  const propertyId = randomUUID()
  const firstId = randomUUID()
  const operationId = randomUUID()
  const items = [{ kind: 'service', description: 'Lawn care', amount: '85.50' }]
  const visit = { id: firstId, name: 'Native schedule test', phone: '5125550119', address: '1 Test Lane',
    customer_id: customerId, property_id: propertyId, status: 'confirmed', confirmed_date: today }
  try {
    await data(admin.from('customers').insert({ id: customerId, name: visit.name, phone: visit.phone }))
    await data(admin.from('properties').insert({ id: propertyId, customer_id: customerId, address: visit.address }))
    const first = await data(admin.from('bookings').insert(visit).select('updated_at').single())
    const started = await data(admin.rpc('crm_start_agreement', {
      p_booking_id: firstId, p_expected_updated_at: first.updated_at, p_operation_id: operationId,
      p_config: { anchor_on: today, next_on: day(7), interval_unit: 'week', interval_count: 1, items_template: items },
    }))
    await run(started.agreement_id, items)
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
}

test('two native reconciliation requests create one visit per cadence slot', async () => {
  await withNativeSchedule(async (agreementId, items) => {
    const args = { p_agreement_id: agreementId, p_today: day(100) }
    // Separate HTTP requests use independent database transactions.
    const results = await Promise.allSettled([admin, client(config.SECRET_KEY)].map(worker =>
      data(worker.rpc('crm_reconcile_schedule', args))))
    assert.deepEqual(results, [
      { status: 'fulfilled', value: day(190) },
      { status: 'fulfilled', value: day(190) },
    ])
    const saved = await data(admin.from('bookings').select('id, occurrence_on, job_total')
      .eq('agreement_id', agreementId).order('occurrence_on'))
    assert.deepEqual(saved.map(row => row.occurrence_on), Array.from({ length: 28 }, (_, i) => day(i * 7)))
    assert.ok(saved.slice(1).every(row => row.job_total === 85.5))
    const savedIds = saved.slice(1).map(row => row.id)
    const lines = await data(admin.from('job_items').select('booking_id, amount').in('booking_id', savedIds))
    assert.deepEqual(lines.map(row => row.booking_id).sort(), savedIds.sort())
    assert.ok(lines.every(row => row.amount === 85.5))

    const agreement = await data(admin.from('recurring_agreements').select('updated_at')
      .eq('id', agreementId).single())
    await data(admin.rpc('crm_agreement_command', {
      p_agreement_id: agreementId, p_expected_updated_at: agreement.updated_at,
      p_operation_id: randomUUID(), p_action: 'price_template',
      p_payload: { items_template: [{ ...items[0], amount: '91.27' }] },
    }))
    const repriced = await data(admin.from('bookings').select('job_total, schedule_state').eq('id', saved[1].id).single())
    assert.deepEqual(repriced, { job_total: 91.27, schedule_state: 'generated' })
  })
})

test('native worker flags a date conflict without advancing its cursor or stopping other plans', async () => {
  await withNativeSchedule(async affectedId => {
    await withNativeSchedule(async healthyId => {
      const target = day(98)
      const entriesOn = () => data(admin.rpc('crm_calendar_entries', { p_from: target, p_through: target }))
      const { revision_id: revisionId } = (await entriesOn()).find(row => row.agreement_id === affectedId)
      const moved = await data(admin.from('bookings').select('id, job_total').eq('agreement_id', affectedId)
        .eq('occurrence_on', day(14)).single())
      const attention = () => data(admin.rpc('crm_calendar_attention', { p_today: today }))
      const priorAttention = await attention()
      // Simulate an existing collision from before the move command enforced this guard.
      await data(admin.from('bookings').update({ confirmed_date: target, preferred_date: target }).eq('id', moved.id))
      const assertSavedOnly = async () => {
        const entries = (await entriesOn()).filter(row => row.agreement_id === affectedId)
        assert.deepEqual(entries.map(row => row.booking_id), [moved.id])
        assert.equal(entries[0].cadence_on, day(14))
        assert.equal(entries[0].job_total, moved.job_total)
      }
      await assertSavedOnly()
      assert.equal((await attention()).schedule_review, priorAttention.schedule_review + 1)
      const conflict = await admin.rpc('crm_materialize_schedule_visit', {
        p_agreement_id: affectedId, p_revision_id: revisionId, p_on: target,
      })
      assert.equal(conflict.error?.code, 'PT409')
      assert.match(conflict.error.message, /already has a visit on that date/)

      // Roll back the global worker so standalone test:db never advances other local plans.
      execFileSync('supabase', ['db', 'query', '--local', `do $test$
      declare
        affected public.recurring_agreements;
        healthy public.recurring_agreements;
      begin
        begin
          perform public.crm_reconcile_schedules('${day(20)}');
          perform public.crm_reconcile_schedules('${day(20)}');
          select * into affected from public.recurring_agreements where id = '${affectedId}';
          select * into healthy from public.recurring_agreements where id = '${healthyId}';
          if affected.generated_through is distinct from '${day(90)}'::date
            or coalesce(position('${target}' in affected.schedule_review_reason),0) = 0 then
            raise exception 'Affected plan must retain its cursor and record the conflicting date';
          end if;
          if healthy.generated_through is distinct from '${day(110)}'::date or healthy.schedule_review_reason is not null
            or not exists(select 1 from public.bookings where agreement_id = healthy.id
              and occurrence_on = '${target}' and status = 'confirmed') then
            raise exception 'Healthy plan must still generate its regular visit';
          end if;
          if (select array_agg(booking_id) from public.crm_calendar_entries('${target}','${target}')
            where agreement_id = affected.id) is distinct from array['${moved.id}'::uuid] then
            raise exception 'Calendar must keep only the saved moved visit';
          end if;
          raise sqlstate 'QG001';
        exception when sqlstate 'QG001' then null;
        end;
      end $test$;`], { stdio: 'pipe' })
      await assertSavedOnly()
    })
  })
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


test('prepared visit payment link retries keep one canonical visit and provider link', async () => {
  await withNativeSchedule(async agreementId => {
    const on = day(98)
    const { revision_id: revisionId } = (await data(admin.rpc('crm_calendar_entries', { p_from: on, p_through: on })))
      .find(row => row.agreement_id === agreementId && !row.booking_id)
    const operationId = randomUUID()
    const args = { p_agreement_id: agreementId, p_revision_id: revisionId, p_on: on,
      p_operation_id: operationId, p_action: 'payment_link', p_payload: {} }
    const result = await data(admin.rpc('crm_calendar_edit_occurrence', args))
    const id = result.booking_id
    const prepared = { operationId, updatedAt: result.updated_at, preparedAt: result.prepared_at }
    const calls = []
    const providerLinks = new Map()
    const url = 'https://example.test/payment-link'
    const stripe = {
      prices: { create: async (params, options) => {
        calls.push(options.idempotencyKey)
        assert.equal(params.unit_amount, 8550)
        return { id: 'price_test' }
      } },
      paymentLinks: { create: async (params, options) => {
        calls.push(options.idempotencyKey)
        assert.equal(params.metadata.booking_id, id)
        if (providerLinks.has(options.idempotencyKey)) return providerLinks.get(options.idempotencyKey)
        providerLinks.set(options.idempotencyKey, { url })
        throw new Error('Synthetic timeout after provider accepted the request')
      } },
    }

    assert.deepEqual(await saveVisitPaymentLink(admin, stripe, id, prepared), { error: 'Synthetic timeout after provider accepted the request' })
    assert.deepEqual(await data(admin.rpc('crm_calendar_edit_occurrence', args)), { ...result, duplicate: true })
    assert.deepEqual(await saveVisitPaymentLink(admin, stripe, id, prepared), { url })
    assert.deepEqual(await saveVisitPaymentLink(admin, stripe, id, prepared), { url })
    assert.deepEqual(calls, [`visit-price/${operationId}`, `visit-link/${operationId}`,
      `visit-price/${operationId}`, `visit-link/${operationId}`])
    assert.equal(providerLinks.size, 1)
    assert.deepEqual(await data(admin.from('bookings').select('id,payment_link').eq('agreement_id', agreementId)
      .eq('occurrence_on', on)), [{ id, payment_link: url }])
  })
})

test('prepared visit payment link rejects expired and stale work before exposing a link', async () => {
  await withNativeSchedule(async agreementId => {
    const on = day(98)
    const { revision_id: revisionId } = (await data(admin.rpc('crm_calendar_entries', { p_from: on, p_through: on })))
      .find(row => row.agreement_id === agreementId && !row.booking_id)
    const operationId = randomUUID()
    const result = await data(admin.rpc('crm_calendar_edit_occurrence', {
      p_agreement_id: agreementId, p_revision_id: revisionId, p_on: on, p_operation_id: operationId,
      p_action: 'payment_link', p_payload: {},
    }))
    const id = result.booking_id
    const prepared = { operationId, updatedAt: result.updated_at, preparedAt: result.prepared_at }
    const calls = []
    const stripe = {
      prices: { create: async params => { calls.push(params.unit_amount); return { id: 'price_test' } } },
      paymentLinks: { create: async () => {
        await data(admin.rpc('crm_replace_job_items', {
          p_booking_id: id, p_expected_updated_at: prepared.updatedAt, p_operation_id: randomUUID(),
          p_items: [{ kind: 'service', description: 'Lawn care', amount: '96.25' }],
        }))
        return { url: 'https://example.test/stale-payment-link' }
      } },
    }

    const expired = { ...prepared, preparedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
    assert.match((await saveVisitPaymentLink(admin, stripe, id, expired)).error, /review its price/)
    assert.deepEqual(calls, [])
    assert.match((await saveVisitPaymentLink(admin, stripe, id, prepared)).error, /changed while creating the link/)
    assert.match((await saveVisitPaymentLink(admin, stripe, id, prepared)).error, /review its price/)
    assert.deepEqual(calls, [8550])
    assert.deepEqual(await data(admin.from('bookings').select('job_total,payment_link').eq('id', id).single()),
      { job_total: 96.25, payment_link: null })
  })
})
