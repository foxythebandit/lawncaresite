// Local-only stand-in for Supabase (REST + staff sign-in) on top of PGlite with every migration,
// for clicking through the staff CRM on a machine without Docker. Never points at production.
//
//   node scripts/dev-pglite-api.mjs            # http://127.0.0.1:56421, seeded demo customers
//   .env.local: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56421, any keys, STAFF_EMAILS=staff@example.test
//
// Supports the PostgREST subset the admin pages use: select/order/limit, eq/neq/in/is/gt/gte/lt/lte/
// like/ilike filters, PATCH, POST insert and RPC. Sign in with staff@example.test and any password.
import http from 'node:http'
import { randomUUID as id } from 'node:crypto'
import { freshDb } from '../tests/pglite-db.mjs'

const PORT = Number(process.env.PORT ?? 56421)
const db = await freshDb()
const user = {
  id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
  email: 'staff@example.test', email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { role: 'staff' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
}
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', exp: 4102444800 })}.local`
const session = () => ({ access_token: token, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'local-refresh', user })

const ident = name => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw Object.assign(new Error(`Bad identifier ${name}`), { status: 400 })
  return `"${name}"`
}
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }

function where(params, values) {
  const parts = []
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
    const [op, ...rest] = raw.split('.'); const value = rest.join('.')
    if (op === 'in') {
      const list = value.replace(/^\(|\)$/g, '').split(',').filter(Boolean).map(v => v.replace(/^"|"$/g, ''))
      if (!list.length) { parts.push('false'); continue }
      parts.push(`${ident(key)} in (${list.map(v => { values.push(v); return `$${values.length}` }).join(',')})`)
    } else if (op === 'is') {
      parts.push(`${ident(key)} is ${value === 'null' ? 'null' : value === 'true' ? 'true' : 'false'}`)
    } else if (OPS[op]) {
      values.push(op.endsWith('like') ? value.replace(/\*/g, '%') : value)
      parts.push(`${ident(key)} ${OPS[op]} $${values.length}`)
    } else throw Object.assign(new Error(`Unsupported filter ${key}=${raw}`), { status: 400 })
  }
  return parts.length ? ` where ${parts.join(' and ')}` : ''
}
const columns = select => !select || select === '*' ? '*' : select.split(',').map(c => ident(c.trim())).join(',')
function orderBy(order) {
  if (!order) return ''
  return ' order by ' + order.split(',').map(part => {
    const [col, dir, nulls] = part.split('.')
    return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`
  }).join(',')
}

async function json(sql, values) {
  const { rows } = await db.query(`select coalesce(json_agg(t), '[]'::json)::text as body from (${sql}) t`, values)
  return JSON.parse(rows[0].body)
}

async function rest(req, url, body) {
  const path = url.pathname.replace(/^\/rest\/v1\//, '')
  if (path.startsWith('rpc/')) {
    const fn = ident(path.slice(4)); const values = []
    const args = Object.entries(body ?? {}).map(([name, value]) => {
      values.push(value === null || value === undefined ? null : typeof value === 'object' ? JSON.stringify(value) : String(value))
      return `${ident(name)} => $${values.length}`
    })
    const { rows } = await db.query(`select to_json(public.${fn}(${args.join(',')}))::text as r`, values)
    return JSON.parse(rows[0].r)
  }
  const table = `public.${ident(path)}`; const params = [...url.searchParams]; const values = []
  const prefer = req.headers.prefer ?? ''
  if (req.method === 'GET' || req.method === 'HEAD') {
    const limit = url.searchParams.get('limit')
    return json(`select ${columns(url.searchParams.get('select'))} from ${table}${where(params, values)}${orderBy(url.searchParams.get('order'))}${limit ? ` limit ${Number(limit)}` : ''}`, values)
  }
  if (req.method === 'PATCH') {
    const sets = Object.entries(body).map(([col, value]) => {
      values.push(value === null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value))
      return `${ident(col)} = $${values.length}`
    })
    const rows = await json(`update ${table} set ${sets.join(',')}${where(params, values)} returning *`, values)
    return prefer.includes('return=representation') ? rows : null
  }
  if (req.method === 'POST') {
    const list = Array.isArray(body) ? body : [body]; const rows = []
    for (const row of list) {
      const cols = Object.keys(row); const vals = []
      const placeholders = cols.map(col => { const v = row[col]; vals.push(v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)); return `$${vals.length}` })
      rows.push(...await json(`insert into ${table}(${cols.map(ident).join(',')}) values(${placeholders.join(',')}) returning *`, vals))
    }
    return prefer.includes('return=representation') ? rows : null
  }
  if (req.method === 'DELETE') return json(`delete from ${table}${where(params, values)} returning *`, values)
  throw Object.assign(new Error('Unsupported method'), { status: 405 })
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(body === null || body === undefined ? '' : JSON.stringify(body))
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : null
  try {
    if (url.pathname === '/auth/v1/token') return send(res, 200, session())
    if (url.pathname === '/auth/v1/user') return send(res, 200, user)
    if (url.pathname === '/auth/v1/logout') return send(res, 204, null)
    if (url.pathname.startsWith('/storage/')) return send(res, 200, [])
    if (url.pathname.startsWith('/rest/v1/')) {
      let result = await rest(req, url, body)
      const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')
      if (single && Array.isArray(result)) {
        if (result.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null })
        result = result[0]
      }
      return send(res, result === null ? 204 : 200, result)
    }
    send(res, 404, { message: 'Not found' })
  } catch (error) {
    const status = error.status ?? (error.code === 'PT409' ? 409 : error.code === 'P0002' ? 404 : 400)
    console.error(`${req.method} ${url.pathname}: ${error.message}`)
    send(res, status, { code: error.code ?? 'PGRST000', message: error.message, details: error.detail ?? null, hint: null })
  }
}).listen(PORT, '127.0.0.1', async () => {
  await seed()
  console.log(`Local PGlite Supabase stand-in on http://127.0.0.1:${PORT} (seeded)`)
})

// Demo data shaped like the owner's report (30 Oct): Liz's lead booking + a separate plan, and Dmitre on a plan.
async function seed() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  const day = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const call = async (fn, ...args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)).rows[0].r
  const job = async bookingId => (await db.query('select * from bookings where id = $1', [bookingId])).rows[0]

  // Liz: lead booked by phone for today at the quoted biweekly $65, linked to a new customer...
  const { rows: [liz] } = await db.query(`insert into customers(name, phone, email) values('Liz Watson', '5127505003', 'liz@example.test') returning id`)
  const { rows: [lizHome] } = await db.query(`insert into properties(customer_id, address) values($1, '4017 Avenue H, Hyde Park, Austin, TX 78751') returning id`, [liz.id])
  const { rows: [lizVisit] } = await db.query(`insert into bookings(name, phone, email, address, customer_id, property_id, status,
      confirmed_date, preferred_date, confirmed_time, frequency, one_time, price_per_visit, job_total, sq_ft, manual_quote)
    values('Liz Watson', '5127505003', 'liz@example.test', '4017 Avenue H, Hyde Park, Austin, TX 78751', $1, $2, 'confirmed', $3, $3, 'Morning', 'biweekly', false, 65, 65, 3500, true) returning id`,
    [liz.id, lizHome.id, today])
  await db.query(`insert into job_items(booking_id, kind, description, amount) values($1, 'service', 'Lawn care', 65)`, [lizVisit.id])
  // ...then "Start mowing plan" on her customer page made a second, never-scheduled first visit (Aug 28, $85).
  const items = [{ kind: 'service', description: 'Lawn care', amount: '85.00' }]
  const created = await call('crm_create_customer_job', id(), liz.id, lizHome.id, null,
    { preferred_date: day(-63), notes: '', one_time: false, frequency: 'Bi-weekly' }, items)
  const first = await job(created.booking_id)
  await call('crm_start_agreement', first.id, first.updated_at, id(),
    { anchor_on: day(-63), next_on: day(-49), end_on: null, interval_unit: 'week', interval_count: 2, items_template: items })

  // Dmitre: a healthy weekly plan, next visit a week out.
  const { rows: [dm] } = await db.query(`insert into customers(name, phone, email) values('Dmitre Ivanov', '5125550199', 'dmitre@example.test') returning id`)
  await db.query(`insert into bookings(name, phone, address, customer_id, status, one_time) values('Dmitre Ivanov', '5125550199', '1200 Shoal Creek Blvd, Austin, TX', $1, 'completed', true)`, [dm.id])
  const weekly = [{ kind: 'service', description: 'Lawn care', amount: '55.00' }]
  const dmJob = await call('crm_create_customer_job', id(), dm.id, null, { address: '1200 Shoal Creek Blvd, Austin, TX' },
    { preferred_date: day(7), notes: '', one_time: false, frequency: 'Weekly' }, weekly)
  let dmFirst = await job(dmJob.booking_id)
  await call('crm_start_agreement', dmFirst.id, dmFirst.updated_at, id(),
    { anchor_on: day(7), next_on: day(14), end_on: null, interval_unit: 'week', interval_count: 1, items_template: weekly })
  dmFirst = await job(dmFirst.id)
  await call('crm_job_command', dmFirst.id, dmFirst.updated_at, id(), 'confirm', { date: day(7), time: 'Afternoon' })
  console.log(`Liz: /admin/customers/${liz.id}\nDmitre: /admin/customers/${dm.id}`)
}
