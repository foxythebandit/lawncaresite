// Claim race against the LOCAL test database only (PLAN.md 7.2b, R1, R2, R5).
// Run: node tests/phone-claim-race.mjs   (needs the qg-crm-test Supabase on 127.0.0.1:56421)
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
function localConfig() {
  if (existsSync('/tmp/qg-test-config.json')) {
    const cfg = JSON.parse(readFileSync('/tmp/qg-test-config.json', 'utf8'))
    return { url: cfg.API_URL, key: cfg.SERVICE_ROLE_KEY }
  }
  const env = Object.fromEntries(readFileSync(new URL('.env.local', root), 'utf8').split('\n')
    .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SECRET_KEY }
}
const { url, key } = localConfig()
if (url !== 'http://127.0.0.1:56421') throw new Error(`Refusing to run: ${url} is not the local test database`)

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
async function rest(path, body, method = 'POST') {
  const response = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const rpc = (name, args) => rest(`rpc/${name}`, args)
const sid = () => `CA${randomBytes(16).toString('hex')}`
const phone = i => `+1555${String(7000000 + i).padStart(7, '0')}`
const N = 24

async function newLead(label) {
  const [lead] = await rest('leads', { name: `TEST ${label}`, phone: '+15125550142', source: 'phone-race-test' })
  const [event] = await rest('intake_events', { source: 'phone-race-test', submission_id: randomUUID(), payload_hash: 'x', lead_id: lead.id })
  return { lead, event }
}

// 1. crm_claim_lead: N different staff phones press 1 at once.
{
  const { lead } = await newLead('claim race')
  const presses = Array.from({ length: N }, (_, i) => ({ name: `Staff${i}`, phone: phone(i), sid: sid() }))
  const results = await Promise.all(presses.map(p => rpc('crm_claim_lead', { p_lead_id: lead.id, p_staff_name: p.name, p_staff_phone: p.phone, p_call_sid: p.sid })))
  const winners = results.map((r, i) => ({ ...r, ...presses[i] })).filter(r => r.won)
  assert.equal(winners.length, 1, 'exactly one press wins')
  const winner = winners[0]
  assert.equal(winner.dial, true)
  assert.ok(results.every(r => r.taken_by === winner.name), 'every loser hears the winner name')
  assert.ok(results.filter(r => !r.won).every(r => r.dial === false), 'losers never dial')
  const retry = await rpc('crm_claim_lead', { p_lead_id: lead.id, p_staff_name: winner.name, p_staff_phone: winner.phone, p_call_sid: winner.sid })
  assert.deepEqual(retry, { won: true, dial: true, taken_by: winner.name }, 'retry of the winning leg dials (Twilio never got the reply)')
  const otherLeg = await rpc('crm_claim_lead', { p_lead_id: lead.id, p_staff_name: winner.name, p_staff_phone: winner.phone, p_call_sid: sid() })
  assert.deepEqual(otherLeg, { won: true, dial: false, taken_by: winner.name }, 'a different leg of the winner does not dial again')
  const taken = await rest(`lead_activities?lead_id=eq.${lead.id}&kind=eq.alert&outcome=eq.taken`, null, 'GET')
  assert.equal(taken.length, 1, 'one "taken" history row')
  console.log(`crm_claim_lead: ${N} concurrent presses -> 1 winner (${winner.name}), ${N - 1} lost; winner retry dial=true; winner other leg dial=false`)
}

// 2. crm_alert_press (the webhook RPC): N legs of one alert event press 1 at once.
{
  const { lead, event } = await newLead('press race')
  const legs = await Promise.all(Array.from({ length: N }, (_, i) =>
    rpc('crm_alert_leg_start', { p_lead_id: lead.id, p_event_id: event.id, p_staff_name: `Staff${i}`, p_staff_phone: phone(i) })))
  const again = await rpc('crm_alert_leg_start', { p_lead_id: lead.id, p_event_id: event.id, p_staff_name: 'Staff0', p_staff_phone: phone(0) })
  assert.equal(again.id, legs[0].id, 'one alert leg row per event and phone')
  const sids = legs.map(() => sid())
  const results = await Promise.all(legs.map((leg, i) => rpc('crm_alert_press', { p_call_id: leg.id, p_call_sid: sids[i], p_digit: '1', p_caller_id: phone(i) })))
  assert.equal(results.filter(r => r.won).length, 1)
  assert.equal(results.filter(r => r.dial).length, 1)
  const winner = results.find(r => r.won)
  assert.equal(winner.customer_phone, '+15125550142')
  const rows = await rest(`lead_calls?event_id=eq.${event.id}&leg=eq.alert`, null, 'GET')
  assert.equal(rows.filter(r => r.result === 'claimed').length, 1)
  assert.equal(rows.filter(r => r.result === 'lost_race').length, N - 1)
  assert.equal(rows.filter(r => r.caller_id).length, 1, 'only the dialing leg stores a caller ID')
  console.log(`crm_alert_press: ${N} concurrent legs -> 1 claimed, ${N - 1} lost_race, 1 dial`)
}

// 3. crm_finish_customer_leg: Twilio delivers the same dial result N times at once.
{
  const { lead } = await newLead('finish race')
  const dialSid = sid(), parent = sid()
  const results = await Promise.all(Array.from({ length: N }, () => rpc('crm_finish_customer_leg', {
    p_lead_id: lead.id, p_call_sid: dialSid, p_parent_call_sid: parent, p_staff_name: 'Caelan', p_staff_phone: phone(1),
    p_to_phone: '+15125550142', p_caller_id: phone(1), p_result: 'no_answer', p_duration: 0,
  }).catch(error => ({ error: String(error) }))))
  const errors = results.filter(r => r.error)
  assert.equal(results.filter(r => r.applied === true).length, 1, `applied once (${errors.length} errored: ${errors[0]?.error ?? ''})`)
  const [after] = await rest(`leads?id=eq.${lead.id}&select=call_attempts,board_column`, null, 'GET')
  assert.deepEqual(after, { call_attempts: 1, board_column: 'in_talks' })
  const history = await rest(`lead_activities?lead_id=eq.${lead.id}&kind=eq.phone`, null, 'GET')
  assert.equal(history.length, 1)
  console.log(`crm_finish_customer_leg: ${N} concurrent deliveries -> applied once (${errors.length} unique-violation retries), attempts=1, In talks`)
}

// 4. crm_alert_leg_status: every leg ends at the same moment; "Nobody took it" fires once.
{
  const { lead, event } = await newLead('nobody race')
  const legs = await Promise.all(Array.from({ length: N }, (_, i) =>
    rpc('crm_alert_leg_start', { p_lead_id: lead.id, p_event_id: event.id, p_staff_name: `Staff${i}`, p_staff_phone: phone(i) })))
  const sids = legs.map(() => sid())
  await Promise.all(legs.map((leg, i) => rpc('crm_alert_leg_status', { p_call_id: leg.id, p_call_sid: sids[i], p_status: 'ringing', p_duration: null })))
  const results = await Promise.all(legs.map((leg, i) => rpc('crm_alert_leg_status', { p_call_id: leg.id, p_call_sid: sids[i], p_status: 'no-answer', p_duration: 0 })))
  assert.equal(results.filter(r => r.not_taken).length, 1, 'exactly one callback sends "Nobody took it"')
  const history = await rest(`lead_activities?lead_id=eq.${lead.id}&kind=eq.alert&outcome=eq.not_taken`, null, 'GET')
  assert.equal(history.length, 1)
  const late = await rpc('crm_alert_leg_status', { p_call_id: legs[0].id, p_call_sid: sids[0], p_status: 'ringing', p_duration: null })
  assert.equal(late.not_taken, false)
  const [leg0] = await rest(`lead_calls?id=eq.${legs[0].id}&select=status,result`, null, 'GET')
  assert.deepEqual(leg0, { status: 'no-answer', result: 'no_answer' }, 'a late out-of-order callback does not reopen a finished leg')
  console.log(`crm_alert_leg_status: ${N} legs end at once -> "Nobody took it" exactly once`)
}
console.log('phone claim race: all checks passed')
