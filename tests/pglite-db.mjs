// In-process Postgres (PGlite) with every migration applied, for SQL tests and the local
// dev API (scripts/dev-pglite-api.mjs) on machines without Docker. Supabase-only pieces
// (auth, storage, pg_cron) are stubbed; nothing here talks to a network.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

const PREAMBLE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text);
create function auth.role() returns text language sql as $$ select 'service_role' $$;
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
`

export function migrationFiles() {
  const dir = path.join(ROOT, 'supabase/migrations')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  // Same order fix as tests/bootstrap-local.py: bookings must exist before later files.
  files.splice(files.indexOf('002_create_bookings.sql'), 1)
  files.splice(1, 0, '002_create_bookings.sql')
  return files.map(f => ({ name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

export async function freshDb() {
  const db = new PGlite()
  await db.exec(PREAMBLE)
  for (const { name, sql } of migrationFiles()) {
    if (/pg_cron|cron\.schedule/.test(sql)) continue // prod scheduler only
    try {
      await db.exec(sql)
    } catch (error) {
      throw new Error(`${name}: ${error.message}`)
    }
    if (name === '002_create_bookings.sql') {
      await db.exec(`alter table bookings add column status text not null default 'pending';
        alter table bookings add column confirmed_date date; alter table bookings add column notes text;
        alter table bookings add column payment_link text;`) // legacy-migrations/004, never in this history
    }
  }
  return db
}
