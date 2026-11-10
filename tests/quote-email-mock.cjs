/* eslint-disable @typescript-eslint/no-require-imports -- Test-only provider boundary. */
const { readFileSync, appendFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')

const fetchLocal = globalThis.fetch
globalThis.fetch = async function (input, init) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(value)
  if (['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:') return fetchLocal(input, init)
  if (url.origin !== 'https://api.resend.com' || url.pathname !== '/emails' || init?.method !== 'POST') {
    throw new Error('Quote browser fixture blocked an external request')
  }
  if (process.env.RESEND_API_KEY !== 're_quote_browser_fixture' || !process.env.QG_QUOTE_PROVIDER_LOG) {
    throw new Error('Use the synthetic Resend key and a fixture log')
  }
  const key = new Headers(init.headers).get('Idempotency-Key')
  const body = JSON.parse(init.body)
  if (!key || [body.to].flat()[0] !== 'delivery@example.test') throw new Error('Missing send identity or local recipient')
  const log = process.env.QG_QUOTE_PROVIDER_LOG
  const attempts = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const prior = attempts.find(attempt => attempt.key === key)
  if (prior && JSON.stringify(prior.body) !== JSON.stringify(body)) throw new Error('A retry changed the frozen provider request')
  const id = prior?.id ?? randomUUID()
  appendFileSync(log, JSON.stringify({ key, id, body }) + '\n')
  // Simulate provider acceptance followed by a lost HTTP response. A stable
  // retry returns the original receipt and the logical email is sent once.
  if (!prior && body.text.includes('Introductory fixture email')) throw new Error('Synthetic lost provider response')
  return Response.json({ id })
}
