import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cachedGeocode, geocodeAddress, photonSearch } from '../lib/address-search'

const originalFetch = globalThis.fetch
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'sessionStorage')
})
const nominatimHouse = {
  display_name: '162, Danish Drive, Williamson County, Texas, 78634, United States',
  lat: '30.510755', lon: '-97.586527',
  address: { house_number: '162', road: 'Danish Drive', postcode: '78634', country_code: 'us' },
}
const photonHouse = (number = '162', street = 'Danish Drive', postcode = '78634') => ({
  geometry: { coordinates: [-97.586527, 30.510755] },
  properties: { countrycode: 'US', housenumber: number, street, postcode, city: 'Hutto' },
})
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

test('Jim resolves in one structured final search without inventing a city', async () => {
  let calls = 0
  globalThis.fetch = async input => {
    calls++
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('street'), '162 Danish Dr')
    assert.equal(url.searchParams.get('postalcode'), '78634')
    assert.equal(url.searchParams.get('city'), null)
    assert.equal(url.searchParams.get('addressdetails'), '1')
    return response([nominatimHouse])
  }
  const hit = await geocodeAddress('162 Danish Dr, Hutto, TX 78634')
  assert.equal(calls, 1)
  assert.equal(hit?.precision, 'address')
  assert.equal(hit?.houseNumber, '162')
  assert.equal(hit?.street, 'Danish Drive')
  assert.equal(hit?.lat, 30.510755)
})

test('final search rejects wrong house, road, street, ZIP, city, country and invalid coordinates', async () => {
  const variants = [
    { address: { ...nominatimHouse.address, house_number: '163' } },
    { address: { ...nominatimHouse.address, house_number: undefined } },
    { address: { ...nominatimHouse.address, road: 'Other Drive' } },
    { address: { ...nominatimHouse.address, postcode: '78701' } },
    { address: { ...nominatimHouse.address, city: 'Dallas' } },
    { address: { ...nominatimHouse.address, state: 'Minnesota' } },
    { address: { ...nominatimHouse.address, country_code: 'ca' } },
    { lat: '91' }, { lon: 'Infinity' }, { lat: null }, { lon: '' }, { lat: '  ' },
  ]
  for (const variant of variants) {
    globalThis.fetch = async input => String(input).includes('nominatim')
      ? response([{ ...nominatimHouse, ...variant }]) : response({ features: [] })
    assert.equal(await geocodeAddress('162 Danish Dr, Hutto, TX 78634'), null)
  }
})

test('Photon suggests roads honestly and final lookup rejects a wrong-house fallback', async () => {
  globalThis.fetch = async input => String(input).includes('nominatim')
    ? new Response('', { status: 429 })
    : response({ features: [photonHouse('', 'Danish Drive'), photonHouse('163')] })
  const hits = await photonSearch('162 Danish Dr, Hutto, TX 78634', 5)
  assert.deepEqual(hits.map(hit => hit.precision), ['approximate', 'approximate'])
  assert.equal(await geocodeAddress('162 Danish Dr, Hutto, TX 78634'), null)
})

test('explicit abort never starts a provider fallback or writes a result', async () => {
  const controller = new AbortController()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    controller.abort()
    return response([nominatimHouse])
  }
  await assert.rejects(cachedGeocode('162 Danish Dr, Hutto, TX 78634', controller.signal), { name: 'AbortError' })
  assert.equal(calls, 1)
  await assert.rejects(photonSearch('162 Danish', 5, controller.signal), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('all provider requests have finite abort budgets and network failure resolves empty', async () => {
  let calls = 0
  globalThis.fetch = async (_input, options) => {
    calls++
    assert.ok(options?.signal)
    throw new Error('offline')
  }
  assert.equal(await geocodeAddress('162 Danish Dr, Hutto, TX 78634'), null)
  assert.equal(calls, 2)
})

test('cache ignores legacy/poisoned entries, validates coordinates and stays bounded', async () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } })
  const query = '162 Danish Dr, Hutto, TX 78634'
  const key = `qg_geo_v2:${query.toLowerCase()}`
  values.set(`qg_geo:${query.toLowerCase()}`, JSON.stringify({ label: 'wrong legacy', lat: 0, lon: 0 }))
  values.set(key, JSON.stringify({ savedAt: Date.now(), hit: { label: 'bad', lat: 91, lon: 0, precision: 'address' } }))
  for (let i = 0; i < 55; i++) values.set(`qg_geo_v2:old${i}`, '{}')
  let calls = 0
  globalThis.fetch = async () => { calls++; return response([nominatimHouse]) }
  const hit = await cachedGeocode(query)
  assert.equal(hit?.houseNumber, '162')
  assert.equal(calls, 1)
  assert.ok([...values.keys()].filter(key => key.startsWith('qg_geo_v2:')).length <= 50)
  assert.deepEqual(await cachedGeocode(query), JSON.parse(JSON.stringify(hit)))
  assert.equal(calls, 1)
})

test('a stalled final provider times out and permits one bounded Photon fallback', async () => {
  let calls = 0
  globalThis.fetch = async (input, options) => {
    calls++
    if (String(input).includes('photon')) return response({ features: [photonHouse()] })
    return new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })
    })
  }
  const keepAlive = setTimeout(() => {}, 7000)
  const started = Date.now()
  assert.equal((await geocodeAddress('162 Danish Dr, Hutto, TX 78634'))?.provider, 'photon')
  assert.equal(calls, 2)
  assert.ok(Date.now() - started < 6700)
  clearTimeout(keepAlive)
})

test('ordinary complete addresses without commas retain street, locality and ZIP', async () => {
  const cases = [
    ['162 Danish Dr Hutto TX 78634', '162 Danish Dr', '78634', nominatimHouse],
    ['162 Danish Dr Hutto TX78634', '162 Danish Dr', '78634', nominatimHouse],
    ['807 E 47th St Austin TX 78751', '807 E 47th St', '78751', {
      display_name: '807 East 47th Street, Austin, Texas, 78751', lat: '30.307429', lon: '-97.7187552',
      address: { house_number: '807', road: 'East 47th Street', city: 'Austin', state: 'Texas', postcode: '78751', country_code: 'us' },
    }],
    ['100 E Main St Pflugerville TX 78660', '100 E Main St', '78660', {
      display_name: '100 Main Street East, Pflugerville', lat: '30.4408898', lon: '-97.6201335',
      address: { house_number: '100', road: 'Main Street East', city: 'Pflugerville', state: 'Texas', postcode: '78660', country_code: 'us' },
    }],
  ] as const
  for (const [query, street, zip, house] of cases) {
    globalThis.fetch = async input => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.get('street'), street)
      assert.equal(url.searchParams.get('postalcode'), zip)
      return response([house])
    }
    assert.equal((await geocodeAddress(query))?.precision, 'address', query)
  }
})

test('unpunctuated wrong ZIP or explicit different city never degrades to a road', async () => {
  for (const query of ['162 Danish Dr Hutto TX 78701', '162 Danish Dr Dallas TX 78634']) {
    globalThis.fetch = async input => String(input).includes('nominatim')
      ? response([{ ...nominatimHouse, address: { ...nominatimHouse.address, city: 'Hutto' } }])
      : response({ features: [photonHouse('', 'Danish Drive')] })
    assert.equal(await geocodeAddress(query), null, query)
  }
})

test('malformed provider JSON is bounded and returns no location', async () => {
  globalThis.fetch = async () => new Response('not JSON', { status: 200 })
  assert.equal(await geocodeAddress('162 Danish Dr Hutto TX 78634'), null)
})

test('cached live Photon fixtures retain matching known civic and office addresses', async () => {
  const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'tests/address-reliability/provider-results.json'), 'utf8'))
  for (const id of ['office', 'austin-city-hall', 'hutto-city-hall', 'hutto-no-zip', 'round-rock-library', 'cedar-park-library', 'leander-city-hall', 'pflugerville-city-hall', 'out-of-area']) {
    const fixture = fixtures[`photon:${id}`]
    globalThis.fetch = async () => response(fixture.response)
    const hits = await photonSearch(fixture.query, 5)
    assert.equal(hits[0]?.precision, 'address', id)
    // Original live Nominatim fixtures lack addressdetails; exercise final fallback
    // with the original unmodified live Photon body instead of inventing detail fields.
    globalThis.fetch = async input => String(input).includes('nominatim') ? response([]) : response(fixture.response)
    assert.equal((await geocodeAddress(fixture.query))?.precision, 'address', id)
  }
})

test('cancelling a queued search makes no request and does not reserve another slot', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return response([nominatimHouse]) }
  const query = '162 Danish Dr, Hutto, TX 78634'
  await geocodeAddress(query)
  const controller = new AbortController()
  const queued = geocodeAddress(query, controller.signal)
  controller.abort()
  await assert.rejects(queued, { name: 'AbortError' })
  assert.equal(calls, 1)
  const started = Date.now()
  assert.equal((await geocodeAddress(query))?.precision, 'address')
  assert.equal(calls, 2)
  assert.ok(Date.now() - started < 2000)
})

test('garbled and broad final searches cannot claim a verified house from fuzzy results', async () => {
  for (const query of ['162Danish', 'Danish Drive', 'nonsense search']) {
    globalThis.fetch = async () => response([nominatimHouse])
    assert.equal((await geocodeAddress(query))?.precision, 'approximate', query)
    globalThis.fetch = async input => String(input).includes('nominatim') ? response([]) : response({ features: [photonHouse()] })
    assert.equal((await geocodeAddress(query))?.precision, 'approximate', query)
  }
  globalThis.fetch = async input => String(input).includes('nominatim')
    ? response([nominatimHouse]) : response({ features: [photonHouse('', 'Danish Drive')] })
  assert.equal(await geocodeAddress('162 Imaginary Unicorn Ln'), null)
  assert.equal(await geocodeAddress('162 Danish Dr Imaginary Road Hutto TX78634'), null)
})
