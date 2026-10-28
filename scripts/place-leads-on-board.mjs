#!/usr/bin/env node
// One-time placement of existing leads on the board (docs/ops-plan/PLAN.md 3.5 S8).
//
//   node scripts/place-leads-on-board.mjs                 dry run: counts per column + per-lead table
//   node scripts/place-leads-on-board.mjs --apply --yes-i-reviewed=<host>
//
// --apply writes only leads that were never moved on the board (board_moved_at is null) and refuses
// to run unless --yes-i-reviewed names the host of NEXT_PUBLIC_SUPABASE_URL shown by the dry run.
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the environment or .env.local.
import { readFileSync, existsSync } from 'node:fs'
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
const host = new URL(url).host
const apply = process.argv.includes('--apply')
const confirmed = process.argv.find(arg => arg.startsWith('--yes-i-reviewed='))?.split('=')[1]
console.log(`Database: ${url}`)
if (apply && confirmed !== host) {
  console.error(`Refusing to write. Review the dry run, then rerun with --apply --yes-i-reviewed=${host}`)
  process.exit(1)
}

// Plain Node loads the TypeScript rules directly; silence its one-line "module type" notice.
process.removeAllListeners('warning')
const { placeLead } = await import('../lib/board-placement.ts')

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
async function all(table, columns, filter = q => q) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).order('id').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

const leads = await all('leads', 'id,name,phone,stage,quote_status,contact_outcome,source,answers,updated_at,quote_confirmed_at,quote_emailed_at,board_column,board_moved_at,call_attempts')
const bookings = await all('bookings', 'lead_id,status,agreement_id,occurrence_on,created_at,updated_at', q => q.not('lead_id', 'is', null))
const activities = await all('lead_activities', 'lead_id,kind,outcome', q => q.in('kind', ['call', 'quote']))
const group = (rows) => rows.reduce((map, row) => map.set(row.lead_id, [...(map.get(row.lead_id) ?? []), row]), new Map())
const bookingsByLead = group(bookings), activitiesByLead = group(activities)

const LABEL = { new: 'New', in_talks: 'In talks', quoted: 'Quoted', booking_request: 'Booking request', customer: 'Customer', closed: 'Closed' }
const rows = leads.map(lead => {
  const own = bookingsByLead.get(lead.id) ?? []
  const placement = placeLead(lead, own, activitiesByLead.get(lead.id) ?? [])
  const booking = own.map(b => b.status).filter(Boolean).join('/') || '—'
  return { lead, placement, booking, locked: !!lead.board_moved_at }
})

const counts = Object.fromEntries(Object.keys(LABEL).map(column => [column, 0]))
for (const row of rows) counts[row.placement.column]++
console.log(`\nLeads: ${rows.length} (${rows.filter(r => r.locked).length} already moved on the board are skipped)\n`)
for (const [column, count] of Object.entries(counts)) console.log(`${LABEL[column].padEnd(16)} ${count}`)

const pad = (value, width) => String(value ?? '—').slice(0, width).padEnd(width)
console.log(`\n${pad('Name', 28)} ${pad('Stage', 9)} ${pad('Quote', 9)} ${pad('Booking', 18)} → ${pad('Column', 16)} Reason`)
for (const { lead, placement, booking, locked } of rows.sort((a, b) => Object.keys(LABEL).indexOf(a.placement.column) - Object.keys(LABEL).indexOf(b.placement.column))) {
  const extra = [placement.closed_reason, placement.canceled ? 'canceled chip' : null, placement.call_attempts ? `attempts ${placement.call_attempts}` : null, locked ? 'SKIP: moved' : null].filter(Boolean).join(', ')
  console.log(`${pad(lead.name || lead.phone, 28)} ${pad(lead.stage, 9)} ${pad(lead.quote_status, 9)} ${pad(booking, 18)} → ${pad(LABEL[placement.column], 16)} ${placement.reason}${extra ? ` (${extra})` : ''}`)
}

if (!apply) { console.log(`\nDry run only. Nothing written. To write: --apply --yes-i-reviewed=${host}`); process.exit(0) }

let written = 0
for (const { lead, placement, locked } of rows) {
  if (locked) continue
  const patch = {
    board_column: placement.column,
    closed_reason: placement.column === 'closed' ? placement.closed_reason ?? 'other' : null,
    ...(placement.canceled ? { customer_canceled_at: lead.updated_at ?? new Date().toISOString() } : {}),
    ...(placement.call_attempts != null ? { call_attempts: Math.max(placement.call_attempts, lead.call_attempts ?? 0) } : {}),
  }
  const { error } = await db.from('leads').update(patch).eq('id', lead.id).is('board_moved_at', null)
  if (error) { console.error(`Stopped at ${lead.id}: ${error.message}`); process.exit(1) }
  written++
}
console.log(`\nWrote ${written} leads.`)
