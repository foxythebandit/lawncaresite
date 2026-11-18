// The doctor's local checks, run for real in a scratch folder. The Supabase CLI is a stand-in that answers `{}`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const LOCALE_NAMES = ['LANG', 'LC_ALL', 'LC_COLLATE', 'LC_CTYPE', 'LC_MESSAGES', 'LC_MONETARY', 'LC_NUMERIC', 'LC_TIME']
const onMac = process.platform === 'darwin'

function doctor(extraEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-'))
  try {
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true })
    cpSync(new URL('../scripts/doctor.mjs', import.meta.url), join(dir, 'scripts/doctor.mjs'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', devDependencies: { supabase: '2.122.0' }, kit: {} }))
    writeFileSync(join(dir, 'node_modules/.bin/supabase'), '#!/bin/sh\n[ "$1" = --version ] && echo 2.122.0 || echo "{}"\n')
    chmodSync(join(dir, 'node_modules/.bin/supabase'), 0o755)
    const env = { ...process.env, KIT_DB_RUNTIME: 'native', ...extraEnv }
    for (const name of [...LOCALE_NAMES, 'KIT_DB_START_ERROR']) if (!(name in extraEnv)) delete env[name]
    const r = spawnSync(process.execPath, ['scripts/doctor.mjs', '--local'], { cwd: dir, env, encoding: 'utf8' })
    return { status: r.status, out: r.stdout + r.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a failed start blocked by Codex\'s sandbox is reported, never ok', () => {
  const r = doctor({ KIT_DB_START_ERROR: 'FATAL:  could not create shared memory segment: Operation not permitted' })
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /not fixed {2}This shell may run the database: Codex's sandbox blocks the database/)
  assert.match(r.out, /This needs the Codex allow rule for the DB commands; ask /)
})

test('"invalid locale settings" from a failed start is reported, with no empty note', () => {
  const r = doctor({ LANG: 'en_US.UTF-8', KIT_DB_START_ERROR: 'initdb: error: invalid locale settings' })
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /not fixed {2}Locale is one this machine has: Postgres refused/)
  assert.doesNotMatch(r.out, /this Mac has no/)
})

test('LC_ names that aren\'t locales are left alone', { skip: !onMac }, () => {
  const r = doctor({ LANG: 'en_US.UTF-8', LC_TERMINAL: 'iTerm2', LC_TERMINAL_VERSION: '3.5.4' })
  assert.match(r.out, /ok {9}Locale is one this machine has/)
  assert.doesNotMatch(r.out, /this Mac has no/)
})

test('a locale this Mac lacks is reported and fixed', { skip: !onMac }, () => {
  const r = doctor({ LANG: 'en_US.UTF-8', LC_COLLATE: 'C.UTF-8' })
  assert.match(r.out, /this Mac has no LC_COLLATE=C\.UTF-8/)
  assert.match(r.out, /fixed {6}Locale is one this machine has/)
})
