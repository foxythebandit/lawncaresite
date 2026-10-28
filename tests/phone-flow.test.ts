import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.CRM_BASE_URL = 'https://quietgreen.co'
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token'
process.env.TWILIO_FROM_NUMBER = '+15126435722'
process.env.CRON_SECRET = 'cron-secret-for-tests-0000000000'

const { twilioSignature, validTwilioSignature, verifiedTwilioParams, dialable, xml } = await import('../lib/phone/twilio')
const { answerTwiml, callerIdFor, dialOutcome, legRef, legUrls, pressTwiml } = await import('../lib/phone/flow')
const { cronAuthorized } = await import('../lib/phone/cron')

const ids = { call: '11111111-1111-4111-8111-111111111111', lead: '22222222-2222-4222-8222-222222222222', event: '33333333-3333-4333-8333-333333333333' }
const urls = legUrls(ids)

test('signature matches Twilio\'s published example (R12)', () => {
  const params: [string, string][] = [['CallSid', 'CA1234567890ABCDE'], ['Caller', '+14158675309'], ['Digits', '1234'], ['From', '+14158675309'], ['To', '+18005551212']]
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
  assert.equal(twilioSignature('12345', url, params), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')
  assert.equal(validTwilioSignature('12345', url, [...params].reverse(), 'RSOYDt4T1cUTdK1PDd93/VVr8B8='), true, 'param order on the wire does not matter')
  assert.equal(validTwilioSignature('12345', url, [...params.slice(0, 2), ['Digits', '1'], ...params.slice(3)], 'RSOYDt4T1cUTdK1PDd93/VVr8B8='), false, 'tampered param')
  assert.equal(validTwilioSignature('12345', 'https://evil.example/myapp.php?foo=1&bar=2', params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8='), false, 'wrong URL')
  assert.equal(validTwilioSignature('12345', url, params, null), false, 'unsigned')
  assert.equal(validTwilioSignature('12345', url, params, 'short'), false)
})

const form = (params: Record<string, string>) => new URLSearchParams(params).toString()
function signedRequest(path: string, params: Record<string, string>, options: { host?: string; sign?: string; tamper?: Record<string, string> } = {}) {
  const query = new URLSearchParams(ids).toString()
  const signed = `${options.sign ?? 'https://quietgreen.co'}${path}?${query}`
  const signature = twilioSignature('test-auth-token', signed, Object.entries(params))
  // Vercel may hand the function a different host than the public one; the public origin is what is signed.
  return new Request(`${options.host ?? 'https://lawncaresite-abc.vercel.app'}${path}?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: form({ ...params, ...options.tamper }),
  })
}

test('webhook params are verified against CRM_BASE_URL, not the request host', async () => {
  const params = { CallSid: `CA${'a'.repeat(32)}`, Digits: '1', To: '+15125550100' }
  assert.deepEqual(await verifiedTwilioParams(signedRequest('/api/twilio/press', params)), params)
  assert.equal(await verifiedTwilioParams(signedRequest('/api/twilio/press', params, { tamper: { Digits: '2' } })), null)
  assert.equal(await verifiedTwilioParams(signedRequest('/api/twilio/press', params, { sign: 'https://other.example' })), null)
})

test('every Twilio webhook answers 403 to unsigned or forged requests', async () => {
  const routes = await Promise.all(['alert', 'press', 'status', 'dial-result', 'recording'].map(async name =>
    [name, (await import(`../app/api/twilio/${name}/route`)).POST as (r: Request) => Promise<Response>] as const))
  for (const [name, POST] of routes) {
    const unsigned = new Request(`https://quietgreen.co/api/twilio/${name}?${new URLSearchParams(ids)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ CallSid: `CA${'b'.repeat(32)}`, Digits: '1' }) })
    assert.equal((await POST(unsigned)).status, 403, `${name} unsigned`)
    const forged = signedRequest(`/api/twilio/${name}`, { CallSid: `CA${'b'.repeat(32)}`, Digits: '2' }, { tamper: { Digits: '1' } })
    assert.equal((await POST(forged)).status, 403, `${name} tampered`)
  }
})

test('leg IDs come only from well-formed UUIDs in the URL', () => {
  assert.deepEqual(legRef(urls.press), ids)
  assert.equal(legRef('https://quietgreen.co/api/twilio/press?call=1&lead=2&event=3'), null)
  assert.equal(urls.answer, `https://quietgreen.co/api/twilio/alert?lead=${ids.lead}&event=${ids.event}&call=${ids.call}`)
})

test('answer: prompt asked twice then hang up; already taken says who has it (R3)', () => {
  const prompt = 'New lead. Jane S., Round Rock, mowing. Press 1 to call them now. Press 2 to pass.'
  const ask = `<Gather input="dtmf" numDigits="1" timeout="5" action="${xml(urls.press)}" method="POST"><Say>${prompt}</Say></Gather>`
  assert.equal(answerTwiml({ takenBy: null, mine: false, prompt, pressUrl: urls.press }),
    `<?xml version="1.0" encoding="UTF-8"?><Response>${ask}${ask}<Hangup/></Response>`)
  assert.equal(answerTwiml({ takenBy: 'Paxton', mine: false, prompt, pressUrl: urls.press }),
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Paxton has it.</Say><Hangup/></Response>')
  assert.match(answerTwiml({ takenBy: 'Caelan', mine: true, prompt, pressUrl: urls.press }), /<Gather/)
  assert.match(answerTwiml({ takenBy: null, mine: false, prompt: 'Jane & <Bob>', pressUrl: urls.press }), /<Say>Jane &amp; &lt;Bob&gt;<\/Say>/)
})

test('press 1 winner is connected inside the same call with the verified caller ID, recorded (R4, P3)', () => {
  const out = pressTwiml({ digit: '1', claim: { won: true, dial: true, taken_by: 'Caelan' }, mode: 'twilio', customer: '+15125550142', callerId: '+19798886158', urls })
  assert.equal(out, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you.</Say>'
    + `<Dial callerId="+19798886158" record="record-from-answer-dual" recordingStatusCallback="${xml(urls.recording)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${xml(urls.dialResult)}" method="POST"><Number>+15125550142</Number></Dial></Response>`)
})

test('press 1 loser, duplicate press, dial-yourself, no phone, press 2 and other keys', () => {
  const base = { mode: 'twilio' as const, customer: '+15125550142', callerId: '+15126435722', urls }
  assert.equal(pressTwiml({ ...base, digit: '1', claim: { won: false, dial: false, taken_by: 'Paxton' } }),
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Paxton has it.</Say><Hangup/></Response>')
  assert.doesNotMatch(pressTwiml({ ...base, digit: '1', claim: { won: true, dial: false, taken_by: 'Caelan' } }), /<Dial/, 'never dials twice (R2)')
  assert.equal(pressTwiml({ ...base, mode: 'dial-yourself', digit: '1', claim: { won: true, dial: true, taken_by: 'Caelan' } }),
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>It&apos;s yours. Call them from your phone.</Say><Hangup/></Response>')
  assert.doesNotMatch(pressTwiml({ ...base, customer: null, digit: '1', claim: { won: true, dial: true, taken_by: 'Caelan' } }), /<Dial/)
  assert.equal(pressTwiml({ ...base, digit: '2' }), '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
  assert.equal(pressTwiml({ ...base, digit: '7' }), `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${xml(urls.answer)}</Redirect></Response>`)
})

test('caller ID is the claimer\'s cell only when verified; otherwise the alert line (R14)', () => {
  process.env.TWILIO_VERIFIED_CALLER_IDS = '+19798886158, +16823528260'
  assert.equal(callerIdFor('+19798886158'), '+19798886158')
  assert.equal(callerIdFor('+15550001111'), '+15126435722')
  delete process.env.TWILIO_VERIFIED_CALLER_IDS
  assert.equal(callerIdFor('+19798886158'), '+15126435722')
})

test('DialCallStatus mapping (7.2, E4, R11)', () => {
  assert.equal(dialOutcome('completed', '240'), 'talked')
  assert.equal(dialOutcome('answered', 12), 'talked')
  assert.equal(dialOutcome('completed', '0'), 'no_answer')
  assert.equal(dialOutcome('no-answer', '0'), 'no_answer')
  assert.equal(dialOutcome('busy', undefined), 'busy')
  assert.equal(dialOutcome('failed', undefined), 'failed')
  assert.equal(dialOutcome('canceled', '0'), 'hung_up_early')
  assert.equal(dialOutcome('ringing', '0'), null)
})

test('only dialable customer numbers are called (E8)', () => {
  assert.equal(dialable('(512) 555-0142'), '+15125550142')
  assert.equal(dialable('1-512-555-0142'), '+15125550142')
  assert.equal(dialable('+15125550142'), '+15125550142')
  assert.equal(dialable('+44 20 7946 0958'), '+442079460958')
  assert.equal(dialable('555-0142'), null)
  assert.equal(dialable('call me'), null)
  assert.equal(dialable(''), null)
})

test('cron requires the exact bearer secret', async () => {
  assert.equal(cronAuthorized('Bearer cron-secret-for-tests-0000000000'), true)
  assert.equal(cronAuthorized('Bearer cron-secret-for-tests-0000000001'), false)
  assert.equal(cronAuthorized('cron-secret-for-tests-0000000000'), false)
  assert.equal(cronAuthorized(null), false)
  assert.equal(cronAuthorized('Bearer short', 'short'), false, 'a short secret is refused')
  assert.equal(cronAuthorized('Bearer ', ''), false)
  const { GET } = await import('../app/api/cron/phone/route')
  assert.equal((await GET(new Request('https://quietgreen.co/api/cron/phone'))).status, 401)
  assert.equal((await GET(new Request('https://quietgreen.co/api/cron/phone', { headers: { Authorization: 'Bearer wrong' } }))).status, 401)
})
