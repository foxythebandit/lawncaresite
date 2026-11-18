import assert from 'node:assert/strict'
import { test } from 'node:test'
import { leadPromo } from '../lib/lead-promos'
import { alertText, summarizeLead, type SummaryLead } from '../lib/lead-summary'

const BEDS = 'e8d6472d-9c4c-488d-9f75-c495ac759e99'
const LEAVES = 'b521838c-6883-46d3-9e07-22a78a374ab4'
const MOWING = 'ae7c0184-fa95-40d4-8b74-cd8578083470'
const at = (when: string, answers: Record<string, unknown>) => ({ created_at: when, answers })

test('Garden Beds leads before the deadline get the 15% first-bed-job offer', () => {
  assert.equal(leadPromo(at('2026-11-18T15:00:00Z', { conviflo_form_id: BEDS }))?.label, '15% off first bed job')
})

test('Leaves & Gutters leads get the $30 bundle, or a prompt to offer it', () => {
  const lead = (choice: unknown) => leadPromo(at('2026-11-18T15:00:00Z', { conviflo_form_id: LEAVES, cleanup_service: choice }))
  assert.equal(lead('both_leaves_and_gutters')?.label, '$30 off leaves + gutters')
  assert.equal(lead('both_leaves_and_gutters_save_30')?.label, '$30 off leaves + gutters')
  assert.equal(lead('Leaf Cleanup')?.label, '$30 off if they add gutters')
  assert.equal(lead('gutter_cleaning')?.label, '$30 off if they add leaf cleanup')
  assert.equal(lead(undefined)?.label, '$30 off if they book leaves + gutters')
})

test('offers end after Nov 30 in Austin, using the form submit time when present', () => {
  assert.ok(leadPromo(at('2026-12-01T05:59:00Z', { conviflo_form_id: BEDS })), '11:59pm Nov 30 CST still counts')
  assert.equal(leadPromo(at('2026-12-01T06:00:00Z', { conviflo_form_id: BEDS })), null)
  assert.ok(leadPromo(at('2026-12-02T00:00:00Z', { conviflo_form_id: BEDS, conviflo_submitted_at: '2026-11-30T20:00:00Z' })),
    'a webhook retried after the deadline keeps the original submit time')
})

test('other forms and non-ConviFlo leads get no offer', () => {
  assert.equal(leadPromo(at('2026-11-18T15:00:00Z', { conviflo_form_id: MOWING })), null)
  assert.equal(leadPromo(at('2026-11-18T15:00:00Z', {})), null)
  assert.equal(leadPromo({ created_at: '2026-11-18T15:00:00Z', answers: null }), null)
})

test('the offer shows as a lead chip, on the board card and in the new-lead text', () => {
  const lead: SummaryLead = {
    id: 'x', name: 'Ana Ruiz', phone: '5125550123', created_at: '2026-11-18T15:00:00Z', source: 'conviflo',
    address: '12 Elm St, Austin, TX 78704', services: ['Mulch'], short_code: 'BB22CC',
    answers: { conviflo_form_id: BEDS, conviflo_submitted_at: '2026-11-18T15:00:00Z' },
  }
  const s = summarizeLead(lead)
  assert.deepEqual(s.chips.find(c => c.key === 'promo'), { key: 'promo', label: '15% off first bed job', tone: 'accent' })
  assert.match(s.card.detail, /15% off bed job$/)
  assert.match(alertText(lead, [], 'https://quietgreen.co', 'new'), /\nPromo: 15% off first bed job\n/)
  assert.equal(summarizeLead({ ...lead, answers: { conviflo_form_id: MOWING } }).promo, null)
})
