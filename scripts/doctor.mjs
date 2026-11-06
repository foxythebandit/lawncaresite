#!/usr/bin/env node
// Finds and fixes known local problems. A plain list of checks: detect, fix, detect again.
// Fixed a new problem? Add a check here: detect, fix, detect again.
// --local runs only the local checks (db:start uses this). Prod checks only read; the doctor never changes prod.
// detect() returns '' when fine, or a line saying what's wrong and what to do.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, release } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const kit = pkg.kit ?? {};
const bin = join(root, 'node_modules/.bin/supabase');
const LOCK = join(root, 'supabase/supabase.lock');
const MAX_RUNNING_STACKS = 25;

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? r.error?.message ?? '' };
}

const supabase = (...args) => run(bin, args);
const lastLine = (r) => r.err.split('\n').map((l) => l.trim())
  .filter((l) => l && !/new version of Supabase|recommend updating/.test(l)).pop() ?? 'no output';

// Config warnings can print around JSON output.
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function expectedRuntime() {
  if (process.env.KIT_DB_RUNTIME) return process.env.KIT_DB_RUNTIME;
  if (process.platform === 'linux') return 'native';
  if (process.platform === 'darwin' && process.arch === 'arm64' && parseInt(release(), 10) >= 23) return 'native';
  return 'docker';
}

// Codex shells set LC_ALL=C.UTF-8, which macOS doesn't have, and Postgres's initdb then fails ("invalid locale settings").
// db.mjs has the same fix.
const LOCALE_NAMES = ['LANG', 'LC_ALL', 'LC_COLLATE', 'LC_CTYPE', 'LC_MESSAGES', 'LC_MONETARY', 'LC_NUMERIC', 'LC_TIME'];
const hasLocale = (value) => !value || value === 'C' || value === 'POSIX' || existsSync(`/usr/share/locale/${value}`);
const missingLocales = () => (process.platform === 'darwin'
  ? LOCALE_NAMES.filter((name) => !hasLocale(process.env[name]))
  : []);
const badLocales = () => missingLocales().map((name) => `${name}=${process.env[name]}`).join(', ');

// Docker Desktop's tools, including the credential helper image pulls need, aren't always on PATH.
if (process.platform === 'darwin' && expectedRuntime() === 'docker') {
  process.env.PATH = ['/Applications/Docker.app/Contents/Resources/bin', join(homedir(), '.docker/bin'), process.env.PATH].join(delimiter);
}

function stackInfo() {
  const r = supabase('stack', 'status', '--output-format', 'json');
  return r.ok ? parseJson(r.out) : null;
}
const stackIsRunning = () => stackInfo()?.lifecycle === 'running';

function pendingMigrations() {
  const list = parseJson(supabase('migration', 'list', '--local', '--output-format', 'json').out)?.migrations ?? [];
  return list.filter((m) => m.local && !m.remote).map((m) => m.local);
}

// Every seed creates auth users (fake logins), so none at all means the seed didn't run.
function seedDidNotRun() {
  const seed = join(root, 'supabase/seed.sql');
  if (!existsSync(seed) || !/auth\.users/i.test(readFileSync(seed, 'utf8'))) return false;
  const r = supabase('db', 'query', '--local', 'select count(*)::int as n from auth.users', '--output-format', 'json');
  return parseJson(r.out)?.rows?.[0]?.n === 0;
}

function parseEnv(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) values[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

// ---------- local checks

const localChecks = [
  {
    // db.mjs passes KIT_DB_START_ERROR when its start failed.
    name: 'Locale is one this machine has',
    detect: () => {
      if (missingLocales().length) return `this Mac has no ${badLocales()}, so Postgres can't start ("invalid locale settings").`;
      if (/invalid locale settings/.test(process.env.KIT_DB_START_ERROR ?? '')) {
        return 'Postgres refused this shell\'s locale ("invalid locale settings"). Set LANG and LC_ALL to one `locale -a` lists, like en_US.UTF-8.';
      }
      return '';
    },
    fix: () => {
      if (!missingLocales().length) return;
      console.log(`note: this Mac has no ${badLocales()}. Using en_US.UTF-8 instead; \`npm run db:*\` does the same on its own.`);
      for (const name of missingLocales()) process.env[name] = 'en_US.UTF-8';
    },
  },
  {
    // Codex's sandbox doesn't let Postgres create shared memory. Nothing in this shell can fix that.
    name: 'This shell may run the database',
    detect: () => (/could not create shared memory segment/.test(process.env.KIT_DB_START_ERROR ?? '')
      ? `Codex's sandbox blocks the database ("could not create shared memory segment"). This needs the Codex allow rule for the DB commands; ask ${kit.approver ?? 'Caelan'}.`
      : ''),
  },
  {
    name: 'Packages installed',
    detect: () => (existsSync(bin) ? '' : 'node_modules/.bin/supabase is missing: run `npm ci`.'),
    fix: () => run('npm', ['ci'], { stdio: 'inherit' }),
  },
  {
    // The doctor never starts Docker.
    name: `Database runtime: ${expectedRuntime()}`,
    detect: () => (expectedRuntime() !== 'docker' || run('docker', ['info']).ok
      ? ''
      : 'Docker isn\'t running, and this machine\'s database needs it. A person opens Docker Desktop (from docker.com), waits for "running", then runs this again. AI agents: stop and say so; never open Docker yourself.'),
  },
  {
    name: 'Pinned CLI in use',
    detect: () => {
      const others = (process.env.PATH ?? '').split(delimiter)
        .filter((d) => !d.includes('node_modules') && existsSync(join(d, 'supabase')));
      for (const d of others) {
        console.log(`note: another Supabase CLI is on PATH (${join(d, 'supabase')}): use \`npm run db:*\` or \`npx supabase\` inside the repo.`);
      }
      const want = pkg.devDependencies?.supabase;
      const got = supabase('--version').out.trim().split('\n')[0];
      return got === want ? '' : `the repo's CLI is ${got || 'missing'}, package.json wants ${want}: run \`npm ci\`.`;
    },
  },
  {
    name: 'Lock matches the CLI',
    detect: () => {
      if (!existsSync(LOCK)) return '';
      const services = parseJson(supabase('stack', 'outdated', '--output-format', 'json').out)?.services;
      if (!services) return 'could not read `supabase stack outdated`.';
      const stale = services.filter((s) => s.stale || (s.specifier === 'bundled' && s.locked !== s.bundled));
      return stale.length
        ? `supabase.lock doesn't match this CLI (${stale.map((s) => s.service).join(', ')}): run \`npx supabase stack update\` as a deliberate upgrade.`
        : '';
    },
  },
  {
    // `stack install` is a fast no-op when everything is cached, so it is both the detect and the fix.
    name: 'Native runtime installed',
    detect: () => {
      if (expectedRuntime() !== 'native') return '';
      const frozen = existsSync(LOCK) ? ['--frozen'] : [];
      const r = supabase('stack', 'install', '--runtime', 'native', ...frozen, '--output-format', 'text');
      return r.ok ? '' : `\`supabase stack install --runtime native\` failed: ${lastLine(r)}`;
    },
  },
  {
    name: 'Stack runtime is the expected one',
    detect: () => {
      const found = stackInfo()?.runtime;
      const want = expectedRuntime();
      return !found || found === want
        ? ''
        : `this folder's stack uses ${found}, this machine should use ${want}: to replace it (deletes local data), run \`npm run db:destroy\`, then \`npm run db:start\`.`;
    },
  },
  {
    name: 'Migrations and seed applied',
    detect: () => {
      if (!stackIsRunning()) return '';
      const pending = pendingMigrations();
      if (pending.length) return `${pending.length} migrations not applied (first: ${pending[0]}). Run \`npm run db:reset\`.`;
      return seedDidNotRun() ? 'the seed did not run. Run `npm run db:reset`.' : '';
    },
    fix: () => supabase('db', 'reset', '--local', '--yes'),
  },
  {
    name: 'No orphaned or excess stacks',
    detect: () => {
      const stacks = parseJson(supabase('stack', 'list', '--output-format', 'json').out)?.stacks ?? [];
      const lifecycle = (s) => parseJson(supabase('stack', 'status', '--stack-id', s.id, '--output-format', 'json').out)?.lifecycle;
      const orphans = stacks.filter((s) => !existsSync(s.project_root));
      const running = orphans.filter((s) => lifecycle(s) === 'running');
      for (const s of orphans.filter((o) => !running.includes(o))) {
        console.log(`note: leftover stopped stack from ${s.project_root}. To delete its data: \`npx supabase stack destroy --stack-id ${s.id} --yes\`.`);
      }
      if (stacks.length > MAX_RUNNING_STACKS) {
        const count = stacks.filter((s) => lifecycle(s) === 'running').length;
        if (count > MAX_RUNNING_STACKS) console.log(`note: ${count} stacks running; macOS allows about 30. Stop the ones you aren't using.`);
      }
      return running.length ? `${running.length} running stacks whose folder is gone: ${running.map((s) => s.project_root).join(', ')}` : '';
    },
    fix: () => {
      const stacks = parseJson(supabase('stack', 'list', '--output-format', 'json').out)?.stacks ?? [];
      for (const s of stacks.filter((o) => !existsSync(o.project_root))) supabase('stack', 'stop', '--stack-id', s.id);
    },
  },
  {
    name: `${kit.envFile ?? '.env.local'} matches supabase status`,
    detect: () => {
      if (!stackIsRunning() || !kit.envNames) return '';
      const status = {};
      for (const line of supabase('status', '--env', '--output-format', 'text').out.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)='?(.*?)'?$/);
        if (m) status[m[1]] = m[2];
      }
      const file = parseEnv(join(root, kit.envFile ?? '.env.local'));
      const wrong = Object.entries(kit.envNames).filter(([from, to]) => file[to] !== status[from]).map(([, to]) => to);
      wrong.push(...(kit.localOff ?? []).filter((name) => file[name]));
      return wrong.length ? `out of date: ${wrong.join(', ')}. Run \`npm run db:env\`.` : '';
    },
    fix: () => run(process.execPath, ['scripts/db.mjs', 'env'], { stdio: 'inherit' }),
  },
];

// ---------- prod checks (read-only)

const hasEnvToken = Boolean(process.env.SUPABASE_ACCESS_TOKEN);
const hasToken = () => hasEnvToken || Boolean(run('direnv', ['exec', '.', 'printenv', 'SUPABASE_ACCESS_TOKEN']).out.trim());
const linked = (...args) => (hasEnvToken ? run(bin, args) : run('direnv', ['exec', '.', bin, ...args]));
const TEMP_DIR = join(root, 'supabase/.temp');
const REF_FILE = join(TEMP_DIR, 'project-ref');
const LINK_FILE = join(root, 'supabase/.link.json');

// The CLI keeps the link in supabase/.temp, and in supabase/.link.json in stack mode. Every place found must agree.
function isLinkedToProd() {
  const refs = [];
  if (existsSync(REF_FILE)) refs.push(readFileSync(REF_FILE, 'utf8').trim());
  if (existsSync(LINK_FILE)) {
    const link = JSON.parse(readFileSync(LINK_FILE, 'utf8'));
    refs.push(link.project?.ref, link.active_branch?.ref);
  }
  return refs.length > 0 && refs.every((ref) => ref === kit.prodProjectRef) && !hasOldLink();
}

// A project-ref with no .link.json came from a CLI older than stack mode. It breaks prod reads even when its ref is right.
const hasOldLink = () => existsSync(REF_FILE) && !existsSync(LINK_FILE);

const prodChecks = [
  {
    name: 'prod is linked',
    detect: () => (isLinkedToProd() ? '' : `the Supabase link doesn't match kit.prodProjectRef: run \`npx supabase link --project-ref ${kit.prodProjectRef}\`.`),
    // `supabase link` also records prod's versions and a timestamp in supabase.lock, which would dirty the tree. Nothing uses them (services are bundled).
    fix: () => {
      const lock = existsSync(LOCK) ? readFileSync(LOCK) : null;
      if (hasOldLink()) rmSync(TEMP_DIR, { recursive: true, force: true });
      linked('link', '--project-ref', kit.prodProjectRef);
      if (lock) writeFileSync(LOCK, lock);
    },
  },
  {
    name: 'prod is missing migrations',
    detect: () => {
      if (!isLinkedToProd()) return 'not linked, so not checked.';
      const r = linked('migration', 'list', '--linked', '--output-format', 'json');
      const list = parseJson(r.out)?.migrations;
      if (!list) return `could not read prod's migrations: ${lastLine(r)}`;
      run('git', ['fetch', '--quiet', 'origin', 'main']);
      const onMain = run('git', ['ls-tree', '-r', '--name-only', 'origin/main', 'supabase/migrations/']).out
        .split('\n').map((f) => f.split('/').pop().match(/^(\d+)[_.]/)?.[1]).filter(Boolean);
      const onProd = new Set(list.filter((m) => m.remote).map((m) => m.remote));
      const missing = onMain.filter((v) => !onProd.has(v));
      return missing.length ? `missing on prod: ${missing.join(', ')}. Fix: \`npm run release\` on \`main\`.` : '';
    },
  },
  {
    name: 'prod differs from the migrations',
    detect: () => {
      if (!isLinkedToProd()) return 'not linked, so not checked.';
      const r = linked('db', 'diff', '--linked', '--output-format', 'json');
      const result = parseJson(r.out);
      if (!r.ok || !result) return `could not diff prod: ${lastLine(r)}`;
      return result.diff?.trim() ? `someone changed prod by hand; turn the change into a migration:\n${result.diff.trim()}` : '';
    },
  },
];

// ---------- run

let broken = false;
let localBroken = false;

function runCheck(check, isLocal) {
  let problem = check.detect();
  if (!problem) { console.log(`ok         ${check.name}`); return; }
  if (check.fix) {
    check.fix();
    problem = check.detect();
    if (!problem) { console.log(`fixed      ${check.name}`); return; }
  }
  console.log(`not fixed  ${check.name}: ${problem}`);
  broken = true;
  if (isLocal) localBroken = true;
}

for (const check of localChecks) runCheck(check, true);

if (!process.argv.includes('--local')) {
  if (!kit.prodProjectRef) console.log('skipped: prod checks (no kit.prodProjectRef)');
  else if (!hasToken()) console.log('skipped: no Supabase token (run inside the repo with direnv)');
  else for (const check of prodChecks) runCheck(check, false);
}

if (localBroken && expectedRuntime() === 'native') console.log('Last resort, only if native truly can\'t work and a person says so (agents never switch runtimes): `KIT_DB_RUNTIME=docker npm run db:start`.');
if (broken) {
  console.log('Not fixed. Fixed a new problem? Add a check to `scripts/doctor.mjs`: detect, fix, detect again.');
  process.exit(1);
}
