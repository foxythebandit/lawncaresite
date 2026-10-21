/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload executes as CommonJS. */
// Test-only network boundary. Never imported by application code.
const fs = require('node:fs')
const original = globalThis.fetch
globalThis.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://api.twilio.com/')) return original(input, init)
  fs.appendFileSync(process.env.QG_SMS_LOG, JSON.stringify({ method: init?.method ?? 'GET', body: String(init?.body ?? '') }) + '\n')
  const mode = fs.readFileSync(process.env.QG_SMS_MODE, 'utf8').trim()
  if (mode === 'timeout') throw new Error('Simulated transport failure')
  if (mode === 'reject') return Response.json({ code: 21608 }, { status: 400 })
  return Response.json({ sid: init?.method === 'POST' ? 'SM' + require('node:crypto').randomBytes(16).toString('hex') : url.match(/(SM[0-9a-f]{32})/)[1], status: init?.method === 'POST' ? 'queued' : 'delivered' }, { status: init?.method === 'POST' ? 201 : 200 })
}
