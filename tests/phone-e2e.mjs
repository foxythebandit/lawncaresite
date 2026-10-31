// End-to-end press-1 flow against a local dev server (port 3202) and the LOCAL test database.
// Twilio is mocked at the fetch boundary by tests/phone-network-guard.cjs; every webhook request
// below is signed exactly as Twilio signs it. Run: node tests/phone-e2e.mjs
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = Object.fromEntries(readFileSync(`${root}.env.local`, 'utf8').split('\n')
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:56421') throw new Error('Refusing to run: .env.local is not the local test database')

const BASE = 'http://localhost:3202'
const CAELAN = '+15005550009', PAXTON = '+15005550010'
const LOG = `/tmp/qg-phone-e2e-${process.pid}.log`
const overrides = {
  CRM_BASE_URL: BASE, STAFF_SMS_ENABLED: 'true', STAFF_VOICE_ENABLED: 'true',
  TWILIO_STAFF_PHONES: `${CAELAN},${PAXTON}`, STAFF_PEOPLE: `Caelan:${CAELAN}:staff@example.test,Paxton:${PAXTON}:paxton@example.test`,
  TWILIO_VERIFIED_CALLER_IDS: CAELAN, CRON_SECRET: 'local-phone-e2e-cron-secret-000000', CONNECT_MODE: 'twilio', QG_PHONE_LOG: LOG,
}
const TOKEN = env.TWILIO_AUTH_TOKEN, FROM = env.TWILIO_FROM_NUMBER
writeFileSync(LOG, '')

const db = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' }
async function rest(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...db, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const sid = (p = 'CA') => `${p}${randomBytes(16).toString('hex')}`
const twilio = () => readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => {
  const entry = JSON.parse(line); return { ...entry, fields: new URLSearchParams(entry.body) }
})
async function waitFor(what, check, ms = 20000) {
  const end = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, 250))
  }
}
function sign(url, params) {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', TOKEN).update(data).digest('base64')
}
async function webhook(url, params, signature = sign(url, params)) {
  const response = await fetch(url, { method: 'POST', body: new URLSearchParams(params),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(signature ? { 'X-Twilio-Signature': signature } : {}) } })
  return { status: response.status, text: await response.text() }
}
async function intake(name, phone) {
  const fixture = JSON.parse(readFileSync(`${root}tests/fixtures/canonical-intake.json`, 'utf8'))
  fixture.submission_id = `phone-e2e-${randomUUID()}`
  fixture.contact = { ...fixture.contact, name, phone }
  const response = await fetch(`${BASE}/api/intake`, { method: 'POST', body: JSON.stringify(fixture),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INTAKE_WEBHOOK_SECRET}` } })
  assert.equal(response.status, 201)
  return response.json()
}
/** The two alert calls Twilio was asked to place for this event, with their webhook URLs. */
async function legs(eventId) {
  const calls = await waitFor('two alert calls', () => {
    const found = twilio().filter(e => e.path.endsWith('/Calls.json') && e.fields.get('Url')?.includes(eventId))
    return found.length === 2 ? found : null
  })
  const rows = await waitFor('call SIDs saved', async () => {
    const r = await rest(`lead_calls?event_id=eq.${eventId}&leg=eq.alert&select=id,staff_phone,call_sid`)
    return r.length === 2 && r.every(x => x.call_sid) ? r : null
  })
  return Object.fromEntries(calls.map(c => {
    const to = c.fields.get('To'), row = rows.find(r => r.staff_phone === to)
    const answer = c.fields.get('Url')
    return [to === CAELAN ? 'caelan' : 'paxton', { to, sid: row.call_sid, id: row.id, fields: c.fields, answer,
      press: answer.replace('/alert?', '/press?'), status: c.fields.get('StatusCallback'),
      dialResult: answer.replace('/alert?', '/dial-result?'), recording: answer.replace('/alert?', '/recording?') }]
  }))
}
const texts = (to, includes) => twilio().filter(e => e.path.endsWith('/Messages.json') && e.fields.get('To') === to && (e.fields.get('Body') ?? '').includes(includes))

// Server
const server = spawn(process.execPath, [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', '3202'], {
  cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ...overrides, NODE_OPTIONS: `--require ${root}tests/phone-network-guard.cjs` },
})
let serverLog = ''
server.stdout.on('data', d => { serverLog += d }); server.stderr.on('data', d => { serverLog += d })
const stop = () => { try { process.kill(-server.pid, 'SIGTERM') } catch { /* already stopped */ } }
process.on('exit', stop)

try {
  await waitFor('dev server', async () => (await fetch(`${BASE}/api/cron/phone`).catch(() => null))?.status === 401, 120000)

  // 1. New lead: both texts and both rings start together (7.2, P4, R7, R10). Press 1 wins, connects, no answer.
  const one = await intake('Jane Phoneflow', '(512) 555-0142')
  const a = await legs(one.event_id)
  for (const leg of [a.caelan, a.paxton]) {
    assert.equal(leg.fields.get('Timeout'), '20')
    assert.deepEqual(leg.fields.getAll('StatusCallbackEvent'), ['initiated', 'ringing', 'answered', 'completed'])
    assert.equal(leg.fields.get('MachineDetection'), null)
    assert.equal(texts(leg.to, 'NEW LEAD · Jane Phoneflow').length, 1)
  }
  assert.equal(twilio().filter(e => e.fields.get('MediaUrl')).length, 0, 'ConviFlo lead without a map: plain text only (7.7 check 9)')
  const unsigned = await webhook(a.caelan.answer, { CallSid: a.caelan.sid }, null)
  assert.equal(unsigned.status, 403)
  assert.equal((await webhook(a.caelan.press, { CallSid: a.caelan.sid, Digits: '1' }, sign(a.caelan.press, { CallSid: a.caelan.sid, Digits: '2' }))).status, 403)

  const answer = await webhook(a.caelan.answer, { CallSid: a.caelan.sid, To: CAELAN, CallStatus: 'in-progress' })
  assert.match(answer.text, /<Gather[^>]*numDigits="1"[^>]*><Say>New lead\. Jane P\., Austin, mowing\. Press 1 to call them now\. Press 2 to pass\.<\/Say><\/Gather><Gather/)
  await webhook(a.caelan.status, { CallSid: a.caelan.sid, CallStatus: 'in-progress' })
  await webhook(a.paxton.status, { CallSid: a.paxton.sid, CallStatus: 'ringing' })

  const press = await webhook(a.caelan.press, { CallSid: a.caelan.sid, To: CAELAN, Digits: '1' })
  assert.match(press.text, /<Say>Connecting you\.<\/Say><Dial callerId="\+15005550009" record="record-from-answer-dual"/)
  assert.match(press.text, /<Number>\+15125550142<\/Number>/)
  await waitFor('other ring canceled (R3)', () => twilio().some(e => e.path.endsWith(`/Calls/${a.paxton.sid}.json`) && e.fields.get('Status') === 'canceled'))
  await waitFor('claimed text to Paxton', () => texts(PAXTON, 'Caelan took Jane Phoneflow (512) 555-0142').length === 1)
  assert.equal(texts(CAELAN, 'Caelan took').length, 0)

  const lost = await webhook(a.paxton.press, { CallSid: a.paxton.sid, To: PAXTON, Digits: '1' })
  assert.match(lost.text, /<Say>Caelan has it\.<\/Say><Hangup\/>/)
  assert.match((await webhook(a.paxton.answer, { CallSid: a.paxton.sid, To: PAXTON })).text, /<Say>Caelan has it\.<\/Say>/)
  const retry = await webhook(a.caelan.press, { CallSid: a.caelan.sid, To: CAELAN, Digits: '1' })
  assert.match(retry.text, /<Dial/, 'retry of the winning leg dials (Twilio never got the reply)')
  await new Promise(r => setTimeout(r, 1000))
  assert.equal(texts(PAXTON, 'Caelan took').length, 1, 'claimed text sent once (R2)')

  const dialSid = sid()
  const dialed = await webhook(a.caelan.dialResult, { CallSid: a.caelan.sid, DialCallSid: dialSid, DialCallStatus: 'no-answer', DialCallDuration: '0' })
  assert.match(dialed.text, /<Hangup\/>/)
  await webhook(a.caelan.dialResult, { CallSid: a.caelan.sid, DialCallSid: dialSid, DialCallStatus: 'no-answer', DialCallDuration: '0' })
  const [lead1] = await rest(`leads?id=eq.${one.lead_id}&select=taken_by,taken_by_phone,call_attempts,board_column`)
  assert.deepEqual(lead1, { taken_by: 'Caelan', taken_by_phone: CAELAN, call_attempts: 1, board_column: 'in_talks' }, '7.7 check 3')
  const [customer1] = await rest(`lead_calls?call_sid=eq.${dialSid}&select=leg,result,caller_id,parent_call_sid`)
  assert.deepEqual(customer1, { leg: 'customer', result: 'no_answer', caller_id: CAELAN, parent_call_sid: a.caelan.sid })
  await webhook(a.paxton.status, { CallSid: a.paxton.sid, CallStatus: 'canceled' })
  await webhook(a.caelan.status, { CallSid: a.caelan.sid, CallStatus: 'completed', CallDuration: '40' })
  console.log('ok 1 new lead: texts + rings together, press 1 wins, other ring canceled, claimed text once, no answer -> In talks')

  // 2. Paxton (caller ID not verified) takes it, talks 95 s, recording arrives before the dial result; reminder after 30 min.
  const two = await intake('Mo Talker', '512-555-0177')
  const b = await legs(two.event_id)
  const pressB = await webhook(b.paxton.press, { CallSid: b.paxton.sid, To: PAXTON, Digits: '1' })
  assert.match(pressB.text, new RegExp(`<Dial callerId="\\${FROM}"`), 'R14: unverified cell falls back to the alert line')
  await waitFor('claimed text to Caelan', () => texts(CAELAN, 'Paxton took Mo Talker').length === 1)
  const talkSid = sid(), recSid = sid('RE')
  await webhook(b.paxton.recording, { CallSid: b.paxton.sid, RecordingSid: recSid, RecordingStatus: 'completed', RecordingDuration: '95' })
  await webhook(b.paxton.dialResult, { CallSid: b.paxton.sid, DialCallSid: talkSid, DialCallStatus: 'completed', DialCallDuration: '95' })
  const [customer2] = await rest(`lead_calls?call_sid=eq.${talkSid}&select=id,result,duration_seconds,recording_sid,caller_id`)
  assert.deepEqual({ ...customer2, id: undefined }, { id: undefined, result: 'talked', duration_seconds: 95, recording_sid: recSid, caller_id: FROM })
  const [lead2] = await rest(`leads?id=eq.${two.lead_id}&select=needs_call_log_at,call_attempts`)
  assert.ok(lead2.needs_call_log_at, '7.7 check 4: Log this call banner')
  assert.equal((await fetch(`${BASE}/api/twilio/recordings/${customer2.id}`)).status, 401, 'recordings are staff-only')
  assert.equal((await fetch(`${BASE}/api/cron/phone`, { headers: { Authorization: 'Bearer nope' } })).status, 401)
  const cron = () => fetch(`${BASE}/api/cron/phone`, { headers: { Authorization: `Bearer ${overrides.CRON_SECRET}` } })
  assert.equal((await cron()).status, 200)
  assert.equal(texts(PAXTON, 'Log your call with Mo Talker').length, 0, 'not due yet')
  await rest(`leads?id=eq.${two.lead_id}`, { needs_call_log_at: new Date(Date.now() - 31 * 60000).toISOString() }, 'PATCH')
  assert.equal((await cron()).status, 200)
  await waitFor('reminder to claimer', () => texts(PAXTON, 'Log your call with Mo Talker').length === 1)
  await cron()
  assert.equal(texts(PAXTON, 'Log your call with Mo Talker').length, 1, 'reminder once')
  assert.equal(texts(CAELAN, 'Log your call with Mo Talker').length, 0)
  console.log('ok 2 unverified caller ID fallback, talked + recording, staff-only recording route, cron auth, reminder once')

  // 3. Caelan presses 2, Paxton doesn't answer: "Nobody took it" to both, once (R5, P1, 7.7 check 5).
  const three = await intake('Nora Nobody', '512-555-0188')
  const c = await legs(three.event_id)
  assert.match((await webhook(c.caelan.press, { CallSid: c.caelan.sid, To: CAELAN, Digits: '2' })).text, /^<\?xml[^>]*><Response><Hangup\/><\/Response>$/)
  await webhook(c.paxton.status, { CallSid: c.paxton.sid, CallStatus: 'no-answer' })
  assert.equal(texts(CAELAN, 'Nobody took Nora Nobody').length, 0, 'not until every leg ended')
  await Promise.all([
    webhook(c.caelan.status, { CallSid: c.caelan.sid, CallStatus: 'completed', CallDuration: '12' }),
    webhook(c.caelan.status, { CallSid: c.caelan.sid, CallStatus: 'completed', CallDuration: '12' }),
  ])
  await waitFor('nobody texts', () => texts(CAELAN, 'Nobody took Nora Nobody').length === 1 && texts(PAXTON, 'Nobody took Nora Nobody').length === 1)
  await new Promise(r => setTimeout(r, 1000))
  assert.equal(texts(CAELAN, 'Nobody took Nora Nobody').length, 1)
  const passed = await rest(`lead_activities?lead_id=eq.${three.lead_id}&kind=eq.alert&select=outcome,data`)
  assert.deepEqual(passed.map(p => p.outcome).sort(), ['not_taken', 'passed'])
  console.log('ok 3 press 2 passes; last leg ending sends "Nobody took it" to both once')

  // 4. TEST lead rings nobody (E20, 7.7 check 8); an undialable phone: text only (E8). The summary
  // prints "No valid phone" only when the phone is empty; an undialable one is shown as typed.
  const four = await intake('TEST Phone E2E', '(512) 555-0199')
  const five = await intake('Nina Nophone', '555-0142')
  for (const [event, tag] of [[four.event_id, '[TEST] NEW LEAD'], [five.event_id, '555-0142']]) {
    const voice = await waitFor('voice skipped', async () => {
      const rows = await rest(`staff_alerts?event_id=eq.${event}&channel=eq.voice&select=state,error_code`)
      return rows.length === 2 && rows.every(r => r.state === 'skipped') ? rows : null
    })
    assert.ok(voice.every(r => r.error_code === (tag.startsWith('[TEST]') ? 'test_lead' : 'no_valid_phone')))
    await waitFor('texts', () => texts(CAELAN, tag).length >= 1 && texts(PAXTON, tag).length >= 1)
    assert.equal(twilio().filter(e => e.path.endsWith('/Calls.json') && e.fields.get('Url')?.includes(event)).length, 0)
  }
  console.log('ok 4 TEST lead and no-phone lead: texts only, no rings')

  // 5. Same lead books online again (E10, 7.7 check 7). Claimed -> only the claimer is texted, no ring.
  const rpc = (args) => rest('rpc/record_intake_v3', { p_hash: randomUUID(), p_lead: {}, p_recipients: [CAELAN, PAXTON], ...args })
  const booking = { name: 'Jane Phoneflow', phone: '(512) 555-0142', address: '807 E 47th St, Austin, TX', preferred_date: '2026-11-03',
    preferred_time: 'Morning', frequency: 'Bi-weekly', price_per_visit: 45, first_visit_price: 32, overgrowth_fee: 0 }
  const claimed = await rpc({ p_source: 'website-booking', p_submission: `e10-${randomUUID()}`, p_booking: booking, p_existing_lead: one.lead_id })
  assert.equal(claimed.claimed_by_phone, CAELAN)
  assert.equal((await rest(`staff_alerts?event_id=eq.${claimed.event_id}`)).length, 0, 'no ring, no alert to both')
  const child = spawnSync(process.execPath, ['--import', './tests/ts-resolve.mjs', '--input-type=module', '-e',
    `const m = await import('./lib/phone/legs.ts'); await m.notifyBookedOnline(${JSON.stringify(one.lead_id)}, ${JSON.stringify(claimed.event_id)}, ${JSON.stringify(CAELAN)})`],
  { cwd: root, encoding: 'utf8', env: { ...process.env, ...env, ...overrides, NODE_OPTIONS: `--require ${root}tests/phone-network-guard.cjs` } })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(texts(CAELAN, 'Jane Phoneflow just booked online: Tue Nov 3 · morning · $45/visit').length, 1)
  assert.equal(texts(PAXTON, 'just booked online').length, 0)
  // Not claimed -> normal flow to both, worded as a booking request.
  const open = await rpc({ p_source: 'website-booking', p_submission: `e10-${randomUUID()}`, p_booking: { ...booking, name: 'Nora Nobody', phone: '512-555-0188' }, p_existing_lead: three.lead_id })
  assert.equal(open.claimed_by_phone, null)
  assert.equal((await rest(`staff_alerts?event_id=eq.${open.event_id}&state=eq.pending`)).length, 4)
  assert.equal((await cron()).status, 200)
  await waitFor('booking request texts', () => texts(CAELAN, 'BOOKING REQUEST · Nora Nobody').length === 1 && texts(PAXTON, 'BOOKING REQUEST · Nora Nobody').length === 1)
  const d = await legs(open.event_id)
  assert.match((await webhook(d.caelan.answer, { CallSid: d.caelan.sid, To: CAELAN })).text, /<Say>Booking request\. Nora N\. wants Tuesday morning, mowing\./)
  console.log('ok 5 E10: claimed lead texts only the claimer; unclaimed rings both as a booking request (via the cron recovery sweep)')

  // 6. Outcome logged by Caelan (staff@example.test) -> text to the other person only (S19); retry sends nothing new.
  const logged = await rest('rpc/crm_log_call', { p_lead_id: two.lead_id, p_operation_id: randomUUID(), p_outcome: 'booked',
    p_detail: { price_cents: 4500, frequency: 'biweekly', first_visit_on: '2026-11-03' }, p_actor_email: 'staff@example.test' })
  const notify = (actor) => spawnSync(process.execPath, ['--import', './tests/ts-resolve.mjs', '--input-type=module', '-e',
    `const m = await import('./lib/phone/notify.ts'); await m.notifyCallLogged(${JSON.stringify(two.lead_id)}, ${JSON.stringify(logged.activity_id)}, ${JSON.stringify(actor)})`],
  { cwd: root, encoding: 'utf8', env: { ...process.env, ...env, ...overrides, NODE_OPTIONS: `--require ${root}tests/phone-network-guard.cjs` } })
  for (const actor of ['staff@example.test', 'staff@example.test', 'stranger@example.test']) assert.equal(notify(actor).status, 0)
  assert.equal(texts(PAXTON, 'Mo Talker: 🟢 Booked Tue Nov 3 · $45/visit').length, 1)
  assert.equal(texts(CAELAN, 'Mo Talker: 🟢').length, 0)
  console.log('ok 6 call outcome texted to the other person once; unknown actor texts nobody')

  console.log('phone e2e: all checks passed')
} catch (error) {
  console.error(serverLog.split('\n').slice(-40).join('\n'))
  throw error
} finally {
  stop()
}
