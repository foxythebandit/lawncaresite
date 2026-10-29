import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alertLegHistory, allPrices, historyItem, summarizeLead, type SummaryLead } from '../lib/lead-summary'

const now = Date.parse('2026-10-28T23:00:00Z')
const at = (hhmm: string) => `2026-10-28T${hhmm}:00Z`
const words = (rows: { time: string; text: string }[]) => rows.map(r => `${r.time} ${r.text}`)

test('an alert leg reads "Alert to X" and then the phone result (PLAN.md 7.2b, 7.2c)', () => {
  assert.deepEqual(words(alertLegHistory({ staff_name: 'Caelan', status: 'no-answer', result: 'no_answer', created_at: at('19:14'), ended_at: at('19:15') }, now)),
    ['2:14p Alert to Caelan', '2:15p Caelan\'s phone: no answer'])
  assert.deepEqual(words(alertLegHistory({ staff_name: 'Paxton', status: 'busy', result: 'busy', created_at: at('19:14'), ended_at: at('19:14') }, now)),
    ['2:14p Alert to Paxton', '2:14p Paxton\'s phone: busy'])
})

test('a leg that answered shows the answer time; took it / passed stay with the activities', () => {
  const claimed = alertLegHistory({ staff_name: 'Caelan', status: 'completed', result: 'claimed', created_at: at('19:14'), answered_at: at('19:15'), ended_at: at('19:16') }, now)
  assert.deepEqual(words(claimed), ['2:14p Alert to Caelan', '2:15p Caelan\'s phone: answered'])
  assert.equal(claimed[1].at, at('19:15'))
  assert.equal(claimed[1].icon, 'phone')
  assert.equal(claimed[0].icon, 'alert')
  // The matching activity keeps its own words, so nothing is said twice.
  assert.equal(historyItem({ kind: 'alert', outcome: 'taken', data: { staff: 'Caelan' }, occurred_at: at('19:15') }, now).text, 'Caelan took alert')
  assert.deepEqual(words(alertLegHistory({ staff_name: 'Paxton', result: 'passed', created_at: at('19:14'), answered_at: at('19:15') }, now)).slice(1), ['2:15p Paxton\'s phone: answered'])
  assert.deepEqual(words(alertLegHistory({ staff_name: 'Paxton', status: 'in-progress', result: null, created_at: at('19:14'), answered_at: at('19:15') }, now)).slice(1), ['2:15p Paxton\'s phone: answered'])
})

test('a ringing leg shows only the alert; a stopped or failed leg says so', () => {
  assert.deepEqual(words(alertLegHistory({ staff_name: 'Caelan', status: 'ringing', result: null, created_at: at('19:14') }, now)), ['2:14p Alert to Caelan'])
  assert.deepEqual(words(alertLegHistory({ staff_name: 'Paxton', status: 'canceled', result: 'canceled', created_at: at('19:14'), ended_at: at('19:15') }, now)).slice(1), ['2:15p Paxton\'s phone: stopped'])
  assert.deepEqual(words(alertLegHistory({ staff_name: null, status: 'failed', result: 'failed', created_at: at('19:14') }, now)), ['2:14p Alert to staff', '2:14p Staff phone: failed'])
})

test('address-changed and service-unclear warnings come from the summary chips', () => {
  const s = summarizeLead({ id: 'x', created_at: at('19:14'), address: '1 Main St', answers: { service_unmapped: true } }, [], { addressChanged: true, now })
  assert.deepEqual(s.chips.filter(c => c.tone === 'warn').map(c => [c.key, c.label]), [['address_changed', 'Address changed'], ['service_unclear', 'Service unclear']])
  assert.ok(!summarizeLead({ id: 'x', created_at: at('19:14'), address: '1 Main St' }, [], { now }).chips.some(c => c.key === 'address_changed' || c.key === 'service_unclear'))
})

const lead: SummaryLead = { id: 'x', created_at: at('19:14'), website_price_cents: 4500, website_first_visit_cents: 3200, website_frequency: 'biweekly', website_price_at: at('19:14') }
const draft = (dollars: number, freq = 'biweekly') => ({ sections: [{ id: 'a', name: 'Lawn', sqFt: 6200, coords: null }], freq, includeMowing: true, calculatedPrice: dollars, overridePrice: null })

test('website price alone is the headline with no other rows', () => {
  const prices = allPrices(lead)
  assert.equal(prices.headline?.source, 'website')
  assert.deepEqual(prices.others, [])
})

test('a later phone price becomes the headline and the website price stays as a row (S10, 4.1f)', () => {
  const prices = allPrices({ ...lead, phone_price_cents: 5000, phone_frequency: 'weekly', phone_price_at: at('20:00') })
  assert.equal(prices.headline?.source, 'phone')
  assert.equal(prices.headline?.cents, 5000)
  assert.deepEqual(prices.others.map(r => [r.label, r.value]), [['Website', '$45/visit · Every 2 weeks · Oct 28']])
})

test('emailed quote, phone and website prices all show; the newest is the headline', () => {
  const prices = allPrices({ ...lead, phone_price_cents: 5000, phone_frequency: 'biweekly', phone_price_at: at('20:00'),
    quote_draft: draft(48), quote_emailed_at: at('21:00') })
  assert.equal(prices.headline?.source, 'emailed')
  assert.equal(prices.headline?.cents, 4800)
  assert.deepEqual(prices.others.map(r => [r.label, r.value]), [['Phone', '$50/visit · Every 2 weeks · Oct 28'], ['Website', '$45/visit · Every 2 weeks · Oct 28']])
})

test('an unsent draft is shown as a row but never the headline', () => {
  const prices = allPrices({ ...lead, quote_draft: draft(120, 'onetime'), quote_saved_at: at('21:00') })
  assert.equal(prices.headline?.source, 'website')
  assert.deepEqual(prices.others.map(r => [r.key, r.label, r.value]), [['quote', 'Draft quote', '$120 total · Oct 28']])
})

test('an accepted quote replaces the draft row; an online booking price keeps its own row', () => {
  const prices = allPrices({ ...lead, quote_status: 'accepted', quote_draft: draft(99), accepted_quote_snapshot: draft(48), quote_accepted_at: at('20:30') },
    [{ status: 'pending', created_at: at('19:20'), frequency: 'Bi-weekly', price_per_visit: 45, first_visit_price: 32 }])
  assert.equal(prices.headline?.cents, 4800)
  assert.deepEqual(prices.others.map(r => r.label), ['Online booking', 'Website'])
  assert.ok(!prices.others.some(r => r.key === 'quote'))
})
