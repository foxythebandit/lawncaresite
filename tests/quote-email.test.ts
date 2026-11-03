import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { QuoteDraft } from '../lib/quote-draft'
import { MAP_CID, quoteEmailBreakdown, quoteEmailContent, quoteEmailSummary, validateQuoteEmailOptions, type QuoteEmailOptions } from '../lib/quote-email'
import { lawnMapView, project } from '../app/admin/leads/lawn-map-image'

// A weekly mowing quote saved by the staff map: $68/visit weekly (15% off an $80 base).
const coords: [number, number][] = [[-97.70, 30.40], [-97.6996, 30.40], [-97.6996, 30.4003], [-97.70, 30.4003]]
const draft = {
  address: '6404 Example Ln, Austin, TX', sections: [{ id: 'a', name: 'Front', sqFt: 4200, coords }, { id: 'b', name: 'Back', sqFt: 2100, coords }],
  jobLatLng: null, freq: 'weekly', lastMow: 'thisweek', calculatedPrice: 68, calculatedFirstVisit: 48, overridePrice: null,
  includeMowing: true, manualLines: [], discountCents: 0, totalCents: 6800, notes: '',
} as unknown as QuoteDraft
const seasonal: QuoteEmailOptions = {
  message: 'Hi Sam,\nHere is your quote.',
  plans: [{ freq: 'biweekly', when: 'Early summer on' }, { freq: 'weekly', when: 'Spring to early summer' }],
  addOns: [{ label: 'Bagging clippings', cents: 1000 }],
}

test('seasonal plan: weekly then bi-weekly, bagging per visit, first visit 30% off mowing only', () => {
  const b = quoteEmailBreakdown(draft, seasonal)
  assert.equal(b.sqFt, 6300)
  assert.deepEqual(b.rows.map(r => [r.freq, r.when, r.mowCents, r.perVisitCents, r.firstVisitCents]), [
    ['weekly', 'Spring to early summer', 6800, 7800, 4800 + 1000],
    ['biweekly', 'Early summer on', 7200, 8200, null],
  ])
})

test('email shows the map inline, lawn size, both plans, add-on and first visit; preview equals send', () => {
  const email = quoteEmailContent({ draft, address: draft.address, options: seasonal, bookUrl: 'https://quietgreen.co/quote/t', hasMap: true })
  assert.equal(email.subject, 'Your QuietGreen mowing quote: weekly $78/visit, bi-weekly $82/visit')
  assert.ok(email.html.includes(`src="cid:${MAP_CID}"`))
  for (const part of ['6,300 sq ft', 'Weekly mowing · Spring to early summer', 'Mowing (15% off)', 'Bagging clippings', '+$10', '$78', '$82',
    'First visit: $58 (30% off mowing, bagging clippings at full price)', 'https://quietgreen.co/quote/t']) assert.ok(email.html.includes(part), part)
  assert.match(email.text, /Bi-weekly mowing · Early summer on\n  Mowing \(10% off\): \$72\n  Bagging clippings: \+\$10\n  Per visit: \$82/)
  assert.deepEqual(quoteEmailContent({ draft, address: draft.address, options: seasonal, bookUrl: 'https://quietgreen.co/quote/t', hasMap: true }), email)
  assert.equal(quoteEmailSummary(email.breakdown), 'Weekly $78/visit (Spring to early summer), Bi-weekly $82/visit (Early summer on), incl. bagging clippings +$10; first visit $58')
})

test('no map: no image tag; customer text is escaped', () => {
  const email = quoteEmailContent({ draft, address: '<b>x</b>', options: { ...seasonal, message: '<script>' }, bookUrl: null, hasMap: false })
  assert.ok(!email.html.includes('cid:'))
  assert.ok(!email.html.includes('<script>') && email.html.includes('&lt;script&gt;') && email.html.includes('&lt;b&gt;x'))
})

test('fixed-price quote stays one total with add-ons added', () => {
  const job = { ...draft, includeMowing: false, manualLines: [{ id: 'l', service: 'Cleanup', amountCents: 25000 }], totalCents: 25000 } as QuoteDraft
  const b = quoteEmailBreakdown(job, seasonal)
  assert.equal(b.recurring, false)
  assert.deepEqual(b.rows.map(r => [r.perVisitCents, r.firstVisitCents]), [[26000, null]])
})

test('options are validated', () => {
  assert.equal(validateQuoteEmailOptions(seasonal), null)
  assert.ok(validateQuoteEmailOptions({ ...seasonal, message: ' ' }))
  assert.ok(validateQuoteEmailOptions({ ...seasonal, addOns: [{ label: 'Bagging', cents: 0 }] }))
  assert.ok(validateQuoteEmailOptions({ ...seasonal, addOns: [{ label: '', cents: 500 }] }))
  assert.ok(validateQuoteEmailOptions({ ...seasonal, plans: [{ freq: 'weekly', when: '' }, { freq: 'weekly', when: '' }] }))
  assert.ok(validateQuoteEmailOptions({ ...seasonal, plans: [{ freq: 'daily' as never, when: '' }] }))
})

test('map picture view fits the whole tracing with a margin', () => {
  const view = lawnMapView([{ coords }])
  for (const [lng, lat] of coords) {
    const [x, y] = project(lng, lat, view.z)
    assert.ok(x - view.left > 960 * 0.1 && x - view.left < 960 * 0.9 && y - view.top > 560 * 0.1 && y - view.top < 560 * 0.9)
  }
  assert.ok(view.tileZ <= 19 && view.scale === 2 ** (view.z - view.tileZ))
})
