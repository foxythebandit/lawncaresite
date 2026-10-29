#!/usr/bin/env node
// Realistic demo leads for judging the CRM on a LOCAL database (never production).
//
//   node scripts/seed-demo-leads.mjs            wipe the local CRM tables, then seed ~33 demo leads
//
// Wipes leads, bookings, customers, properties, plans, alerts, calls and activities, then writes
// leads across all six board columns with times relative to now, so it can be rerun any time.
// Rows are written directly with explicit timestamps; each step mirrors what the real code writes
// (website/ConviFlo intake, alert legs and press 1, crm_log_call, crm_move_lead, the Booked path).
// Prices use the website quote builder's formula (components/MapQuoteBuilder.tsx calcPrice).
// Phone numbers are fictional (555-01xx) and emails use example.com.
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the environment or .env.local.
import { readFileSync, existsSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const envFile = new URL('../.env.local', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.'); process.exit(1) }
const { hostname } = new URL(url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
  console.error(`Refusing to seed ${url}: this script only runs against a local Supabase (127.0.0.1 or localhost).`)
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/* ── Time ─────────────────────────────────────────────── */
const NOW = Date.now(), H = 60, D = 24 * 60
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString()
const chicagoDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
/** Calendar day in Austin, `n` days from today. */
const day = (n) => chicagoDay(NOW + n * 86400000)
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const addMonths = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }

/* ── Prices (same formula as the website quote builder) ── */
const MOW_TIERS = [{ upTo: 5000, rate: 0.0198 }, { upTo: 12000, rate: 0.0143 }, { upTo: Infinity, rate: 0.0099 }]
function basePrice(sqFt) {
  let price = 75, from = 2250
  for (const { upTo, rate } of MOW_TIERS) { if (sqFt <= from) break; price += (Math.min(sqFt, upTo) - from) * rate; from = upTo }
  return Math.round(price)
}
const DISCOUNT = { weekly: 15, biweekly: 10, monthly: 0, onetime: 0 }
const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly', onetime: 'One-time' }
const PLAN = { weekly: { unit: 'week', count: 1, days: 7 }, biweekly: { unit: 'week', count: 2, days: 14 }, monthly: { unit: 'month', count: 1 } }
function offer(sqFt, freq) {
  const price = Math.round(basePrice(sqFt) * (1 - DISCOUNT[freq] / 100))
  return { price, first: Math.round(price * 0.7) }
}

/* ── People, places, ads ──────────────────────────────── */
const STAFF = { Caelan: { phone: '+15125550198', email: 'caelan@example.com' }, Paxton: { phone: '+15125550199', email: 'paxton@example.com' } }
const CITY = {
  roundrock: [30.5083, -97.6789], cedarpark: [30.5052, -97.8203], pflugerville: [30.4394, -97.62], north: [30.396, -97.728],
  south: [30.205, -97.792], east: [30.27, -97.71], libertyhill: [30.6649, -97.9225],
}
const AD = {
  'AI-V01': '120253769117370725', 'AI-V02': '120253769229100725', 'AI-V03': '120253769229110725', 'AI-I01': '120253769229120725',
  'AI-I02': '120253769229130725', 'AI-I03': '120253769229140725', 'REAL-V01': '120253769297420725', 'REAL-V02': '120253769297460725',
  'REAL-V03': '120253769297470725', 'REAL-I01': '120253769297440725', 'REAL-I02': '120253769297430725', 'REAL-I03': '120253769297480725',
}
const META_CAMPAIGN = '120253769117350725'
const CONVIFLO_FORM = { mowing: 'ae7c0184-fa95-40d4-8b74-cd8578083470', leaves: 'b521838c-6883-46d3-9e07-22a78a374ab4' }
const CONVIFLO_SLUG = { mowing: 'yhttwh8p', leaves: 'quietgreen-leaves-gutters' }
const CONSENT = "I agree to receive calls and texts from QuietGreen about my quote at the number above, including by autodialer. Consent isn't required to make a purchase. Msg & data rates may apply. Reply STOP to opt out."

const hex = (n) => randomBytes(n).toString('hex')
const callSid = () => `CA${hex(16)}`
const phoneOf = (n) => `+1512555${String(n).padStart(4, '0')}`

function touchFor(source, at) {
  if (!source) return {}
  if (source.startsWith('google-ads')) return { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'austin-quiet-mowing', gclid: `Cj0KCQjw${hex(10)}`, captured_at: at }
  if (source === 'google') return { utm_source: 'google', utm_medium: 'organic', captured_at: at }
  const id = AD[source]
  return { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: META_CAMPAIGN, utm_content: id, meta_ad_id: id, fbclid: `IwAR${hex(12)}`, captured_at: at }
}

/** Two rectangles (front and back) adding up to `sqFt`, as [lng, lat] like the map builder saves them. */
function tracing([lat, lng], sqFt, seed) {
  const jitter = ((seed * 7919) % 100) / 100000
  const box = (name, area, north) => {
    const m2 = area * 0.0929, w = Math.sqrt(m2 * 1.6), h = m2 / w
    const dLat = h / 111320, dLng = w / (111320 * Math.cos(lat * Math.PI / 180))
    const top = lat + jitter + (north ? dLat + 0.00004 : 0), left = lng + jitter
    const r = (v) => Math.round(v * 1e6) / 1e6
    return { name, sqFt: Math.round(area), coords: [[r(left), r(top)], [r(left + dLng), r(top)], [r(left + dLng), r(top - dLat)], [r(left), r(top - dLat)]] }
  }
  const front = Math.round(sqFt * 0.42)
  return [box('Front', front, true), box('Back', sqFt - front, false)]
}

/* ── The demo leads ───────────────────────────────────────
   age: minutes since the lead came in. Event times are minutes after that.
   alert legs: claimed / passed / lost_race / no_answer / busy / canceled (rang, stopped after a claim).
   customer leg: talked (seconds) / no_answer / hung_up_early / failed.                                  */
const LEADS = [
  // New
  { n: 101, name: 'Megan Carter', email: true, kind: 'map', city: 'roundrock', address: '2104 Sundown Trail, Round Rock, TX 78664', sq: 6800, freq: 'biweekly', ad: 'AI-V01', age: 11,
    events: [['alert', 0.3, [['Caelan', 'no_answer'], ['Paxton', 'no_answer']]]] },
  { n: 102, name: null, kind: 'conviflo', form: 'mowing', zip: '78660', ad: 'AI-I01', age: 38,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: 'under_1_4_acre', urgency: 'this_week', lawn_condition: 'a_little_overgrown' },
    events: [['alert', 0.3, [['Paxton', 'passed'], ['Caelan', 'no_answer']]]] },
  { n: 103, name: 'Priya Raman', email: true, kind: 'map', city: 'north', address: '9213 Topridge Dr, Austin, TX 78750', sq: 4300, freq: 'weekly', ad: 'google-ads', age: 52,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 372]]] },
  { n: 104, name: 'Daniel Nguyen', kind: 'conviflo', form: 'leaves', city: 'cedarpark', street: '1611 Cypress Creek Rd', town: 'Cedar Park', zip: '78613', ad: 'REAL-V03', age: 2 * H + 10,
    answers: { cleanup_service: 'both_leaves_and_gutters_save_30', property_size: '1_4_1_2_acre', urgency: 'next_1_2_weeks', home_type: 'two_story' },
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['hung_up_early']]] },
  { n: 105, name: 'Ashley Brooks', kind: 'conviflo', form: 'mowing', city: 'east', street: '1186 Springdale Rd', town: 'Austin', zip: '78721', ad: 'REAL-I03', age: 4 * H + 50,
    answers: { mowing_frequency: 'one_time_mowing', yard_size: 'under_1_4_acre', urgency: 'asap', lawn_condition: 'very_overgrown' },
    events: [['alert', 0.3, [['Caelan', 'busy'], ['Paxton', 'no_answer']]]] },
  { n: 106, name: 'Robert Kowalski', email: true, kind: 'map', city: 'south', address: '7108 Cooper Ln, Austin, TX 78745', sq: 9400, freq: 'biweekly', ad: 'google', age: 20 * H + 50,
    events: [['alert', 0.3, [['Caelan', 'no_answer'], ['Paxton', 'no_answer']]]] },
  { n: 107, name: "Kevin O'Brien", kind: 'map', city: 'pflugerville', address: '1305 Kelly Ln, Pflugerville, TX 78660', sq: 5200, freq: 'monthly', ad: null, age: D + 3 * H,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 140]]] },

  // In talks
  { n: 108, name: 'Maria Gonzalez', kind: 'conviflo', form: 'mowing', city: 'roundrock', street: '1702 Gattis School Rd', town: 'Round Rock', zip: '78664', ad: 'REAL-V01', age: 95,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: '1_4_1_2_acre', urgency: 'next_1_2_weeks', lawn_condition: 'just_needs_a_regular_mow' },
    events: [['alert', 0.3, [['Paxton', 'claimed'], ['Caelan', 'lost_race']], ['no_answer']]] },
  { n: 109, name: 'Tyler Morgan', email: true, kind: 'map', city: 'cedarpark', address: '2810 Brushy Creek Rd, Cedar Park, TX 78613', sq: 7600, freq: 'biweekly', ad: 'AI-V02', age: 2 * D + 2 * H,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['no_answer']],
      ['log', D + 20, 'Caelan', 'no_answer']] },
  { n: 110, name: 'Jennifer Walsh', kind: 'conviflo', form: 'mowing', city: 'pflugerville', street: '804 Pecan St', town: 'Pflugerville', zip: '78660', ad: 'AI-V03', age: D + 2 * H,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: 'under_1_4_acre', urgency: 'this_week', lawn_condition: 'a_little_overgrown' },
    events: [['alert', 0.3, [['Paxton', 'claimed'], ['Caelan', 'canceled']], ['no_answer']],
      ['log', 4 * H, 'Paxton', 'voicemail', {}, 'Left VM, mentioned the first-visit discount']] },
  { n: 111, name: 'Chris Patel', email: true, kind: 'map', city: 'north', address: '5609 Martin Ave, Austin, TX 78751', sq: 3600, freq: 'biweekly', ad: 'REAL-I02', age: 3 * D + 1 * H,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['no_answer']],
      ['log', D, 'Caelan', 'voicemail'],
      ['note', D + 3 * H, 'Caelan', 'Texted back: wants to send pics of the backyard first, call after 5pm']] },
  { n: 112, name: 'Sarah Kim', kind: 'conviflo', form: 'leaves', zip: '78717', ad: 'AI-I03', age: D + 21 * H,
    answers: { cleanup_service: 'leaf_cleanup', property_size: 'under_1_4_acre', urgency: 'this_week', home_type: 'single_story' },
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['no_answer']]] },
  { n: 113, name: 'Marcus Johnson', kind: 'map', city: 'north', address: '1003 W Koenig Ln, Austin, TX 78756', sq: 5000, freq: 'weekly', ad: 'AI-V03', age: 6 * D,
    events: [['alert', 0.3, [['Caelan', 'no_answer'], ['Paxton', 'no_answer']]],
      ['log', 50, 'Paxton', 'no_answer'], ['log', D + 2 * H, 'Paxton', 'voicemail'], ['log', 3 * D + H, 'Caelan', 'no_answer']] },

  // Quoted
  { n: 114, name: 'Laura Mitchell', email: true, kind: 'map', city: 'roundrock', address: '1904 Hidden Valley Dr, Round Rock, TX 78665', sq: 8200, freq: 'biweekly', ad: 'REAL-V02', age: 9 * D,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 315]],
      ['log', 12, 'Caelan', 'not_now', { reason: 'start_later', check_back: 126, price: 'website' }, 'Just reseeded the back, wants to start in March']] },
  { n: 115, name: 'James Rivera', kind: 'conviflo', form: 'mowing', city: 'cedarpark', street: '2207 Hawk Dr', town: 'Cedar Park', zip: '78613', ad: 'AI-V01', age: 3 * D + 4 * H,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: '1_4_1_2_acre', urgency: 'next_1_2_weeks', lawn_condition: 'just_needs_a_regular_mow' },
    events: [['alert', 0.3, [['Paxton', 'claimed'], ['Caelan', 'canceled']], ['talked', 248]],
      ['log', 8, 'Paxton', 'not_now', { reason: 'checking_with_someone', check_back: 5, price: [5800, 'biweekly'] }, 'Wife wants to see the price, call back Monday']] },
  { n: 116, name: 'Emily Foster', email: true, kind: 'conviflo', form: 'mowing', city: 'pflugerville', street: '913 Wells Branch Pkwy', town: 'Pflugerville', zip: '78660', ad: 'REAL-I01', age: 4 * D + 2 * H,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: '1_4_1_2_acre', urgency: 'just_checking_prices', lawn_condition: 'just_needs_a_regular_mow' },
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 190]],
      ['log', 6, 'Caelan', 'not_now', { reason: 'thinking', check_back: 2, price: [7000, 'biweekly'] }, 'Asked for it in writing'],
      ['emailQuote', 3 * H, 'Caelan', [7000, 'biweekly']]] },
  { n: 117, name: 'Brian Thompson', kind: 'map', city: 'north', address: '10604 Pickfair Dr, Austin, TX 78750', sq: 6400, freq: 'weekly', ad: 'google-ads', age: 5 * D + 3 * H,
    events: [['alert', 0.3, [['Paxton', 'no_answer'], ['Caelan', 'claimed']], ['talked', 410]],
      ['log', 9, 'Caelan', 'not_now', { reason: 'comparing_quotes', check_back: 3, price: 'website' }, 'Has 2 other quotes, ours is mid. Likes that it is quiet (works from home)']] },
  { n: 118, name: 'Nicole Adams', email: true, kind: 'map', city: 'east', address: '1508 E 38th 1/2 St, Austin, TX 78722', sq: 3900, freq: 'biweekly', ad: 'REAL-V01', age: 7 * D + 5 * H,
    booking: { at: 9, date: 3 - 7, time: 'Morning', notes: null },
    events: [['alert', 0.3, [['Caelan', 'no_answer'], ['Paxton', 'no_answer']]],
      ['alert', 9.3, [['Paxton', 'claimed'], ['Caelan', 'canceled']], ['talked', 225], 'booking'],
      ['log', 15, 'Paxton', 'not_now', { reason: 'start_later', check_back: 75, price: 'website' }, 'Closing on the house in December, call after the holidays'],
      ['cancelBooking', 17, 'Moving in January, call after the holidays']] },

  // Booking request
  { n: 119, name: 'Hannah Lee', email: true, kind: 'map', city: 'north', address: '3405 Greenlawn Pkwy, Austin, TX 78757', sq: 6100, freq: 'biweekly', ad: 'AI-I02', age: 3 * H + 5,
    booking: { at: 6, date: 6, time: 'Morning', notes: 'Gate code 4411, dog in the backyard', addons: { fertilization: true } },
    events: [['alert', 0.3, [['Caelan', 'no_answer'], ['Paxton', 'no_answer']]],
      ['alert', 6.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['no_answer'], 'booking']] },
  { n: 120, name: 'David Chen', kind: 'map', city: 'roundrock', address: '908 Sunrise Rd, Round Rock, TX 78664', sq: 10400, freq: 'weekly', ad: 'REAL-I03', age: 23 * H,
    booking: { at: 4, date: 9, time: 'Afternoon', notes: 'Back gate sticks, lift it up' },
    events: [['alert', 4.3, [['Paxton', 'claimed'], ['Caelan', 'canceled']], ['talked', 196], 'booking'],
      ['log', 10, 'Paxton', 'yes_tbd', { check_back: 1, price: 'website' }, 'Fri afternoon works if Thursday route stays on time, confirm by tomorrow']] },
  { n: 121, name: 'Olivia Martinez', kind: 'conviflo', form: 'mowing', city: 'pflugerville', street: '1210 Dessau Ridge Ln', town: 'Pflugerville', zip: '78660', ad: 'AI-V02', age: 2 * D + 6 * H,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: 'under_1_4_acre', urgency: 'next_1_2_weeks', lawn_condition: 'a_little_overgrown' },
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 430]],
      ['log', 10, 'Caelan', 'yes_tbd', { check_back: 2, price: [4800, 'biweekly'] }, 'Wants to start once the HOA okays the side gate']] },

  // Customer
  { n: 122, name: 'Rachel Turner', email: true, kind: 'conviflo', form: 'mowing', city: 'pflugerville', street: '2715 Settlers Valley Dr', town: 'Pflugerville', zip: '78660', ad: 'REAL-V02', age: 5 * D + 2 * H,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: '1_4_1_2_acre', urgency: 'this_week', lawn_condition: 'just_needs_a_regular_mow' },
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 488]],
      ['log', 12, 'Caelan', 'booked', { first: 2, price: [5600, 'biweekly'] }, 'Side gate on the left, no pets']] },
  { n: 123, name: 'Steven Wright', email: true, kind: 'map', city: 'cedarpark', address: '403 Cypress Bend, Cedar Park, TX 78613', sq: 7200, freq: 'biweekly', ad: 'AI-V01', age: 12 * D + 3 * H,
    booking: { at: 5, date: -8, time: 'Morning', notes: null },
    events: [['alert', 5.3, [['Paxton', 'claimed'], ['Caelan', 'canceled']], ['talked', 233], 'booking'],
      ['log', 11, 'Paxton', 'booked', { first: -8, price: 'website' }]], completed: 1 },
  { n: 124, name: 'Amanda Collins', kind: 'map', city: 'east', address: '2903 Pecan Springs Rd, Austin, TX 78723', sq: 4800, freq: 'weekly', ad: 'google-ads', age: 2 * D + 1 * H,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 301]],
      ['log', 8, 'Caelan', 'booked', { first: 5, price: 'website' }]] },
  { n: 125, name: 'Jason Hughes', email: true, kind: 'map', city: 'roundrock', address: '1409 Red Bud Ln, Round Rock, TX 78664', sq: 9800, freq: 'monthly', ad: 'google', age: 25 * D + 4 * H,
    booking: { at: 7, date: -23, time: 'Afternoon', notes: 'Please close the gate, we have a cat' },
    events: [['alert', 7.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 180], 'booking'],
      ['log', 12, 'Caelan', 'booked', { first: -23, price: 'website' }]], completed: 1 },
  { n: 126, name: 'Karen Phillips', kind: 'conviflo', form: 'mowing', city: 'south', street: '2504 Wilson St', town: 'Austin', zip: '78704', ad: 'REAL-I01', age: 30 * D,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: 'under_1_4_acre', urgency: 'this_week', lawn_condition: 'a_little_overgrown' },
    events: [['alert', 0.3, [['Paxton', 'claimed'], ['Caelan', 'canceled']], ['talked', 260]],
      ['log', 9, 'Paxton', 'booked', { first: -27, price: [4200, 'weekly'] }],
      ['note', 14 * D, 'Caelan', 'Moving to Dallas at the end of the month, canceled the plan'],
      ['cancelPlan', 14 * D + 5]], completed: 2 },
  { n: 127, name: 'Greg Simmons', kind: 'map', city: 'roundrock', address: '1717 Bryant Dr, Round Rock, TX 78664', sq: 5400, freq: 'biweekly', ad: 'AI-I01', age: 10 * D + 2 * H,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 205]],
      ['log', 7, 'Caelan', 'booked', { first: -3, price: 'website' }],
      ['cancelVisit', 5 * D, "Neighbor's kid is doing it now"]] },

  // Closed
  { n: 128, name: 'Patricia Hall', email: true, kind: 'map', city: 'roundrock', address: '2205 Pebble Beach Dr, Round Rock, TX 78664', sq: 11800, freq: 'weekly', ad: 'REAL-V02', age: 8 * D + 1 * H,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 154]],
      ['log', 5, 'Caelan', 'no', { reason: 'price', price: 'website' }, '"I thought it would be under $100"']] },
  { n: 129, name: 'Anthony Ramirez', kind: 'conviflo', form: 'mowing', city: 'north', street: '4410 Ganymede Dr', town: 'Austin', zip: '78727', ad: 'AI-V03', age: 6 * D + 5 * H,
    answers: { mowing_frequency: 'not_sure_yet', yard_size: 'under_1_4_acre', urgency: 'just_checking_prices', lawn_condition: 'just_needs_a_regular_mow' },
    events: [['alert', 0.3, [['Paxton', 'claimed'], ['Caelan', 'canceled']], ['talked', 118]],
      ['log', 4, 'Paxton', 'no', { reason: 'has_someone_else' }, 'Already has a guy, was curious about electric']] },
  { n: 130, name: 'Josh T', kind: 'conviflo', form: 'mowing', zip: '78641', ad: 'REAL-V01', age: 4 * D + 3 * H,
    answers: { mowing_frequency: 'one_time_mowing', yard_size: 'i_m_not_sure', urgency: 'asap', lawn_condition: 'very_overgrown' },
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['failed']],
      ['log', 6, 'Caelan', 'bad_number', {}, 'Number not in service']] },
  { n: 131, name: 'Lisa Wong', kind: 'map', city: 'north', address: '13305 Wyoming Valley Dr, Austin, TX 78727', sq: 4500, freq: 'biweekly', ad: 'AI-I02', age: 15 * D,
    events: [['alert', 0.3, [['Caelan', 'no_answer'], ['Paxton', 'no_answer']]],
      ['log', 2 * H, 'Caelan', 'no_answer'], ['log', 2 * D, 'Paxton', 'voicemail'], ['log', 6 * D, 'Caelan', 'no_answer'],
      ['move', 12 * D, 'Caelan', 'closed', { closed_reason: 'never_responded' }]] },
  { n: 132, name: 'Mark Davis', kind: 'map', city: 'libertyhill', address: '1500 County Rd 279, Liberty Hill, TX 78642', sq: 12000, freq: 'weekly', ad: 'AI-V02', age: 3 * D + 7 * H,
    events: [['alert', 0.3, [['Caelan', 'claimed'], ['Paxton', 'canceled']], ['talked', 96]],
      ['log', 4, 'Caelan', 'no', { reason: 'outside_area' }, 'Liberty Hill, 35 min past Cedar Park']] },
  { n: 109, dupe: true, name: 'Tyler Morgan', kind: 'conviflo', form: 'mowing', city: 'cedarpark', street: '2810 Brushy Creek Rd', town: 'Cedar Park', zip: '78613', ad: 'AI-V02', age: D + 1 * H,
    answers: { mowing_frequency: 'ongoing_mowing', yard_size: '1_4_1_2_acre', urgency: 'this_week', lawn_condition: 'just_needs_a_regular_mow' },
    events: [['alert', 0.3, [['Caelan', 'passed'], ['Paxton', 'no_answer']]],
      ['move', 20, 'Caelan', 'closed', { closed_reason: 'spam_duplicate' }]] },
]

/* ── Wipe ─────────────────────────────────────────────── */
// The API role cannot delete from the append-only tables (activities, calls, texts), so the wipe runs
// in the local Supabase Postgres container: the one publishing the API port + 1 (the CLI's layout).
const WIPE = ['staff_texts', 'staff_alerts', 'lead_calls', 'lead_activities', 'job_payments', 'job_items', 'intake_events', 'bookings',
  'recurring_agreements', 'leads', 'properties', 'customers', 'crm_operations']
const dbPort = Number(new URL(url).port) + 1
const container = execFileSync('docker', ['ps', '--filter', `publish=${dbPort}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim()
if (!/^supabase_db_[\w-]+$/.test(container)) {
  console.error(`No local Supabase Postgres container publishes port ${dbPort} (found: ${container || 'none'}).`)
  process.exit(1)
}
execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qc',
  `truncate ${WIPE.map(t => `public.${t}`).join(', ')}`], { stdio: 'inherit' })
async function must(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

/* ── Seed ─────────────────────────────────────────────── */
const counts = {}
for (const spec of LEADS) {
  const createdAgo = spec.age
  const at = (m) => { if (m > createdAgo) throw new Error(`${spec.name}: event in the future`); return iso(createdAgo - m) }
  const leadId = randomUUID(), phone = phoneOf(spec.n)
  const email = spec.email && spec.name ? `${spec.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com` : null
  const touch = touchFor(spec.ad, at(-0.2))
  const site = spec.kind === 'map' ? offer(spec.sq, spec.freq) : null
  const address = spec.kind === 'map' ? spec.address : spec.street ? `${spec.street}, ${spec.town}, TX ${spec.zip}` : null

  // Lead fields that change with events (mirrors crm_log_call / crm_finish_customer_leg / crm_move_lead).
  const state = { board_column: 'new', board_moved_at: null, call_attempts: 0, contact_outcome: null, stage: 'new', closed_reason: null, quoted_reason: null,
    check_back_on: null, first_visit_on: null, customer_canceled_at: null, phone_price_cents: null, phone_frequency: null, phone_price_at: null,
    taken_by: null, taken_by_phone: null, taken_at: null, customer_dial_call_sid: null, not_taken_at: null, needs_call_log_at: null,
    call_log_reminded_at: null, quote_emailed_at: null, customer_id: null, property_id: null }
  const moveTo = (column, when) => { if (state.board_column !== column) { state.board_column = column; state.board_moved_at = when } }

  const lead = {
    id: leadId, name: spec.name, phone, email, address, created_at: at(0), consent: true, consent_text: CONSENT, consent_version: 'quote-contact:1',
    consented_at: at(0), attribution: Object.keys(touch).length ? { ...touch, first_touch: touch, latest_touch: touch } : {},
    utm_source: touch.utm_source ?? null, utm_medium: touch.utm_medium ?? null, utm_campaign: touch.utm_campaign ?? null, utm_content: touch.utm_content ?? null,
    gclid: touch.gclid ?? null, external_submission_id: randomUUID(), board_column: 'new',
  }
  if (spec.kind === 'map') {
    Object.assign(lead, { source: 'website-map', form_version: 'map:1', sq_ft: spec.sq, services: ['Lawn care'], frequency: FREQ_LABEL[spec.freq],
      answers: { last_mow: spec.n % 3 ? 'thisweek' : 'biweekly' }, website_price_cents: site.price * 100, website_first_visit_cents: site.first * 100,
      website_frequency: spec.freq, website_price_at: at(0), lawn_tracing: tracing(CITY[spec.city], spec.sq, spec.n) })
  } else {
    const formId = CONVIFLO_FORM[spec.form]
    const services = spec.form === 'mowing' ? ['Lawn care']
      : { leaf_cleanup: ['Leaf cleanup'], gutter_cleaning: ['Gutter cleaning'] }[spec.answers.cleanup_service] ?? ['Leaf cleanup', 'Gutter cleaning']
    const responseId = randomUUID()
    Object.assign(lead, { source: 'conviflo', form_version: 'conviflo-adapter:1', services, external_submission_id: hex(32),
      answers: { ...spec.answers, postcode: spec.zip, name: spec.name ?? '', phone,
        ...(email ? { email } : {}), ...(spec.street ? { property_address: { street: spec.street, unit: '', city: spec.town } } : {}),
        address_needs_review: true, address_missing: !address, conviflo_form_id: formId, conviflo_response_id: responseId,
        conviflo_form_slug: CONVIFLO_SLUG[spec.form], conviflo_submitted_at: at(0), conviflo_lead_value_horizon: 'unknown' } })
  }
  await must(db.from('leads').insert(lead), `lead ${spec.name}`)

  // Intake events: the lead itself, plus the booking request when they booked online.
  const intake = await must(db.from('intake_events').insert({ source: lead.source, submission_id: lead.external_submission_id, payload_hash: hex(32),
    lead_id: leadId, created_at: at(0), alert_version: 2 }).select('id').single(), 'intake')
  const events = { lead: intake.id }
  let request = null
  if (spec.booking) {
    const b = spec.booking
    request = { id: randomUUID(), lead_id: leadId, name: spec.name, phone, email, address, sq_ft: spec.sq, frequency: FREQ_LABEL[spec.freq],
      one_time: spec.freq === 'onetime', price_per_visit: site.price, first_visit_price: site.first, overgrowth_fee: 0, last_mow: lead.answers.last_mow,
      preferred_date: day(b.date), preferred_time: b.time, customer_notes: b.notes, addon_interest: b.addons ?? null, status: 'pending', manual_quote: false,
      created_at: at(b.at), attribution: lead.attribution, utm_source: lead.utm_source, utm_medium: lead.utm_medium, utm_campaign: lead.utm_campaign,
      utm_content: lead.utm_content, gclid: lead.gclid }
    const ev = await must(db.from('intake_events').insert({ source: 'website-booking', submission_id: randomUUID(), payload_hash: hex(32),
      lead_id: leadId, created_at: at(b.at), alert_version: 2 }).select('id').single(), 'booking intake')
    events.booking = ev.id
    if (state.board_column !== 'customer') moveTo('booking_request', at(b.at))
  }

  const calls = [], activities = [], bookingRows = request ? [request] : [], plan = { agreement: null, customer: null, property: null }
  const activity = (kind, outcome, when, extra = {}) => activities.push({ lead_id: leadId, kind, outcome, occurred_at: when, ...extra })
  const priceOf = (price) => price === 'website' ? { cents: site.price * 100, freq: spec.freq }
    : { cents: offer(price[0], price[1]).price * 100, freq: price[1], sq: price[0] }

  for (const event of spec.events) {
    const [type, t] = event
    if (type === 'alert') {
      const [, , legs, customer, which = 'lead'] = event
      const eventId = events[which]
      const winner = legs.find(([, result]) => result === 'claimed')
      const winnerSid = callSid()
      for (const [staff, result] of legs) {
        const sid = result === 'claimed' ? winnerSid : callSid()
        const answered = ['claimed', 'passed', 'lost_race'].includes(result)
        const status = { no_answer: 'no-answer', busy: 'busy', canceled: 'canceled' }[result] ?? 'completed'
        const talkSecs = customer?.[0] === 'talked' ? customer[1] : 25
        const ends = result === 'claimed' ? t + 0.6 + talkSecs / 60 : answered ? t + 0.4 : t + (result === 'canceled' ? 0.3 : 0.5)
        calls.push({ id: randomUUID(), lead_id: leadId, event_id: eventId, leg: 'alert', staff_name: staff, staff_phone: STAFF[staff].phone,
          to_phone: STAFF[staff].phone, call_sid: sid, status, result, digits: result === 'claimed' || result === 'lost_race' ? '1' : result === 'passed' ? '2' : null,
          caller_id: result === 'claimed' ? STAFF[staff].phone : null, answered_at: answered ? at(t + 0.15) : null, ended_at: at(ends),
          duration_seconds: Math.round((ends - t) * 60), created_at: at(t) })
        if (result === 'passed') activity('alert', 'passed', at(t + 0.25), { data: { staff, call_id: calls.at(-1).id } })
      }
      await must(db.from('staff_alerts').insert({ event_id: eventId, recipient: '', channel: 'voice', state: 'delivered', provider_status: 'completed', attempts: 1, updated_at: at(t + 1) }), 'alert')
      if (!winner) {
        if (!state.taken_by_phone) {
          state.not_taken_at = at(t + 0.6)
          activity('alert', 'not_taken', state.not_taken_at, { data: { event_id: eventId } })
        }
        continue
      }
      const [staff] = winner
      if (!state.taken_by_phone) {
        Object.assign(state, { taken_by: staff, taken_by_phone: STAFF[staff].phone, taken_at: at(t + 0.2), customer_dial_call_sid: winnerSid })
        activity('alert', 'taken', at(t + 0.2), { data: { staff, call_sid: winnerSid } })
      }
      const [result, secs = 0] = customer
      const legId = randomUUID(), endsAt = t + 0.5 + secs / 60
      calls.push({ id: legId, lead_id: leadId, leg: 'customer', staff_name: staff, staff_phone: STAFF[staff].phone, to_phone: phone,
        caller_id: STAFF[staff].phone, call_sid: callSid(), parent_call_sid: winnerSid, status: 'completed', result,
        duration_seconds: secs, answered_at: result === 'talked' ? at(t + 0.5) : null, ended_at: at(result === 'talked' ? endsAt : t + 0.9),
        recording_sid: result === 'talked' ? `RE${hex(16)}` : null, recording_duration_seconds: result === 'talked' ? secs : null, created_at: at(t + 0.25) })
      activity('phone', ['busy', 'failed'].includes(result) ? 'no_answer' : result, at(result === 'talked' ? endsAt : t + 0.9),
        { data: { staff, call_id: legId, duration_seconds: secs } })
      if (['no_answer', 'busy', 'failed'].includes(result)) {
        state.call_attempts++; state.contact_outcome = 'no_answer'
        if (state.board_column === 'new') moveTo('in_talks', at(t + 0.9))
        if (state.stage === 'new') state.stage = 'contacted'
      } else if (result === 'talked') {
        state.contact_outcome = 'reached'; state.needs_call_log_at = at(endsAt); state.call_log_reminded_at = null
        if (createdAgo - endsAt > 30) state.call_log_reminded_at = at(endsAt + 30)
      }
    } else if (type === 'log') {
      const [, , staff, outcome, detail = {}, note = null] = event
      const when = at(t), talked = ['booked', 'yes_tbd', 'not_now', 'no'].includes(outcome)
      const price = detail.price ? priceOf(detail.price) : null
      const column = { no_answer: 'in_talks', voicemail: 'in_talks', bad_number: 'closed', booked: 'customer', yes_tbd: 'booking_request', not_now: 'quoted', no: 'closed' }[outcome]
      moveTo(column, when)
      if (['no_answer', 'voicemail'].includes(outcome)) state.call_attempts++
      state.contact_outcome = outcome === 'bad_number' ? 'wrong_number' : talked ? 'reached' : 'no_answer'
      state.stage = state.stage === 'booked' ? 'booked' : ['bad_number', 'no'].includes(outcome) ? 'lost'
        : ['not_now', 'yes_tbd'].includes(outcome) ? 'quoted' : ['no_answer', 'voicemail'].includes(outcome) && state.stage === 'new' ? 'contacted' : state.stage
      if (outcome === 'booked') state.stage = 'booked'
      state.closed_reason = outcome === 'bad_number' ? 'bad_number' : outcome === 'no' ? detail.reason : null
      if (outcome === 'not_now') state.quoted_reason = detail.reason
      const checkBack = detail.check_back != null ? day(detail.check_back) : null
      if (['not_now', 'yes_tbd'].includes(outcome)) state.check_back_on = checkBack
      const first = outcome === 'booked' ? day(detail.first) : null
      if (first) { state.first_visit_on = first; state.customer_canceled_at = null }
      if (price) Object.assign(state, { phone_price_cents: price.cents, phone_frequency: price.freq, phone_price_at: when })
      state.needs_call_log_at = null
      activity('call', outcome, when, { body: note, actor_email: STAFF[staff].email, operation_id: randomUUID(), data: Object.fromEntries(Object.entries({
        price_cents: price?.cents, frequency: price?.freq, first_visit_on: first, check_back_on: checkBack, reason: detail.reason, column }).filter(([, v]) => v != null)) })
      if (outcome === 'booked') await book(spec, { when, first, price, request, plan, bookingRows, leadId, phone, email, address, lead })
    } else if (type === 'note') {
      activity('note', null, at(t), { body: event[3], actor_email: STAFF[event[2]].email })
    } else if (type === 'move') {
      const [, , staff, column, detail] = event
      const from = state.board_column
      moveTo(column, at(t))
      if (column === 'closed') state.closed_reason = detail.closed_reason
      if (column === 'closed' && state.stage !== 'booked') state.stage = 'lost'
      activity('board', column, at(t), { actor_email: STAFF[staff].email, data: { from, reason: detail.closed_reason } })
    } else if (type === 'emailQuote') {
      const [, , staff, [sq, freq]] = event
      const { price, first } = offer(sq, freq)
      lead.quote_draft = quoteDraft(address, CITY[spec.city], sq, freq, price, first)
      Object.assign(state, { quote_emailed_at: at(t) })
      await must(db.from('leads').update({ quote_draft: lead.quote_draft, sq_ft: sq, quote_saved_at: at(t - 4), quote_confirmed_at: at(t - 2) }).eq('id', leadId), 'quote')
      activity('quote', 'reviewed', at(t - 2), { actor_email: STAFF[staff].email })
      activity('quote', 'emailed', at(t), { actor_email: STAFF[staff].email })
      if (['new', 'in_talks'].includes(state.board_column)) moveTo('quoted', at(t))
    } else if (type === 'cancelBooking') {
      request.status = 'canceled'; request.lifecycle_note = event[2]; request.updated_at = at(t)
      if (state.board_column === 'booking_request') moveTo('quoted', at(t))
    } else if (type === 'cancelPlan' || type === 'cancelVisit') {
      const when = at(t)
      for (const row of bookingRows) if (row.status === 'confirmed' && (row.confirmed_date ?? '') >= chicagoDay(Date.parse(when))) { row.status = 'canceled'; row.lifecycle_note = event[2] ?? 'Customer canceled the plan' }
      if (plan.agreement) Object.assign(plan.agreement, { status: 'ended', end_on: chicagoDay(Date.parse(when)) < plan.agreement.anchor_on ? plan.agreement.anchor_on : chicagoDay(Date.parse(when)) })
      state.customer_canceled_at = when
    }
  }

  // Completed visits and the next plan visit (crm_generate_next_job copies lead_id onto plan visits).
  if (plan.agreement && plan.agreement.status === 'active') {
    const own = bookingRows.find(b => b.agreement_id === plan.agreement.id)
    let date = own.confirmed_date
    for (let i = 0; i < (spec.completed ?? 0); i++) {
      const row = i === 0 ? own : planVisit(own, plan, date)
      if (i > 0) bookingRows.push(row)
      completeVisit(row)
      date = nextVisit(date, own.frequency)
    }
    if ((spec.completed ?? 0) > 0) bookingRows.push(planVisit(own, plan, date))
    plan.agreement.next_on = nextVisit(date, own.frequency)
  } else if (plan.agreement && spec.completed) {
    // Plan ended after `completed` visits: those are done, the rest were canceled above.
    const own = bookingRows.find(b => b.agreement_id === plan.agreement.id)
    let date = own.confirmed_date
    for (let i = 0; i < spec.completed; i++) {
      const row = i === 0 ? own : planVisit(own, plan, date)
      if (i > 0) bookingRows.push(row)
      completeVisit(row)
      date = nextVisit(date, own.frequency)
    }
    const next = planVisit(own, plan, date)
    next.status = 'canceled'; next.lifecycle_note = 'Customer canceled the plan'
    bookingRows.push(next)
  }

  if (plan.customer) {
    // Staff confirm the address when they book the visit.
    if (lead.answers.address_needs_review) state.answers = { ...lead.answers, address_needs_review: false }
    await must(db.from('customers').insert(plan.customer), 'customer')
    await must(db.from('properties').insert(plan.property), 'property')
    state.customer_id = plan.customer.id; state.property_id = plan.property.id
    await must(db.from('leads').update({ customer_id: plan.customer.id, property_id: plan.property.id }).eq('id', leadId), 'link lead')
  }
  if (plan.agreement) await must(db.from('recurring_agreements').insert(plan.agreement), 'plan')
  for (const row of bookingRows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const items = row.items ?? [{ kind: 'service', description: 'Lawn care', amount: row.price_per_visit }]
    delete row.items
    await must(db.from('bookings').insert({ ...row, job_total: items.reduce((s, i) => s + Number(i.amount), 0) }), `booking ${spec.name}`)
    await must(db.from('job_items').insert(items.map(item => ({ ...item, booking_id: row.id, created_at: row.created_at }))), 'items')
    if (row.payment_method) await must(db.from('bookings').update({ payment_recorded_at: row.completed_at }).eq('id', row.id), 'payment time')
  }
  if (request) await must(db.from('intake_events').update({ booking_id: request.id }).eq('id', events.booking), 'event booking')
  if (calls.length) await must(db.from('lead_calls').insert(calls), 'calls')
  if (activities.length) await must(db.from('lead_activities').insert(activities.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))), 'activities')

  // Final board state. A second write restores board_moved_at, which the sync trigger stamps on a column change.
  if (!state.board_moved_at) state.board_moved_at = lead.created_at
  await must(db.from('leads').update(state).eq('id', leadId), 'lead state')
  await must(db.from('leads').update({ board_moved_at: state.board_moved_at }).eq('id', leadId), 'lead moved at')
  counts[state.board_column] = (counts[state.board_column] ?? 0) + 1
}

/** Booked by phone (app/admin/leads/board-actions.ts scheduleCallVisit): confirm the request or add a job, link a customer, start the plan. */
async function book(spec, { when, first, price, request, plan, bookingRows, leadId, phone, email, address, lead }) {
  const freq = price.freq, dollars = price.cents / 100
  const items = [{ kind: 'service', description: 'Lawn care', amount: dollars }]
  const snapshot = { items: items.map(i => ({ ...i, amount: i.amount.toFixed(2) })), total: dollars, source: 'phone_call', currency: 'USD', frequency: freq, accepted_at: when }
  const job = request ?? { id: randomUUID(), lead_id: leadId, name: spec.name ?? phone, phone, email, address, sq_ft: price.sq ?? spec.sq ?? null,
    created_at: when, attribution: lead.attribution, utm_source: lead.utm_source, utm_medium: lead.utm_medium, utm_campaign: lead.utm_campaign,
    utm_content: lead.utm_content, gclid: lead.gclid, one_time: freq === 'onetime', overgrowth_fee: 0 }
  Object.assign(job, { status: 'confirmed', confirmed_date: first, preferred_date: request?.preferred_date ?? first, confirmed_at: when, manual_quote: true,
    price_per_visit: dollars, first_visit_price: Math.round(dollars * 0.7), frequency: freq, accepted_quote_snapshot: snapshot,
    creation_operation_id: randomUUID(), creation_request: { job: { frequency: freq, first_visit_on: first, first_visit_price: Math.round(dollars * 0.7) }, items: snapshot.items, lead_id: leadId },
    items: [{ kind: 'service', description: 'Lawn care', amount: dollars }] })
  if (!request) bookingRows.push(job)
  const [lat, lng] = CITY[spec.city] ?? CITY.north
  plan.customer = { id: randomUUID(), name: spec.name ?? phone, phone, email, created_at: when }
  plan.property = { id: randomUUID(), customer_id: plan.customer.id, address: job.address, latitude: lat, longitude: lng, created_at: when }
  Object.assign(job, { customer_id: plan.customer.id, property_id: plan.property.id })
  const interval = PLAN[freq]
  if (interval) {
    plan.agreement = { id: randomUUID(), customer_id: plan.customer.id, property_id: plan.property.id, status: 'active', anchor_on: first,
      next_on: nextVisit(first, freq), end_on: null, interval_unit: interval.unit, interval_count: interval.count, price_per_visit: dollars,
      items_template: [{ kind: 'service', description: 'Lawn care', amount: dollars.toFixed(2) }], created_at: when }
    Object.assign(job, { agreement_id: plan.agreement.id, occurrence_on: first })
  }
}

function nextVisit(date, freq) {
  const key = { 'Bi-weekly': 'biweekly', Weekly: 'weekly', Monthly: 'monthly' }[freq] ?? freq
  return key === 'monthly' ? addMonths(date, 1) : addDays(date, PLAN[key].days)
}
function planVisit(own, plan, date) {
  const created = new Date(Math.min(Date.parse(`${date}T12:00:00Z`) - 10 * 86400000, NOW - 3600000)).toISOString()
  return { id: randomUUID(), lead_id: own.lead_id, name: own.name, phone: own.phone, email: own.email, address: own.address, sq_ft: own.sq_ft,
    frequency: own.frequency, price_per_visit: own.price_per_visit, status: 'confirmed', confirmed_date: date, preferred_date: date,
    confirmed_at: created, created_at: created < own.created_at ? own.created_at : created, manual_quote: own.manual_quote, one_time: false,
    customer_id: plan.customer.id, property_id: plan.property.id, agreement_id: plan.agreement.id, occurrence_on: date, attribution: own.attribution,
    accepted_quote_snapshot: own.accepted_quote_snapshot }
}
function completeVisit(row) {
  Object.assign(row, { status: 'completed', completed_at: `${row.confirmed_date}T${row.preferred_time === 'Afternoon' ? '20' : '15'}:30:00Z`,
    // The plan's first visit is the one booked with the 30% first-visit price.
    amount_charged: row.creation_request ? row.first_visit_price : row.price_per_visit, payment_method: 'Zelle' })
}

/** A saved and emailed staff quote, shaped like MapQuoteBuilder's draft. */
function quoteDraft(address, [lat, lng], sqFt, freq, price, first) {
  const shapes = tracing([lat, lng], sqFt, sqFt)
  return { address, sections: shapes.map((s, i) => ({ id: `s${i + 1}`, ...s })), jobLatLng: { lat, lng }, freq, lastMow: 'thisweek',
    fertAreaChoice: null, fertCustomSqFt: null, fertIncluded: false, mulchAreaChoice: null, mulchCustomSqFt: null, mulchDepthIn: 3, mulchIncluded: false,
    leafIncluded: false, leafHaulAway: false, maintenanceInterested: false, yardAreaChoice: null, yardCustomSqFt: null, yardSeverity: 'moderate',
    yardHazards: [], yardIncluded: false, addonInterest: null, overgrowthFee: 0, calculatedPrice: price, calculatedFirstVisit: first, overridePrice: null,
    includeMowing: true, manualLines: [], discountCents: 0, totalCents: price * 100, notes: '' }
}

const LABEL = { new: 'New', in_talks: 'In talks', quoted: 'Quoted', booking_request: 'Booking request', customer: 'Customer', closed: 'Closed' }
console.log(`Seeded ${LEADS.length} demo leads into ${url}`)
for (const [column, label] of Object.entries(LABEL)) console.log(`${label.padEnd(16)} ${counts[column] ?? 0}`)
