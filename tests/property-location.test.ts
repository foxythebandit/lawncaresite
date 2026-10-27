import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPropertyConfirmed, isPropertyPoint, parseManualPropertyLocation } from '../lib/property-location'

test('manual coordinates accept explicit finite latitude and longitude', () => {
  assert.deepEqual(parseManualPropertyLocation(' 30.3049, -97.7184 '), { lat: 30.3049, lng: -97.7184 })
  assert.deepEqual(parseManualPropertyLocation('-90,180'), { lat: -90, lng: 180 })
  for (const input of ['', '30', '30,', ',30', 'NaN,30', 'Infinity,30', '91,0', '0,-181', '30,-97 extra', '30,-97,0']) {
    assert.equal(parseManualPropertyLocation(input), null, input)
  }
})

test('Maps selected-place coordinates take precedence over viewport coordinates', () => {
  assert.deepEqual(parseManualPropertyLocation('https://www.google.com/maps/place/House/@31,-98,18z/data=!4m2!3d30.3049!4d-97.7184?entry=ttu'), { lat: 30.3049, lng: -97.7184 })
  assert.deepEqual(parseManualPropertyLocation('https://google.com/maps/place/House/data=%213d30%214d-97'), { lat: 30, lng: -97 })
})

test('ambiguous, viewport-only, shortened and unrelated URLs are rejected without fetching', () => {
  for (const input of [
    'https://www.google.com/maps/@30,-97,18z',
    'https://maps.app.goo.gl/abc',
    'https://example.com/maps/place/House/data=!3d30!4d-97',
    'https://google.com.evil.test/maps/data=!3d30!4d-97',
    'https://google.com/search/data=!3d30!4d-97',
    'https://user@google.com/maps/data=!3d30!4d-97',
    'https://google.com/maps/data=!3d30!4d-97!3d31!4d-98',
    'https://google.com/maps/data=!3d91!4d-97',
    'https://google.com/maps/data=!3d30!4d-97oops',
    'https://google.com/maps/data=!3d30!4d-97%XX',
  ]) assert.equal(parseManualPropertyLocation(input), null, input)
})

test('confirmation survives serialization only for the exact address and point', () => {
  const point = { lat: 30, lng: -97 }
  const saved: unknown = JSON.parse(JSON.stringify({ ...point, address: '1 Main, Austin', contactAddress: '1 Main' }))
  assert.equal(isPropertyConfirmed(saved, '1 Main, Austin', '1 Main', point), true)
  assert.equal(isPropertyConfirmed(saved, '2 Main, Austin', '1 Main', point), false)
  assert.equal(isPropertyConfirmed(saved, '1 Main, Austin', '2 Main', point), false)
  assert.equal(isPropertyConfirmed(saved, '1 Main, Austin', '1 Main', { lat: 30.1, lng: -97 }), false)
  assert.equal(isPropertyConfirmed(point, '1 Main, Austin', '1 Main', point), false)
  assert.equal(isPropertyConfirmed(null, '1 Main, Austin', '1 Main', point), false)
  assert.equal(isPropertyConfirmed({ ...point, address: ' ', contactAddress: null }, ' ', null, point), false)
  for (const bad of [{ lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }, { lat: '30', lng: -97 }, null]) {
    assert.equal(isPropertyPoint(bad), false)
    assert.equal(isPropertyConfirmed(saved, '1 Main, Austin', '1 Main', bad), false)
  }
})
