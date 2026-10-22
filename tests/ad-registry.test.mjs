import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enrichMetaCreative } from '../lib/ad-registry.ts'

const registry = JSON.stringify({
  '900003': { creative_id: 'AI video: leaf cleanup', creative_type: 'ai' },
  '900004': { creative_id: 'Paxton mowing video', creative_type: 'real' },
})

test('known Meta ads receive configured creative labels without changing attribution', () => {
  const touch = { meta_ad_id: '900003', meta_adset_id: '900002', utm_source: 'meta', creative_type: 'real' }
  assert.deepEqual(enrichMetaCreative(touch, registry), {
    ...touch, creative_id: 'AI video: leaf cleanup', creative_type: 'ai',
  })
  assert.equal(touch.creative_type, 'real')
  assert.equal(enrichMetaCreative({ meta_ad_id: '900004' }, registry).creative_type, 'real')
})

test('unknown or generic campaign labels never infer creative classification', () => {
  for (const touch of [
    { meta_ad_id: '900005' }, { utm_content: '900003' },
    { google_ad_id: '900003' }, { meta_ad_id: 900003 }, { meta_ad_id: 'AI video' },
  ]) assert.deepEqual(enrichMetaCreative(touch, registry), touch)
})

test('missing or malformed mapping does not prevent lead intake or fabricate labels', () => {
  const touch = { meta_ad_id: '900003', creative_id: 'submitted label' }
  for (const config of [undefined, '', '{', 'null', '[]', '42', '{}',
    JSON.stringify({ '900003': { creative_id: '', creative_type: 'ai' } }),
    JSON.stringify({ '900003': { creative_id: 'x'.repeat(151), creative_type: 'ai' } }),
    JSON.stringify({ '900003': { creative_id: 'Bad\nlabel', creative_type: 'ai' } }),
    JSON.stringify({ '900003': { creative_id: 'Unknown kind', creative_type: 'maybe' } }),
    JSON.stringify({ '900003': { creative_id: 'Wrong type', creative_type: ['ai'] } }),
  ]) assert.deepEqual(enrichMetaCreative(touch, config), touch)
})
