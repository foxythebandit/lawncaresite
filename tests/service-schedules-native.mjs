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

test('native reviewed edits race on one agreement version and replay the winning staff receipt', async () => {
  await withNativeSchedule(async (agreementId, items) => {
    const { updated_at } = await data(admin.from('recurring_agreements').select('updated_at').eq('id', agreementId).single())
    const actor = randomUUID()
    const operationIds = [randomUUID(), randomUUID()]
    const amounts = ['91.37', '103.26']
    const workers = [admin, client(config.SECRET_KEY)]
    const previews = await Promise.all(amounts.map(amount => {
      const request = { mode: 'future', from: day(7), definition: { version: 1, base: { frequency: 'weekly', anchor_on: today } },
        items_template: [{ ...items[0], amount }] }
      const args = { p_agreement_id: agreementId, p_expected_updated_at: updated_at, p_staff_user_id: actor, p_request: request }
      return data(admin.rpc('crm_service_edit', args)).then(result => ({ args, result }))
    }))
    const commands = previews.map(({ args, result }, i) => ({ ...args, p_operation_id: operationIds[i], p_preview: result.preview }))
    const attempts = await Promise.all(commands.map((command, i) => workers[i].rpc('crm_service_edit', command)))
    const winner = attempts.findIndex(attempt => !attempt.error)
    assert.ok(winner >= 0)
    assert.equal(attempts[1 - winner].error?.code, 'PT409')
    const [replayed] = await Promise.all([
      data(admin.rpc('crm_service_edit', commands[winner])),
      data(workers[1].rpc('crm_reconcile_schedule', { p_agreement_id: agreementId, p_today: day(15) })),
    ])
    assert.deepEqual(replayed, { ...attempts[winner].data, duplicate: true })
    const revisions = await data(admin.from('agreement_schedule_revisions').select('staff_user_id,operation_id')
      .eq('agreement_id', agreementId).is('ends_before', null))
    assert.deepEqual(revisions, [{ staff_user_id: actor, operation_id: operationIds[winner] }])
    const prices = await data(admin.from('bookings').select('job_total').eq('agreement_id', agreementId).gte('occurrence_on', day(7)))
    assert.ok(prices.length > 10)
    assert.ok(prices.every(visit => visit.job_total === Number(amounts[winner])))
  })
})

test('native acceptance, confirmation and completion races share one booking and consume one intro', async () => {
  const leadId = randomUUID(), offerId = randomUUID()
  const address = '6 Native Quote Lane, Austin, TX'
  const draft = { address, sections: [], freq: 'weekly', calculatedPrice: 90 }
  const regularItems = [{ kind: 'service', description: 'Lawn care', amount: '90.00' }]
  const firstItems = [...regularItems, { kind: 'discount', description: 'Introductory mowing discount', amount: '-27.00' }]
  try {
    const lead = await data(admin.from('leads').insert({ id: leadId, name: 'Native Quote', phone: '5125550199',
      address, quote_draft: draft, attribution: { utm_source: 'native-quote' } }).select('updated_at').single())
    await data(admin.rpc('crm_prepare_sent_offer', {
      p_lead_id: leadId, p_version: lead.updated_at, p_offer_id: offerId, p_replaces: null,
      p_terms: { draft, address, rows: [{ freq: 'weekly', regularItems, firstItems }], mowing: true, mode: 'choices' },
      p_message: { to: 'native@example.test', subject: 'Synthetic quote' }, p_recipient: 'native@example.test',
    }))
    await data(admin.rpc('crm_finish_sent_offer', { p_lead_id: leadId, p_offer_id: offerId, p_state: 'sent',
      p_provider_id: randomUUID(), p_actor_email: 'staff@example.test' }))
    const args = { p_lead_id: leadId, p_offer_id: offerId, p_hash: 'same-request',
      p_request: { date: day(4), frequency: 'weekly', arrival: 'Any time' }, p_recipients: ['+15125550101', '+15125550102'] }
    const responses = await Promise.all([admin, client(config.SECRET_KEY)].map(worker => data(worker.rpc('crm_accept_sent_offer', args))))
    assert.deepEqual(responses.map(result => result.duplicate).sort(), [false, true])
    assert.equal(responses[0].booking_id, responses[1].booking_id)
    assert.equal(responses[0].event_id, responses[1].event_id)
    assert.deepEqual(await data(admin.from('bookings').select('status,confirmed_date,preferred_date,job_total,attribution')
      .eq('lead_id', leadId)), [{ status: 'pending', confirmed_date: null, preferred_date: day(4),
      job_total: 63, attribution: { utm_source: 'native-quote' } }])
    assert.equal((await data(admin.from('staff_alerts').select('id').eq('event_id', responses[0].event_id))).length, 4)
    const bookingId = responses[0].booking_id
    const [visit, reviewLead] = await Promise.all([
      data(admin.from('bookings').select('updated_at').eq('id', bookingId).single()),
      data(admin.from('leads').select('updated_at').eq('id', leadId).single()),
    ])
    const workers = [admin, client(config.SECRET_KEY)]
    const requests = workers.map(() => ({
      p_booking_id: bookingId, p_expected_updated_at: visit.updated_at, p_lead_version: reviewLead.updated_at,
      p_operation_id: randomUUID(), p_request: { date: day(4), arrival: 'Morning', name: 'Native Quote',
        address, staff_user_id: randomUUID() },
    }))
    const confirmations = await Promise.all(workers.map((worker, i) => worker.rpc('crm_confirm_first_visit', requests[i])))
    const winner = confirmations.findIndex(result => !result.error)
    assert.ok(winner >= 0)
    assert.equal(confirmations[1 - winner].error.code, 'PT409')
    const confirmed = confirmations[winner].data
    assert.equal(confirmed.booking_id, bookingId)
    assert.ok(confirmed.customer_id && confirmed.property_id && confirmed.agreement_id)
    assert.deepEqual(await data(admin.rpc('crm_confirm_first_visit', requests[winner])), { ...confirmed, duplicate: true })
    assert.equal((await data(admin.from('customers').select('id').eq('name', 'Native Quote'))).length, 1)
    assert.equal((await data(admin.from('properties').select('id').eq('address', address))).length, 1)
    const first = await data(admin.from('bookings').select('updated_at,job_total').eq('id', bookingId).single())
    assert.equal(first.job_total, 63)
    const completions = await Promise.all(workers.map(worker => worker.rpc('complete_job', {
      p_booking_id: bookingId, p_expected_updated_at: first.updated_at, p_operation_id: randomUUID(), p_completed_on: day(4),
    })))
    assert.equal(completions.filter(result => !result.error).length, 1)
    assert.equal(completions.find(result => result.error).error.code, 'PT409')
    assert.deepEqual(await data(admin.from('crm_intro_grants').select('allocated_booking_id,consumed_on').eq('customer_id', confirmed.customer_id).single()),
      { allocated_booking_id: bookingId, consumed_on: day(4) })
    const future = await data(admin.from('bookings').select('job_total').eq('agreement_id', confirmed.agreement_id).neq('id', bookingId))
    assert.ok(future.length && future.every(visit => visit.job_total === 90))
    assert.equal((await data(admin.from('staff_alerts').select('id').eq('event_id', responses[0].event_id))).length, 4)
  } finally {
    execFileSync('supabase', ['db', 'query', '--local', `do $fixture$ declare v_customer uuid; begin
      select customer_id into v_customer from public.leads where id = '${leadId}';
      update public.recurring_agreements set schedule_source_booking_id = null where customer_id = v_customer;
      delete from public.crm_intro_grants where customer_id = v_customer;
      delete from public.crm_operations where target_id in (select id from public.bookings where lead_id = '${leadId}');
      delete from public.staff_alerts where event_id in (select id from public.intake_events where lead_id = '${leadId}');
      delete from public.intake_events where lead_id = '${leadId}';
      delete from public.sent_offers where lead_id = '${leadId}';
      delete from public.lead_activities where lead_id = '${leadId}';
      delete from public.job_items where booking_id in (select id from public.bookings where lead_id = '${leadId}');
      delete from public.bookings where lead_id = '${leadId}';
      delete from public.leads where id = '${leadId}';
      delete from public.agreement_schedule_revisions where agreement_id in (select id from public.recurring_agreements where customer_id = v_customer);
      delete from public.recurring_agreements where customer_id = v_customer;
      delete from public.properties where customer_id = v_customer;
      delete from public.customers where id = v_customer;
    end $fixture$;`], { stdio: 'pipe' })
  }
})
