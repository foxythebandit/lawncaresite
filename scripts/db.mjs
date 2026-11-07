#!/usr/bin/env node
// Local Supabase for this folder. Commands: start, stop, destroy, reset, env, status, types, guard.
// App-specific values come from package.json "kit". Never prints key values.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces, release } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).kit ?? {};
const envFile = kit.envFile ?? '.env.local';
const TYPES_FILE = 'supabase/database.types.ts';
const STUCK = 'Stuck: environment broken. See the doctor output above. Don\'t start Docker or another runtime by hand.';

function die(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? r.error?.message ?? '' };
}

const supabase = (...args) => run(join(root, 'node_modules/.bin/supabase'), args);

// Config warnings can print around JSON output.
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// `supabase start` prints the local keys in a table, so its output never goes out unfiltered.
function show(r) {
  // The CLI's error JSON goes to stdout and its progress to stderr, so stdout comes last to survive the slice.
  const lines = `${r.err}\n${r.out}`.split('\n')
    .filter((l) => l.trim() && !/^\s*│.*\b(key|secret|publishable)\b/i.test(l))
    .map((l) => l.replace(/\b(sb_[a-z]+_[\w-]+|eyJ[\w.-]+)/g, '***'));
  console.error(lines.slice(-30).join('\n'));
}

// KIT_DB_RUNTIME is the only override. Native needs macOS 14+ (Darwin 23+) on arm64, or Linux.
function runtime() {
  if (process.env.KIT_DB_RUNTIME) return process.env.KIT_DB_RUNTIME;
  if (process.platform === 'linux') return 'native';
  if (process.platform === 'darwin' && process.arch === 'arm64' && parseInt(release(), 10) >= 23) return 'native';
  return 'docker';
}

// Docker Desktop's tools, including the credential helper image pulls need, aren't always on PATH.
if (process.platform === 'darwin' && runtime() === 'docker') {
  process.env.PATH = ['/Applications/Docker.app/Contents/Resources/bin', join(homedir(), '.docker/bin'), process.env.PATH].join(delimiter);
}

// Codex shells set LC_ALL=C.UTF-8, which macOS doesn't have, and Postgres's initdb then fails ("invalid locale settings").
// The doctor has the same check.
const LOCALE_NAMES = ['LANG', 'LC_ALL', 'LC_COLLATE', 'LC_CTYPE', 'LC_MESSAGES', 'LC_MONETARY', 'LC_NUMERIC', 'LC_TIME'];
const hasLocale = (value) => !value || value === 'C' || value === 'POSIX' || existsSync(`/usr/share/locale/${value}`);
const missingLocales = () => (process.platform === 'darwin'
  ? LOCALE_NAMES.filter((name) => !hasLocale(process.env[name]))
  : []);
for (const name of missingLocales()) process.env[name] = 'en_US.UTF-8';

function isRunning() {
  const r = supabase('stack', 'status', '--output-format', 'json');
  return r.ok && parseJson(r.out)?.lifecycle === 'running';
}

function hasPendingMigrations() {
  const r = supabase('migration', 'list', '--local', '--output-format', 'json');
  const list = parseJson(r.out)?.migrations;
  return !r.ok || !list || list.some((m) => m.local && !m.remote);
}

// ---------- .env files

function parseEnv(file) {
  const values = {};
  if (!existsSync(join(root, file))) return values;
  for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const raw = m[2].trim();
    const quoted = raw.match(/^(['"])(.*)\1/);
    values[m[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '');
  }
  return values;
}

function setLines(text, values) {
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^\\s*(export\\s+)?${name}=`);
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) { lines[i] = `${name}=${value}`; found = true; }
    }
    if (!found) lines.push(`${name}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------- commands

function start() {
  if (!isRunning()) {
    console.log(`Starting the local database (${runtime()})...`);
    const once = () => supabase('start', '--runtime', runtime(), '--output-format', 'text');
    let r = once();
    if (!r.ok) {
      show(r);
      console.log('Start failed. Running the doctor.');
      // The doctor only looks for known phrases; the end of the output is enough, and env size is limited.
      run(process.execPath, ['scripts/doctor.mjs', '--local'], { stdio: 'inherit', env: { ...process.env, KIT_DB_START_ERROR: `${r.out}\n${r.err}`.slice(-10_000) } });
      r = once();
      if (!r.ok) { show(r); die(STUCK); }
      if (hasPendingMigrations()) die(STUCK);
    }
  }
  env();
  status();
}

function ensureRunning() {
  if (!isRunning()) start();
}

function stop() {
  const r = supabase('stop');
  if (!r.ok) { show(r); process.exit(1); }
  console.log('Local database stopped. Data kept.');
}

function destroy() {
  if (!supabase('stack', 'status', '--output-format', 'json').ok) {
    console.log('No local database for this folder.');
    return;
  }
  supabase('stop');
  const r = supabase('stack', 'destroy', '--yes');
  if (!r.ok) { show(r); process.exit(1); }
  console.log('Local database destroyed.');
}

function reset() {
  ensureRunning();
  const r = supabase('db', 'reset', '--local', '--yes');
  if (!r.ok) { show(r); process.exit(1); }
  console.log('Local database rebuilt from migrations and seed.');
}

function statusValues(args = []) {
  const r = supabase('status', '--env', '--output-format', 'text', ...args);
  if (!r.ok) die('The local database is not running. Run `npm run db:start`.');
  const values = {};
  for (const line of r.out.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)='?(.*?)'?$/);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

function env(args = []) {
  if (!kit.envNames) die('package.json has no kit.envNames.');
  const overrides = Object.entries(kit.envNames).flatMap(([from, to]) => ['--override-name', `${from}=${to}`]);
  const status = statusValues(overrides);
  const values = {};
  for (const name of Object.values(kit.envNames)) {
    if (status[name] === undefined) die(`supabase status did not return ${name}. Check kit.envNames in package.json.`);
    values[name] = status[name];
  }
  if (args.includes('--lan')) {
    const ip = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
    if (!ip) die('No LAN address found.');
    for (const name of Object.keys(values)) values[name] = values[name].replaceAll('127.0.0.1', ip);
  }
  const appUrl = args.indexOf('--app-url');
  if (appUrl >= 0) {
    if (!args[appUrl + 1]) die('--app-url needs a URL.');
    values.NEXT_PUBLIC_APP_URL = args[appUrl + 1];
  }
  for (const name of kit.localOff ?? []) values[name] = '';

  const target = join(root, envFile);
  const example = join(root, kit.envExample ?? '.env.example');
  setAsideNonLocalEnv();
  const current = existsSync(target) ? readFileSync(target, 'utf8') : existsSync(example) ? readFileSync(example, 'utf8') : '';
  writeFileSync(target, setLines(current, values));
  console.log(`Wrote ${envFile}: ${Object.keys(values).join(', ')}`);
}

// A file that points at a hosted database holds real settings. Keep it whole; don't mix it with local values.
function setAsideNonLocalEnv() {
  const url = parseEnv(envFile)[kit.envNames.API_URL];
  if (!url || isLocalUrl(url)) return;
  let backup = `${envFile}.before-kit`;
  for (let n = 2; existsSync(join(root, backup)); n++) backup = `${envFile}.before-kit-${n}`;
  renameSync(join(root, envFile), join(root, backup));
  console.log(`Your ${envFile} pointed at a database that isn't on this computer, so it wasn't changed: it's now ${backup}, kept as it was.`);
  console.log(`A new ${envFile} is being made from ${kit.envExample ?? '.env.example'}. If you need a setting from the old file, copy that one line across, but never its Supabase lines.`);
}

function status() {
  const s = statusValues();
  console.log(`API: ${s.API_URL}`);
  console.log(`DB: ${s.DB_URL}`);
  console.log(`Studio: ${s.STUDIO_URL}`);
  console.log(`Mail: ${s.MAILPIT_URL}`);
}

function types(args = []) {
  ensureRunning();
  const r = supabase('gen', 'types', 'typescript', '--local');
  if (!r.ok || !r.out.trim()) { show(r); die('Could not generate types.'); }
  const file = join(root, TYPES_FILE);
  if (args.includes('--check')) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (current !== r.out) die('types are stale: run `npm run db:types` and commit');
    console.log('Types are current.');
    return;
  }
  writeFileSync(file, r.out);
  console.log(`Wrote ${TYPES_FILE}`);
}

function isLocalUrl(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return false; }
  return host === '127.0.0.1' || host === 'localhost' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

// Same order as the app: the shell's env wins, then the env file, then .env.
const effectiveEnv = () => ({ ...parseEnv('.env'), ...parseEnv(envFile), ...process.env });

// A stopped database, or one that came back on another port, doesn't answer: the site loads but sign-in fails.
// Idle services take up to about 7 s to wake, so the limit is well above that.
async function answers(url) {
  try { return (await fetch(new URL('/auth/v1/health', url), { signal: AbortSignal.timeout(20_000) })).ok; } catch { return false; }
}

async function guard() {
  const effective = effectiveEnv();
  if (!isLocalUrl(effective[kit.envNames?.API_URL])) die('This points at a non-local database. Run `npm run db:start`.');
  if (/^[sr]k_live_/.test(effective.STRIPE_SECRET_KEY ?? '')) die(`STRIPE_SECRET_KEY in ${envFile} is a live key. Use a test key (sk_test_...) or leave it blank.`);
  if (effective.RESEND_API_KEY && !effective.EMAIL_DEV_RECIPIENT) {
    die(`RESEND_API_KEY is set but EMAIL_DEV_RECIPIENT isn't, so local email could reach real people. Set EMAIL_DEV_RECIPIENT in ${envFile}.`);
  }
  if (await answers(effective[kit.envNames.API_URL])) return;
  console.log('The local database isn\'t answering. Running `npm run db:start`.');
  start();
  if (!(await answers(effectiveEnv()[kit.envNames.API_URL]))) {
    run(process.execPath, ['scripts/doctor.mjs', '--local'], { stdio: 'inherit' });
    die(STUCK);
  }
}

const [command, ...args] = process.argv.slice(2);
const commands = { start, stop, destroy, reset, env: () => env(args), status, types: () => types(args), guard };
if (!commands[command]) die('Usage: node scripts/db.mjs start|stop|destroy|reset|env|status|types|guard');
await commands[command]();
