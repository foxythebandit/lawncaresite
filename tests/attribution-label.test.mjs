import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanAttribution, formatAttributionLabel } from '../lib/attribution.ts'

test('existing website UTM-only lead identifies the real testimonial video without mutation', () => {
  const touch = { utm_source: 'meta', utm_campaign: '120253769117350725', utm_term: '120253769297450725', utm_content: '120253769297460725' }
  const before = structuredClone(touch)
  assert.equal(formatAttributionLabel(touch), 'Meta · Real People · Video · Testimonial')
  assert.deepEqual(touch, before)
})

test('all twelve launched ad IDs distinguish AI/real and video/still, regardless of old creative labels', () => {
  const cases = [
    ['120253769117370725', 'AI · Video · Everybody Loves Dave'],
    ['120253769229100725', 'AI · Video · I Married That Guy'],
    ['120253769229110725', 'AI · Video · Youre Welcome'],
    ['120253769229120725', 'AI · Still image · Electric Mowing'],
    ['120253769229130725', 'AI · Still image · Split Yard'],
    ['120253769229140725', 'AI · Still image · Weekend Back'],
    ['120253769297420725', 'Real People · Video · Night Mowing'],
    ['120253769297460725', 'Real People · Video · Testimonial'],
    ['120253769297470725', 'Real People · Video · Leaf Cleanup'],
    ['120253769297440725', 'Real People · Still image · Alarm Clock'],
    ['120253769297430725', 'Real People · Still image · Cleaner Cut'],
    ['120253769297480725', 'Real People · Still image · Before and After'],
  ]
  for (const [meta_ad_id, expected] of cases) {
    assert.equal(formatAttributionLabel({ meta_ad_id, creative_id: 'old label' }), `Meta · ${expected}`)
  }
})

test('first and latest tracked visits remain separate and keep the raw IDs', () => {
  const attribution = cleanAttribution({
    first_touch: { meta_ad_id: '120253769297430725' },
    latest_touch: { meta_ad_id: '120253769117370725' },
  })
  assert.equal(formatAttributionLabel(attribution.first_touch), 'Meta · Real People · Still image · Cleaner Cut')
  assert.equal(formatAttributionLabel(attribution.latest_touch), 'Meta · AI · Video · Everybody Loves Dave')
  assert.equal(attribution.first_touch.meta_ad_id, '120253769297430725')
})

test('unmapped IDs and other sources do not acquire invented ad labels', () => {
  for (const touch of [
    { utm_source: 'google', utm_campaign: '120253769117350725', utm_content: '120253769297460725' },
    { utm_source: 'meta', utm_campaign: 'another-campaign', utm_content: '120253769297460725' },
    { utm_source: 'meta', meta_ad_id: '99999' },
    { utm_source: 'meta', meta_ad_id: 'constructor' },
  ]) assert.doesNotMatch(formatAttributionLabel(touch), /Testimonial|Video|Still image/)
  assert.equal(formatAttributionLabel({ gclid: 'google-click' }), 'Google Ads')
  assert.equal(formatAttributionLabel({ fbclid: 'meta-click' }), 'Meta (ad unknown)')
  assert.equal(formatAttributionLabel({}), null)
  assert.equal(formatAttributionLabel(null), null)
})
