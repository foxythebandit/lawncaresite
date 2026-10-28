import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardCard, groupBoard, sortColumn, type BoardCard } from '@/app/admin/leads/board-cards'
import { leadSource, readableAnswers } from '@/lib/lead-labels'
import { columnChip, summarizeLead } from '@/lib/lead-summary'
import { websitePrice } from '@/lib/website-intake'

const now = Date.parse('2026-10-28T20:00:00Z')
const card = (id: string, extra: Partial<BoardCard> = {}): BoardCard => ({
  id, href: `/admin/leads/${id}`, column: 'new', name: id, ago: '1h', headline: '', tone: 'neutral', meta: '', value: null,
  createdAt: '2026-10-28T10:00:00Z', checkBackOn: null, warm: false, ...extra,
})

test('New puts not-taken and website-price-didn\'t-book first, then newest', () => {
  const sorted = sortColumn('new', [
    card('old'), card('newest', { createdAt: '2026-10-28T19:00:00Z' }), card('warm-old', { warm: true, createdAt: '2026-10-20T10:00:00Z' }),
    card('warm-new', { warm: true, createdAt: '2026-10-27T10:00:00Z' }),
  ])
  assert.deepEqual(sorted.map(c => c.id), ['warm-new', 'warm-old', 'newest', 'old'])
})

test('Quoted puts the soonest check-back first, then cards without one by newest', () => {
  const sorted = sortColumn('quoted', [
    card('none-old'), card('later', { checkBackOn: '2026-12-01' }), card('due', { checkBackOn: '2026-10-20' }),
    card('none-new', { createdAt: '2026-10-28T18:00:00Z' }),
  ])
  assert.deepEqual(sorted.map(c => c.id), ['due', 'later', 'none-new', 'none-old'])
})

test('other columns are newest first', () => {
  assert.deepEqual(sortColumn('customer', [card('a'), card('b', { createdAt: '2026-10-28T11:00:00Z' })]).map(c => c.id), ['b', 'a'])
})

test('cards use summarizeLead for every word, and warm follows the website price', () => {
  const lead = { id: 'l1', name: 'Jane Smith', created_at: '2026-10-28T19:00:00Z', address: '1 Oak St, Round Rock, TX 78664',
    website_price_cents: 4500, website_first_visit_cents: 3200, website_frequency: 'biweekly', estimated_value: 120 }
  const c = boardCard(lead, [], now)
  const s = summarizeLead(lead, [], { now })
  assert.deepEqual([c.headline, c.meta, c.tone, c.ago, c.value, c.warm], [s.headline, s.meta, s.headlineTone, '1h', '$120', true])
  assert.equal(boardCard({ ...lead, website_price_cents: null }, [], now).warm, false)
  assert.equal(boardCard({ ...lead, website_price_cents: null, not_taken_at: '2026-10-28T19:05:00Z' }, [], now).warm, true)
  const groups = groupBoard([c, boardCard({ ...lead, id: 'l2', board_column: 'closed', closed_reason: 'price' }, [], now)])
  assert.deepEqual([groups.new.length, groups.closed.length], [1, 1])
})

test('columnChip matches the column chip summarizeLead makes', () => {
  for (const column of ['new', 'in_talks', 'quoted', 'booking_request', 'customer', 'closed'] as const) {
    const chip = summarizeLead({ id: 'x', created_at: '2026-10-28T19:00:00Z', board_column: column }).chips[0]
    assert.deepEqual(columnChip(column), chip)
  }
})

test('websitePrice validates what the customer saw', () => {
  assert.deepEqual(websitePrice({ price_per_visit: 45, first_visit_price: 32, frequency: 'biweekly' }),
    { website_price_cents: 4500, website_first_visit_cents: 3200, website_frequency: 'biweekly' })
  assert.equal(websitePrice({ price_per_visit: 0, first_visit_price: 0, frequency: 'weekly' }), null)
  assert.equal(websitePrice({ price_per_visit: 45, first_visit_price: 32, frequency: 'daily' }), null)
  assert.equal(websitePrice({ price_per_visit: Number.NaN, first_visit_price: 32, frequency: 'weekly' }), null)
})

test('ConviFlo answers read as plain words (A2)', () => {
  assert.deepEqual(readableAnswers({ choice_3: 'mowing_edging', urgency: 'next_1_2_weeks', yard_size: '1_4_1_2_acre',
    cleanup_service: 'both_leaves_and_gutters_save_30', choice_2: 'loud_equipment_and_gas_fumes', mystery: 'some_new_value' }), [
    { label: 'Needs', value: 'Mowing + edging' }, { label: 'How soon', value: 'Next 1–2 weeks' }, { label: 'Property size', value: '1/4–1/2 acre' },
    { label: 'Cleanup', value: 'Leaves + gutters' }, { label: 'Pain point', value: 'Loud equipment, gas fumes' }, { label: 'Mystery', value: 'Some new value' },
  ])
})

test('Meta ads read by name (A1)', () => {
  assert.deepEqual(leadSource({ attribution: { first_touch: { utm_source: 'meta', meta_ad_id: '120253769297470725' } } }),
    { channel: 'Facebook ad', detail: 'Leaf Cleanup · video', conviflo: false })
})
