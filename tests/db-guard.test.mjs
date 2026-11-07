// The dev guard, run for real in a scratch folder against a local stand-in for the auth API.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('the guard waits for an idle auth service that takes 6 s to wake', async () => {
  // Idle native services take up to about 7 s to answer their first request.
  const server = createServer((req, res) => setTimeout(() => res.end('{}'), 6000))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dir = mkdtempSync(join(tmpdir(), 'db-guard-'))
  try {
    cpSync(new URL('../scripts/db.mjs', import.meta.url), join(dir, 'scripts/db.mjs'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', kit: { envNames: { API_URL: 'GUARD_TEST_API_URL' } } }))
    writeFileSync(join(dir, '.env.local'), `GUARD_TEST_API_URL=http://127.0.0.1:${server.address().port}\n`)
    const env = { ...process.env }
    for (const name of ['GUARD_TEST_API_URL', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY']) delete env[name]
    const child = spawn(process.execPath, ['scripts/db.mjs', 'guard'], { cwd: dir, env })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const status = await new Promise(resolve => child.on('close', resolve))
    assert.equal(status, 0, out)
    assert.doesNotMatch(out, /isn't answering/)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
