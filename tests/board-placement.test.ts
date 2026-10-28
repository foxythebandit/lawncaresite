import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeLead } from '@/lib/board-placement'

const lead = (extra: Record<string, unknown> = {}) => ({ id: 'l1', stage: 'new', quote_status: 'draft', contact_outcome: null, source: 'website-map', answers: {}, ...extra })

test('confirmed or completed visit puts the lead in Customer', () => {
  assert.equal(placeLead(lead({ stage: 'booked' }), [{ status: 'confirmed' }]).column, 'customer')
  assert.equal(placeLead(lead(), [{ status: 'completed', agreement_id: 'a', occurrence_on: '2026-10-01' }]).column, 'customer')
})

test('lost after booking stays in Customer with a canceled flag', () => {
  const placed = placeLead(lead({ stage: 'lost', quote_status: 'canceled' }), [{ status: 'completed' }, { status: 'canceled' }])
  assert.deepEqual([placed.column, placed.canceled], ['customer', true])
  assert.equal(placeLead(lead({ stage: 'lost' }), [{ status: 'completed' }, { status: 'confirmed' }]).canceled, undefined)
})

test('pending request is a Booking request; generated plan visits are not', () => {
  assert.equal(placeLead(lead(), [{ status: 'pending' }]).column, 'booking_request')
  assert.equal(placeLead(lead(), [{ status: 'pending', agreement_id: 'a', occurrence_on: '2026-11-01' }]).column, 'new')
})

test('closed reasons', () => {
  assert.deepEqual(pick(placeLead(lead({ stage: 'quoted', quote_status: 'declined' }))), ['closed', 'price'])
  assert.deepEqual(pick(placeLead(lead({ stage: 'lost' }))), ['closed', 'never_responded'])
  assert.deepEqual(pick(placeLead(lead({ stage: 'lost', contact_outcome: 'no_answer' }))), ['closed', 'never_responded'])
  assert.deepEqual(pick(placeLead(lead({ stage: 'lost', contact_outcome: 'reached' }))), ['closed', 'other'])
  assert.deepEqual(pick(placeLead(lead({ stage: 'contacted', contact_outcome: 'wrong_number' }))), ['closed', 'bad_number'])
  assert.deepEqual(pick(placeLead(lead({ source: 'website-waitlist' }))), ['closed', 'outside_area'])
  assert.deepEqual(pick(placeLead(lead({ answers: { waitlist: true } }))), ['closed', 'outside_area'])
})

test('quoted from stage, saved quote or emailed quote', () => {
  assert.equal(placeLead(lead({ stage: 'quoted' })).column, 'quoted')
  assert.equal(placeLead(lead({ quote_confirmed_at: '2026-10-20T10:00:00Z' })).column, 'quoted')
  assert.equal(placeLead(lead(), [], [{ kind: 'quote', outcome: 'emailed' }]).column, 'quoted')
  assert.equal(placeLead(lead(), [], [{ kind: 'quote', outcome: 'draft_saved' }]).column, 'new')
})

test('no answer or contacted is In talks with attempts counted from call activities', () => {
  const placed = placeLead(lead({ contact_outcome: 'no_answer' }), [], [{ kind: 'call', outcome: 'no_answer' }, { kind: 'call', outcome: 'no_answer' }, { kind: 'call', outcome: 'reached' }])
  assert.deepEqual([placed.column, placed.call_attempts], ['in_talks', 2])
  assert.equal(placeLead(lead({ stage: 'contacted', contact_outcome: 'reached' })).column, 'in_talks')
})

test('everything else is New', () => {
  assert.equal(placeLead(lead()).column, 'new')
  assert.equal(placeLead(lead(), [{ status: 'canceled' }]).column, 'new')
})

function pick(p: { column: string; closed_reason?: string }) { return [p.column, p.closed_reason] }
