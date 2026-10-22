import assert from 'node:assert/strict'
import { mowingForecast } from '../lib/crm-jobs.ts'

const base = { status: 'confirmed', one_time: false, frequency: 'Biweekly', sq_ft: 1000,
  created_at: '2026-10-22T00:00:00Z', price_per_visit: 60, job_total: null,
  customer_id: null, property_id: null, agreement_id: null, phone: '5551110000', name: 'Legacy' }
const old = { ...base, id: 'old', address: '10 Oak' }
const newer = { ...base, id: 'new', address: '10 Oak', created_at: '2026-10-23T00:00:00Z', job_total: '65.00' }
const secondProperty = { ...base, id: 'other', address: '20 Oak', job_total: '80.00' }
let rows = mowingForecast([old, newer, secondProperty], [], [])
assert.equal(rows.length, 2, 'legacy work groups by address for reporting, not phone-only identity')
assert.equal(rows.find(row => row.id === 'new')?.annual, 65 * 30)
assert.equal(rows.find(row => row.id === 'other')?.annual, 80 * 30)
rows = mowingForecast([{ ...secondProperty, sq_ft: null }], [], [])
assert.equal(rows[0]?.annual, 80 * 30, 'legacy recurring manual quotes can lack measured area')

const mowingAgreement = { id: 'agreement', status: 'active', customer_id: 'customer', property_id: 'property',
  price_per_visit: '90.00', items_template: [{ kind: 'service', description: 'Lawn care' }] }
const converted = { ...newer, id: 'converted', agreement_id: 'agreement', customer_id: 'customer', property_id: 'property' }
rows = mowingForecast([newer, converted], [mowingAgreement], [{ id: 'customer', name: 'Customer' }])
assert.equal(rows.length, 1, 'converted legacy row must not double-count the same property')
assert.equal(rows[0].annual, 90 * 30)
rows = mowingForecast([newer, converted], [{ ...mowingAgreement, status: 'paused' }], [])
assert.equal(rows.length, 0, 'paused converted agreements must not revive an older legacy forecast')

const gutterAgreement = { ...mowingAgreement, id: 'gutter', property_id: 'gutters',
  items_template: [{ kind: 'service', description: 'Gutter cleaning' }] }
rows = mowingForecast([converted], [mowingAgreement, gutterAgreement], [{ id: 'customer', name: 'Customer' }])
assert.equal(rows.length, 1, 'gutter work must not be multiplied by 30 mows')
console.log('PASS: conservative mowing forecast keeps legacy properties, deduplicates conversion, excludes non-mowing agreements')
