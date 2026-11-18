import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, before, after, test } from 'node:test'

// Resend's SDK reads RESEND_BASE_URL when it loads, so the mock has to be up before the import.
const received: Record<string, unknown>[] = []
let server: Server
let sendEmail: typeof import('../lib/email').sendEmail

before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      received.push(JSON.parse(body))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-email' }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.RESEND_API_KEY = 're_fake'
  sendEmail = (await import('../lib/email')).sendEmail
})
after(() => { server.close() })
afterEach(() => {
  received.length = 0
  delete process.env.EMAIL_DEV_RECIPIENT
})

const message = { from: 'QuietGreen <hello@quietgreen.co>', to: 'customer@example.test', cc: 'other@example.test', subject: 'Your quote', html: '<p>hi</p>' }

test('without EMAIL_DEV_RECIPIENT the email goes out exactly as given (production)', async () => {
  await sendEmail(message)
  assert.equal(received.length, 1)
  assert.deepEqual(received[0].to, 'customer@example.test')
  assert.equal(received[0].cc, 'other@example.test')
  assert.equal(received[0].subject, 'Your quote')
})

test('with EMAIL_DEV_RECIPIENT only that address gets it, and the subject names the original', async () => {
  process.env.EMAIL_DEV_RECIPIENT = 'me@example.test'
  await sendEmail(message)
  assert.equal(received.length, 1)
  assert.deepEqual(received[0].to, 'me@example.test')
  assert.equal(received[0].cc, undefined)
  assert.equal(received[0].subject, '[to customer@example.test] Your quote')
})
