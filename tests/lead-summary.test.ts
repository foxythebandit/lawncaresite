import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alertText, historyItem, priceShort, spokenPrompt, staffText, summarizeLead, type SummaryLead } from '../lib/lead-summary'

const base = 'https://quietgreen.co'
const jane: SummaryLead = {
  id: '00000000-0000-4000-8000-000000000001', name: 'Jane Smith', phone: '+15125550142', created_at: '2026-10-28T19:14:00Z',
  address: '1234 Oak St, Round Rock, TX 78664', source: 'website-map', services: ['Mowing', 'Edging'], short_code: 'AB12CD',
  website_price_cents: 4500, website_first_visit_cents: 3200, website_frequency: 'biweekly', website_price_at: '2026-10-28T19:14:00Z',
  lawn_tracing: [{ name: 'Lawn', sqFt: 6200, coords: [[0, 0], [1, 0], [1, 1]] }],
  attribution: { first_touch: { utm_source: 'meta', meta_ad_id: '120253769117370725' } },
}

test('new website lead alert matches the approved wording (PLAN.md 7.6)', () => {
  assert.equal(alertText(jane, [], base, 'new'), [
    'NEW LEAD · Jane Smith',
    'Not booked · saw $45/visit, 1st $32',
    'Mowing, Edging · every 2 wks',
    '6,200 sq ft traced',
    '1234 Oak St, Round Rock',
    '(512) 555-0142',
    'Facebook ad · Dave video',
    'quietgreen.co/l/AB12CD',
  ].join('\n'))
})

test('booking request alert leads with the wanted day and the first-visit discount', () => {
  const text = alertText({ ...jane, website_price_cents: null }, [{
    status: 'pending', created_at: '2026-10-28T19:20:00Z', preferred_date: '2026-11-03', preferred_time: 'Morning',
    frequency: 'Bi-weekly', price_per_visit: 45, first_visit_price: 32, customer_notes: 'Gate code 4411, dog in yard',
    addon_interest: { 'Hedge trimming': true },
  }], base, 'booking')
  assert.equal(text, [
    'BOOKING REQUEST · Jane Smith',
    'Wants Tue Nov 3 · morning · every 2 wks',
    '$45/visit · 1st $32 (−30%)',
    'Add-ons: hedge trimming',
    '"Gate code 4411, dog in yard"',
    '1234 Oak St, Round Rock · 6,200 sq ft',
    '(512) 555-0142',
    'quietgreen.co/l/AB12CD',
  ].join('\n'))
})

test('no-price ConviFlo lead lists what they want and their top answers', () => {
  const text = alertText({ id: 'x', name: 'Luis Ramos', phone: '5125550199', created_at: '2026-10-28T19:00:00Z', source: 'conviflo',
    services: ['Hedge trimming'], answers: { budget: 'high', decision_maker: 'yes', conviflo_form_id: 'f', address_missing: true }, short_code: 'ZZ99ZZ' }, [], base, 'new')
  assert.match(text, /^NEW LEAD · Luis Ramos\nNo price · wants hedge trimming\nHedge trimming\nBudget: high\nDecision maker: Yes\n/)
  assert.doesNotMatch(text, /conviflo_form_id|address_missing/)
  assert.ok(text.endsWith('quietgreen.co/l/ZZ99ZZ'))
})

test('alert stays within 320 characters and keeps the link', () => {
  const long = alertText({ ...jane, name: 'A'.repeat(140), answers: { notes: 'x'.repeat(500) }, address: `${'9'.repeat(200)} Long St, Austin` }, [], base, 'new')
  assert.ok(long.length <= 320 + 160, String(long.length))
  assert.ok(long.endsWith('quietgreen.co/l/AB12CD'))
})

test('TEST leads are tagged in text and voice (E20)', () => {
  assert.match(alertText({ ...jane, name: 'TEST Jane' }, [], base, 'new'), /^\[TEST\] NEW LEAD/)
  assert.match(spokenPrompt({ ...jane, name: 'TEST Jane' }, [], 'new'), /^Test\. /)
})

test('spoken prompts use first name and last initial', () => {
  assert.equal(spokenPrompt(jane, [], 'new'), 'New lead. Jane S., Round Rock, mowing. Press 1 to call them now. Press 2 to pass.')
  assert.equal(spokenPrompt(jane, [{ status: 'pending', preferred_date: '2026-11-03', preferred_time: 'Morning', created_at: '2026-10-28T19:20:00Z' }], 'booking'),
    'Booking request. Jane S. wants Tuesday morning, mowing. Press 1 to call them now. Press 2 to pass.')
})

test('staff texts (PLAN.md 7.3)', () => {
  assert.equal(staffText.claimed(jane, 'Caelan'), 'Caelan took Jane Smith (512) 555-0142')
  assert.equal(staffText.notTaken(jane), 'Nobody took Jane Smith · call now: (512) 555-0142')
  assert.equal(staffText.reminder(jane, base), 'Log your call with Jane Smith: quietgreen.co/l/AB12CD')
  assert.equal(staffText.outcome(jane, 'booked', { first_visit_on: '2026-11-03', price_cents: 4500, frequency: 'biweekly' }), 'Jane Smith: 🟢 Booked Tue Nov 3 · $45/visit')
  assert.equal(staffText.outcome(jane, 'not_now', { reason: 'budget', price_cents: 4500, frequency: 'biweekly', check_back_on: '2026-12-01' }),
    'Jane Smith: 🟡 Not now · Budget · $45/visit · check back Dec 1')
})

test('card, page and text read the same price', () => {
  const s = summarizeLead(jane, [], { baseUrl: base })
  assert.equal(s.headline, '$45/visit · 1st $32 · website · didn\'t book')
  assert.equal(priceShort(s.price), '$45/visit · 1st $32')
  assert.deepEqual(s.chips.slice(0, 3).map(c => c.label), ['New', 'Not booked', 'Website price'])
  assert.equal(s.price?.planDiscountPct, 10)
  assert.match(alertText(jane, [], base, 'new'), /saw \$45\/visit, 1st \$32/)
})

test('a later phone price replaces the website price everywhere', () => {
  const lead = { ...jane, board_column: 'quoted', phone_price_cents: 5000, phone_frequency: 'weekly', phone_price_at: '2026-10-29T15:00:00Z' }
  const s = summarizeLead(lead)
  assert.equal(s.price?.source, 'phone')
  assert.equal(priceShort(s.price), '$50/visit · 1st $35')
  assert.equal(s.headline, '$50/visit · 1st $35 · told by phone Oct 29')
})

test('columns drive the card headline', () => {
  assert.equal(summarizeLead({ ...jane, board_column: 'quoted', quoted_reason: 'start_later', check_back_on: '2027-03-01' }).headline, 'Not now · start later · Mar 1')
  assert.equal(summarizeLead({ ...jane, board_column: 'closed', closed_reason: 'price' }).headline, 'No · price')
  assert.equal(summarizeLead({ ...jane, website_price_cents: null, board_column: 'in_talks', call_attempts: 2 }).headline, 'No answer ×2')
  const canceled = summarizeLead({ ...jane, board_column: 'customer', customer_canceled_at: '2026-10-20T15:00:00Z' })
  assert.equal(canceled.headline, 'Canceled Oct 20')
  assert.equal(canceled.bookingLabel, 'Canceled')
  assert.equal(summarizeLead({ ...jane, board_column: 'customer' }, [{ status: 'confirmed', confirmed_date: '2026-11-06', created_at: '2026-10-29T00:00:00Z' }]).headline, 'First visit Fri Nov 6')
})

test('history rows are two or three words', () => {
  const now = Date.parse('2026-10-28T21:00:00Z')
  assert.deepEqual(historyItem({ kind: 'alert', outcome: 'taken', data: { staff: 'Caelan' }, occurred_at: '2026-10-28T19:15:00Z' }, now),
    { time: '2:15p', icon: 'alert', text: 'Caelan took alert', quote: null })
  assert.equal(historyItem({ kind: 'phone', outcome: 'talked', data: { duration_seconds: 240 }, occurred_at: '2026-10-28T19:19:00Z' }, now).text, 'Talked 4 min')
  assert.equal(historyItem({ kind: 'call', outcome: 'no', data: { reason: 'price' }, occurred_at: '2026-10-27T19:19:00Z' }, now).time, 'Oct 27')
})

test('a plan keeps the lead\'s own first visit as the request; generated visits are ignored', () => {
  const own = { status: 'completed', created_at: '2026-10-01T00:00:00Z', agreement_id: 'p1', occurrence_on: '2026-10-03', price_per_visit: 45, frequency: 'biweekly' }
  const next = { status: 'confirmed', created_at: '2026-10-03T00:00:00Z', agreement_id: 'p1', occurrence_on: '2026-10-17', price_per_visit: 60, frequency: 'biweekly' }
  const s = summarizeLead({ ...jane, website_price_cents: null, board_column: 'customer' }, [next, own])
  assert.equal(s.price?.cents, 4500)
})
