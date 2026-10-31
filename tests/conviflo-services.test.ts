import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addressForLookup, fullAddressWithPostcode } from '../lib/address-text'
import { convifloIntake } from '../lib/conviflo-intake'
import { creativeTypeLabel, formatAttributionLabel } from '../lib/attribution'

const forms = {
  cleanup: {
    services: ['Leaf cleanup', 'Gutter cleaning'], address_key: 'property_address', map_meta_utm_ids: true,
    service_key: 'cleanup_service',
    service_map: {
      leaf_cleanup: ['Leaf cleanup'], gutter_cleaning: ['Gutter cleaning'],
      both_leaves_and_gutters: ['Leaf cleanup', 'Gutter cleaning'],
    },
  },
}
const lead = (choice: unknown, utm: Record<string, string> = {}, responseId = 'resp-12345678') => convifloIntake({
  event: 'lead', outcome: 'completed', formId: 'cleanup', responseId,
  answers: { name: 'T', phone: '+15125550100', cleanup_service: choice,
    property_address: { street: '1 Main', city: 'Austin' } },
  meta: { utm },
}, forms)!

test('cleanup_service chooses leaves, gutters or both', () => {
  assert.deepEqual(lead('leaf_cleanup').lead.services, ['Leaf cleanup'])
  assert.deepEqual(lead('gutter_cleaning').lead.services, ['Gutter cleaning'])
  assert.deepEqual(lead('both_leaves_and_gutters').lead.services, ['Leaf cleanup', 'Gutter cleaning'])
  assert.deepEqual(lead('Both leaves and gutters').lead.services, ['Leaf cleanup', 'Gutter cleaning'])
  assert.deepEqual(lead('Gutter cleaning').lead.services, ['Gutter cleaning'])
  assert.equal(lead('leaf_cleanup').lead.address, '1 Main, Austin')
})

test('an unknown choice keeps the default services and is flagged', () => {
  const unknown = lead('something_new').lead
  assert.deepEqual(unknown.services, ['Leaf cleanup', 'Gutter cleaning'])
  assert.equal((unknown.answers as Record<string, unknown>).service_unmapped, true)
  assert.equal((lead('leaf_cleanup').lead.answers as Record<string, unknown>).service_unmapped, undefined)
})

test('distinct Meta ad links keep distinct IDs', () => {
  const a = lead('leaf_cleanup', { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: '111', utm_term: '222', utm_content: '333' }, 'resp-aaaaaaaa')
  const b = lead('leaf_cleanup', { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: '444', utm_term: '555', utm_content: '666' }, 'resp-bbbbbbbb')
  const ids = (x: typeof a) => { const t = x.lead.attribution.first_touch!; return [t.meta_campaign_id, t.meta_adset_id, t.meta_ad_id] }
  assert.deepEqual(ids(a), ['111', '222', '333'])
  assert.deepEqual(ids(b), ['444', '555', '666'])
  assert.notEqual(a.submission, b.submission)
})

test('creative types read as AI or Real', () => {
  assert.equal(creativeTypeLabel('ai'), 'AI creative')
  assert.equal(creativeTypeLabel('real'), 'Real creative')
  assert.equal(formatAttributionLabel({ utm_source: 'meta', creative_id: 'Mower close-up', creative_type: 'real' }), 'meta · Mower close-up · Real creative')
})

const addressLead = (address: unknown, postcode?: unknown) => convifloIntake({
  event: 'lead', outcome: 'completed', formId: 'cleanup', responseId: 'resp-address-123',
  formSlug: 'verified-form', submittedAt: '2026-10-27T12:00:00Z', leadValue: 150,
  answers: { name: 'Test Customer', phone: '+15125550100', cleanup_service: 'leaf_cleanup',
    property_address: address, postcode },
}, forms)!.lead

test('separate live postcode reaches the canonical address while raw answers and review remain', () => {
  const submitted = { street: ' 162 Danish dr ', city: ' Hutto ', unit: ' ' }
  const result = addressLead(submitted, ' 78634 ')
  assert.equal(result.address, '162 Danish dr, Hutto, 78634')
  assert.deepEqual(result.answers.property_address, submitted)
  assert.equal(result.answers.postcode, ' 78634 ')
  assert.equal(result.answers.address_needs_review, true)
  assert.equal(result.answers.address_missing, false)
  assert.equal(result.answers.conviflo_response_id, 'resp-address-123')
  assert.equal(result.answers.conviflo_form_slug, 'verified-form')
  assert.equal(result.estimated_value, 150)
  assert.equal(result.consent, false)
  assert.equal(result.score, null)
  assert.equal(Object.hasOwn(result, 'latitude'), false)
  assert.equal(Object.hasOwn(result, 'longitude'), false)
  assert.equal(Object.hasOwn(result.answers, 'property_context'), false)
})

test('legacy strings retain supplied state and ZIP without duplicate postcode', () => {
  assert.equal(addressLead('162 Danish dr, Hutto, TX 78634', '78634').address, '162 Danish dr, Hutto, TX 78634')
  assert.equal(addressLead('162 Danish dr, Hutto, TX 78634-1234', '78634').address, '162 Danish dr, Hutto, TX 78634-1234')
  assert.equal(addressLead('162 Danish dr, Hutto', '78634-1234').address, '162 Danish dr, Hutto, 78634-1234')
  assert.equal(addressLead('78634 Main St, Hutto', '78634').address, '78634 Main St, Hutto, 78634')
  assert.equal(addressLead('162 Danish dr, Hutto').address, '162 Danish dr, Hutto')
  assert.equal(addressLead({ street: '1 Main', unit: 'Unit 2', city: 'Austin' }).address, '1 Main, Unit 2, Austin')
})

test('invalid or missing address components never become an address from postcode alone', () => {
  for (const address of [null, undefined, [], 123, {}, { street: '1 Main' }, { street: 1, city: 'Hutto' }, '   ']) {
    const result = addressLead(address, '78634')
    assert.equal(result.address, null)
    assert.equal(result.answers.address_missing, true)
    assert.equal(result.answers.address_needs_review, true)
  }
  for (const postcode of [null, undefined, 78634, {}, [], '', ' ', '7863', '78634 extra']) {
    assert.equal(addressLead({ street: '1 Main', city: 'Hutto', unit: 9 }, postcode).address, '1 Main, Hutto')
  }
})


test('shared lookup address enrichment preserves historical contact text and validates postcode', () => {
  assert.equal(fullAddressWithPostcode('162 Danish dr, Hutto', '78634'), '162 Danish dr, Hutto, 78634')
  assert.equal(fullAddressWithPostcode('162 Danish dr, Hutto, TX 78634', '78634'), '162 Danish dr, Hutto, TX 78634')
  assert.equal(fullAddressWithPostcode('162 Danish dr, Hutto, TX 78634-1234', '78634'), '162 Danish dr, Hutto, TX 78634-1234')
  assert.equal(fullAddressWithPostcode('162 Danish dr, Hutto', '78634-1234'), '162 Danish dr, Hutto, 78634-1234')
  assert.equal(fullAddressWithPostcode('78634 Main St, Hutto', '78634'), '78634 Main St, Hutto, 78634')
  for (const postcode of [null, undefined, 78634, {}, [], '', ' ', '7863', '78634 extra']) {
    assert.equal(fullAddressWithPostcode('  1 Main, Hutto ', postcode), '  1 Main, Hutto ')
  }
  assert.equal(fullAddressWithPostcode('', '78634'), '')
  assert.equal(fullAddressWithPostcode('   ', '78634'), '   ')
})


test('historical postcode enriches only the exact original submitted address', () => {
  const submitted = { street: ' 162 Danish dr ', unit: ' ', city: ' Hutto ' }
  assert.equal(addressForLookup('162 Danish dr, Hutto', submitted, '78634'), '162 Danish dr, Hutto, 78634')
  assert.equal(addressForLookup('162 Danish dr, Hutto, 78634', submitted, '78634'), '162 Danish dr, Hutto, 78634')
  assert.equal(addressForLookup('162 Danish dr, Unit 2, Hutto', { ...submitted, unit: ' Unit 2 ' }, '78634'), '162 Danish dr, Unit 2, Hutto, 78634')
  assert.equal(addressForLookup('162 Danish dr, Hutto', ' 162 Danish dr, Hutto ', '78634'), '162 Danish dr, Hutto, 78634')
  for (const changed of ['543 Different Street, Austin', '543 Different Street, Austin, TX 78751', '162 Danish Drive, Hutto']) {
    assert.equal(addressForLookup(changed, submitted, '78634'), changed)
  }
  for (const missing of [null, undefined, {}, [], { street: '162 Danish dr' }]) {
    assert.equal(addressForLookup('162 Danish dr, Hutto', missing, '78634'), '162 Danish dr, Hutto')
  }
  assert.equal(fullAddressWithPostcode('543 Different Street, Austin, TX 78751', '78634'), '543 Different Street, Austin, TX 78751')
  assert.equal(fullAddressWithPostcode('543 Different Street, Austin, TX 78751-1234', '78634'), '543 Different Street, Austin, TX 78751-1234')
})
