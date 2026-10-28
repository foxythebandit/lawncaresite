/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload executes as CommonJS. */
// Test-only preload for tests/phone-e2e.mjs. Never imported by application code.
// Mocks every api.twilio.com request (logged to QG_PHONE_LOG) and refuses any other external host.
const fs = require('node:fs')
const crypto = require('node:crypto')
const log = process.env.QG_PHONE_LOG
if (!log || !/^\/(private\/)?tmp\//.test(log)) throw new Error('QG_PHONE_LOG must be a temporary file')
const original = globalThis.fetch
const hex = () => crypto.randomBytes(16).toString('hex')

globalThis.fetch = async function (input, init) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(value)
  if (['localhost', '127.0.0.1'].includes(url.hostname) && ['3202', '56421'].includes(url.port)) return original(input, init)
  if (url.hostname !== 'api.twilio.com') throw new Error(`Phone e2e blocked external request: ${url.origin}`)
  const method = init?.method ?? 'GET'
  const body = init?.body ? String(init.body) : ''
  fs.appendFileSync(log, JSON.stringify({ method, path: url.pathname, body }) + '\n')
  const fields = new URLSearchParams(body)
  const update = url.pathname.match(/\/Calls\/(CA[0-9a-f]{32})\.json$/)
  if (update) return Response.json({ sid: update[1], status: fields.get('Status') === 'canceled' ? 'canceled' : 'in-progress' })
  if (method === 'POST' && url.pathname.endsWith('/Calls.json')) return Response.json({ sid: `CA${hex()}`, status: 'queued' }, { status: 201 })
  if (method === 'POST' && url.pathname.endsWith('/Messages.json')) return Response.json({ sid: `SM${hex()}`, status: 'queued' }, { status: 201 })
  if (method === 'GET' && /\/Recordings\/RE[0-9a-f]{32}\.mp3$/.test(url.pathname)) {
    return new Response('ID3-fake-audio', { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '14' } })
  }
  return Response.json({ code: 20404 }, { status: 404 })
}
