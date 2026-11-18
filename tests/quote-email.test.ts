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
const quote: QuoteEmailOptions = {
  message: 'Hi Sam,\nHere is your quote.',
  when: 'Start after the leaves clear',
  addOns: [{ label: 'Bagging clippings', cents: 1000 }],
}

test('one reviewed weekly price, bagging per visit, first visit 30% off mowing only', () => {
  const b = quoteEmailBreakdown(draft, quote)
  assert.equal(b.sqFt, 6300)
  assert.deepEqual(b.rows.map(r => [r.freq, r.when, r.mowCents, r.perVisitCents, r.firstVisitCents]), [
    ['weekly', 'Start after the leaves clear', 6800, 7800, 4800 + 1000],
  ])
})

test('email shows the map inline, lawn size, the series, add-on and first visit; preview equals send', () => {
  const email = quoteEmailContent({ draft, address: draft.address, options: quote, bookUrl: 'https://quietgreen.co/quote/t', hasMap: true })
  assert.equal(email.subject, 'Your QuietGreen mowing quote: weekly $78/visit')
  assert.ok(email.html.includes(`src="cid:${MAP_CID}"`))
  for (const part of ['6,300 sq ft', 'Weekly mowing · Start after the leaves clear', 'Mowing (15% off)', 'Bagging clippings', '+$10', '$78',
    'First visit: $58 (30% off mowing, bagging clippings at full price)', 'https://quietgreen.co/quote/t']) assert.ok(email.html.includes(part), part)
  assert.match(email.text, /Weekly mowing · Start after the leaves clear\n  Mowing \(15% off\): \$68\n  Bagging clippings: \+\$10\n  Per visit: \$78/)
  assert.deepEqual(quoteEmailContent({ draft, address: draft.address, options: quote, bookUrl: 'https://quietgreen.co/quote/t', hasMap: true }), email)
  assert.equal(quoteEmailSummary(email.breakdown), 'Weekly $78/visit (Start after the leaves clear), incl. bagging clippings +$10; first visit $58')
})

test('no map: no image tag; customer text is escaped', () => {
  const email = quoteEmailContent({ draft, address: '<b>x</b>', options: { ...quote, message: '<script>' }, bookUrl: null, hasMap: false })
  assert.ok(!email.html.includes('cid:'))
  assert.ok(!email.html.includes('<script>') && email.html.includes('&lt;script&gt;') && email.html.includes('&lt;b&gt;x'))
})

test('fixed-price quote stays one total with add-ons added', () => {
  const job = { ...draft, includeMowing: false, manualLines: [{ id: 'l', service: 'Cleanup', amountCents: 25000 }], totalCents: 25000 } as QuoteDraft
  const b = quoteEmailBreakdown(job, quote)
  assert.equal(b.mowing, false)
  assert.deepEqual(b.rows.map(r => [r.perVisitCents, r.firstVisitCents]), [[26000, null]])
})

test('options are validated', () => {
  assert.equal(validateQuoteEmailOptions(quote), null)
  assert.ok(validateQuoteEmailOptions({ ...quote, message: ' ' }))
  assert.ok(validateQuoteEmailOptions({ ...quote, addOns: [{ label: 'Bagging', cents: 0 }] }))
  assert.ok(validateQuoteEmailOptions({ ...quote, addOns: [{ label: '', cents: 500 }] }))
  assert.ok(validateQuoteEmailOptions({ ...quote, when: 'x'.repeat(81) }))
})

test('map picture view fits the whole tracing with a margin', () => {
  const view = lawnMapView([{ coords }])
  for (const [lng, lat] of coords) {
    const [x, y] = project(lng, lat, view.z)
    assert.ok(x - view.left > 960 * 0.1 && x - view.left < 960 * 0.9 && y - view.top > 560 * 0.1 && y - view.top < 560 * 0.9)
  }
  assert.ok(view.tileZ <= 19 && view.scale === 2 ** (view.z - view.tileZ))
})

test('an introductory one-time mow preserves cents and charges add-ons at their quoted price', () => {
  const job = { ...draft, freq: 'onetime', calculatedPrice: 83.55, totalCents: 8355 } as QuoteDraft
  const options = { ...quote, when: '', addOns: [{ label: 'Bagging', cents: 1025 }] }
  const [row] = quoteEmailBreakdown(job, options).rows
  assert.equal(row.perVisitCents, 9380)
  assert.equal(row.firstVisitCents, 6874)
  assert.deepEqual(row.firstItems.map(item => item.amount), ['83.55', '10.25', '-25.06'])
  assert.equal(quoteEmailBreakdown(job, options, false).rows[0].firstVisitCents, null)
  const email = quoteEmailContent({ draft: job, address: job.address, options, bookUrl: null, hasMap: false })
  assert.match(email.text, /One-time mowing/)
  assert.doesNotMatch(email.text, /Per visit/)
})

test('a monthly cleanup quote keeps its custom price and never gets a first-mow promotion', () => {
  const cleanup = { ...draft, includeMowing: false, manualLines: [{ id: 'l', service: 'Leaf cleanup', amountCents: 25000 }], totalCents: 25000 }
  const options: QuoteEmailOptions = { ...quote, addOns: [], frequency: 'monthly' }
  const email = quoteEmailContent({ draft: cleanup, address: cleanup.address, options, bookUrl: null, hasMap: false })
  assert.match(email.text, /Leaf cleanup · Monthly.*\n  Leaf cleanup: \$250\n  Per visit: \$250/)
  assert.equal(email.breakdown.rows[0].freq, 'monthly')
  assert.equal(email.breakdown.rows[0].perVisitCents, 25000)
  assert.equal(email.breakdown.rows[0].firstVisitCents, null)
  assert.equal(quoteEmailBreakdown(cleanup, { ...options, frequency: 'weekly' }).rows[0].perVisitCents, 25000)
})
