/* eslint-disable @typescript-eslint/no-require-imports -- Test-only Node preload. */
// Load BEFORE twilio-mock.cjs. The outer provider mock handles Twilio; everything
// else must remain on the dedicated disposable app/database or an explicit fixture.
const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(value)
  if (['localhost', '127.0.0.1'].includes(url.hostname) && ['3102', '56421'].includes(url.port)) {
    return originalFetch(input, init)
  }
  if (['services.arcgis.com', 'gis.wilco.org'].includes(url.hostname)) {
    return Response.json({ features: [] })
  }
  throw new Error(`Disposable CRM test blocked external request: ${url.origin}`)
}
require('./twilio-mock.cjs')
