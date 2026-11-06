// `npm run release --dry-run` must stay a dry run, and step 7 must give up in time. Runs the real script and real npm in a scratch repo.
// gh and the Supabase CLI are stand-ins that only record their arguments, so nothing can reach GitHub or prod.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const VERSION = '20991231000000'

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'release-dry-run-'))
  const repo = join(dir, 'repo')
  const stubs = join(dir, 'stubs')
  const log = join(dir, 'calls.log')
  mkdirSync(join(repo, 'supabase/migrations'), { recursive: true })
  mkdirSync(join(repo, 'node_modules/.bin'), { recursive: true })
  mkdirSync(stubs)
  for (const script of ['release.mjs', 'check-migrations.mjs']) cpSync(new URL(`../scripts/${script}`, import.meta.url), join(repo, 'scripts', script))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({
    name: 'scratch',
    scripts: { release: 'node scripts/release.mjs', check: 'echo check >> "$CALLS_LOG"' },
    kit: { prodProjectRef: 'scratchref', deploy: { type: 'vercel-git' } },
  }))
  writeFileSync(join(repo, '.gitignore'), 'node_modules\nsupabase/.link.json\n')
  writeFileSync(join(repo, `supabase/migrations/${VERSION}_scratch.sql`), 'select 1;\n')

  const stub = (path, body) => {
    writeFileSync(path, `#!/bin/sh\necho "$(basename "$0") $*" >> "$CALLS_LOG"\n${body}\n`)
    chmodSync(path, 0o755)
  }
  stub(join(stubs, 'gh'), `case "$1 $2" in
  "pr list") echo '[]' ;;
  "run list") echo '[{"databaseId":1,"status":"completed","conclusion":"success","url":"http://ci"}]' ;;
esac`)
  stub(join(repo, 'node_modules/.bin/supabase'), `case "$1" in
  link) echo '{"project":{"ref":"scratchref"},"active_branch":{"ref":"scratchref"}}' > supabase/.link.json ;;
  migration) echo '{"migrations":[{"local":"${VERSION}","remote":""}]}' ;;
esac`)

  const git = (...args) => assert.equal(spawnSync('git', args, { cwd: repo }).status, 0, `git ${args.join(' ')}`)
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'start')
  assert.equal(spawnSync('git', ['clone', '-q', '--bare', repo, join(dir, 'origin.git')]).status, 0)
  git('remote', 'add', 'origin', join(dir, 'origin.git'))
  git('fetch', '-q', 'origin')
  git('checkout', '-q', '-b', 'feature')

  const env = { ...process.env, PATH: `${stubs}:${process.env.PATH}`, CALLS_LOG: log, SUPABASE_ACCESS_TOKEN: 'fake' }
  delete env.npm_config_dry_run
  return { dir, repo, log, env }
}

test('npm run release --dry-run stops before the merge and never changes prod', () => {
  const { dir, repo, log, env } = scratchRepo()
  try {
    const r = spawnSync('npm', ['run', 'release', '--dry-run'], { cwd: repo, env, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /dry run: stopping before merge/)

    const calls = readFileSync(log, 'utf8').split('\n')
    assert.ok(calls.includes('check'), 'the checks still ran')
    const pushes = calls.filter(call => call.startsWith('supabase db push'))
    assert.equal(pushes.length, 1)
    assert.match(pushes[0], /--dry-run/)
    assert.ok(!calls.some(call => call.startsWith('gh pr merge') || call.startsWith('gh pr create')), 'no PR opened or merged')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('step 7 stops after its time limit when the deploy never shows up', () => {
  const { dir, repo, log, env } = scratchRepo()
  try {
    // A rerun after the merge: the PR is merged at HEAD, so the script goes straight to step 7. No deploy ever appears.
    const gh = join(dir, 'stubs/gh')
    writeFileSync(gh, `#!/bin/sh
echo "gh $*" >> "$CALLS_LOG"
case "$1 $2" in
  "pr list") echo "[{\\"number\\":1,\\"url\\":\\"http://pr\\",\\"state\\":\\"MERGED\\",\\"headRefOid\\":\\"$(git rev-parse HEAD)\\",\\"mergeCommit\\":{\\"oid\\":\\"abc\\"}}]" ;;
  "repo view") echo '{"nameWithOwner":"o/r","url":"http://repo"}' ;;
  api*) echo '[]' ;;
esac
`)
    chmodSync(gh, 0o755)
    const r = spawnSync('npm', ['run', 'release'], { cwd: repo, env: { ...env, KIT_DEPLOY_WAIT_MS: '1' }, encoding: 'utf8', timeout: 60_000 })
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /deploy not seen\. The merge already happened\./)
    assert.match(r.stderr, /check Vercel\/EAS .*then rerun/)
    const calls = readFileSync(log, 'utf8').split('\n')
    assert.ok(calls.some(call => call.startsWith('gh api repos/o/r/deployments')), 'it looked for the deploy')
    assert.ok(!calls.some(call => call.startsWith('gh pr merge') || call.startsWith('supabase db push')), 'nothing merged or migrated')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
