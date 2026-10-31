import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callVisitItems } from '../lib/crm-jobs'
import { bookingPrice, priceSteps } from '../lib/lead-summary'

const total = (items: { amount: string }[]) => items.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0)

test('a first visit booked by phone charges the 30% first-visit price; later visits the plan price', () => {
  const { items, plan, firstVisitPrice } = callVisitItems(10500, 'biweekly', 'Lawn care')
  assert.deepEqual(items, [{ kind: 'service', description: 'Lawn care', amount: '105.00' }, { kind: 'discount', description: 'First visit 30% off', amount: '-31.00' }])
  assert.equal(total(items), 7400)
  assert.deepEqual(plan, [{ kind: 'service', description: 'Lawn care', amount: '105.00' }])
  assert.equal(firstVisitPrice, 74)
  // Jobs total, confirmation email and the price rows agree.
  const steps = priceSteps(bookingPrice({ price_per_visit: 105, first_visit_price: firstVisitPrice, frequency: 'biweekly', manual_quote: true })!)
  assert.equal(steps.find(step => step.key === 'first')?.amount, '$74')
})

test('one-time jobs have no first-visit discount; cents prices round to the cent', () => {
  const once = callVisitItems(12000, 'onetime', 'Cleanup')
  assert.deepEqual(once.items, once.plan)
  assert.equal(once.firstVisitPrice, null)
  const cents = callVisitItems(4550, 'weekly', 'Lawn care')
  assert.equal(total(cents.items), 3185)
  assert.equal(cents.firstVisitPrice, null)
})
