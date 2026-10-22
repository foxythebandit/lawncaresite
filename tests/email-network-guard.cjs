/* eslint-disable @typescript-eslint/no-require-imports -- Test-only Node preload. */
// Isolated email test allows only the disposable database and local provider mock.
const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(value)
  if (url.hostname === '127.0.0.1' && ['56421', '3188'].includes(url.port)) {
    return originalFetch(input, init)
  }
  throw new Error(`Disposable email test blocked external request: ${url.origin}`)
}
