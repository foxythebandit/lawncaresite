#!/usr/bin/env node
// Checks new migration files: names, and changes that destroy data.
// Default: prints destructive hits, exits 0. Bad names always exit 1.
// --strict: exits 1 unless each destructive file has this line:
//   -- destructive-ok: <what>, approved by <name> <YYYY-MM-DD>
// --list: prints new files and their status.
// --strict --prod: checks the files prod is missing, not the git diff (for catching up on main).
// Known blind spot: Squawk doesn't see SQL inside DO $$ blocks.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).kit ?? {};
const approver = kit.approver ?? 'Caelan';
const MIGRATIONS = 'supabase/migrations';
const NAME = /^\d{14}_[A-Za-z0-9_.-]+\.sql$/;
const OK_LINE = /^\s*--\s*destructive-ok:\s*\S.*,\s*approved by\s+\S.*\s\d{4}-\d{2}-\d{2}\s*$/m;

// Files that make Squawk report a false syntax error: { 'file name': 'reason' }.
// Squawk 2.70.0 parsed every migration in all four repos on 2026-11-03, so none yet.
const SQUAWK_IGNORE = {};

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const list = args.includes('--list');
const prod = args.includes('--prod');

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? r.error?.message ?? '' };
}

function die(message) {
  console.error(message);
  process.exit(1);
}

function newFiles() {
  const base = run('git', ['merge-base', 'origin/main', 'HEAD']);
  if (!base.ok) die('Could not find origin/main. Run `git fetch origin main`.');
  const added = run('git', ['diff', '--name-only', '--no-renames', '--diff-filter=A', base.out.trim(), '--', MIGRATIONS]).out;
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', MIGRATIONS]).out;
  // kit.restoredMigrations: renamed files prod already ran, so they aren't new. Empty once they're on main.
  const restored = kit.restoredMigrations ?? [];
  return `${added}\n${untracked}`.split('\n').filter((f) => f && !restored.includes(basename(f))).sort();
}

function filesMissingOnProd() {
  const bin = join(root, 'node_modules/.bin/supabase');
  const cmd = ['migration', 'list', '--linked', '--output-format', 'json'];
  const r = process.env.SUPABASE_ACCESS_TOKEN ? run(bin, cmd) : run('direnv', ['exec', '.', bin, ...cmd]);
  const start = r.out.indexOf('{');
  let migrations;
  try { migrations = JSON.parse(r.out.slice(start, r.out.lastIndexOf('}') + 1)).migrations; } catch { /* handled below */ }
  if (!migrations) die(`Could not read prod's migrations: ${r.err.trim().split('\n')[0]}`);
  const missing = new Set(migrations.filter((m) => m.local && !m.remote).map((m) => m.local));
  return run('git', ['ls-files', '--', MIGRATIONS]).out.split('\n')
    .filter((f) => missing.has(basename(f).match(/^(\d+)[_.]/)?.[1]));
}

// Squawk ignores included_rules, so the list is read here. It's the only rule list.
function includedRules() {
  const text = readFileSync(join(root, '.squawk.toml'), 'utf8');
  const m = text.match(/^included_rules\s*=\s*\[(.*)\]/m);
  if (!m) die('.squawk.toml has no included_rules.');
  return new Set(m[1].split(',').map((r) => r.trim().replace(/"/g, '')));
}

// Returns { file: ['reason', ...] }. Squawk's exit code is non-zero on any hit, so the JSON is what counts.
function squawkHits(files) {
  const hits = Object.fromEntries(files.map((f) => [f, []]));
  const toCheck = files.filter((f) => !SQUAWK_IGNORE[basename(f)]);
  if (!toCheck.length) return hits;
  const bin = join(root, 'node_modules/.bin/squawk');
  if (!existsSync(bin)) die('Squawk is not installed. Add squawk-cli to devDependencies and run `npm ci`.');
  const r = run(bin, ['--config=.squawk.toml', '--reporter=json', ...toCheck]);
  let results;
  try { results = JSON.parse(r.out); } catch { die(`Could not read Squawk's output: ${r.err.trim() || r.out.trim()}`); }
  const rules = includedRules();
  for (const hit of results) {
    if (rules.has(hit.rule_name)) hits[hit.file].push(`${hit.rule_name} (line ${hit.line + 1})`);
    if (hit.rule_name === 'syntax-error') hits[hit.file].push(`Squawk can't read this file (line ${hit.line + 1}); check it by hand`);
  }
  return hits;
}

function grepHits(sql) {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  const hits = [];
  if (/\btruncate\b/i.test(code)) hits.push('truncate');
  if (/\bdelete\s+from\b/i.test(code)) hits.push('delete from');
  return hits;
}

function main() {
  const files = prod ? filesMissingOnProd() : newFiles();
  if (!files.length) {
    console.log(prod ? 'Prod has every migration.' : 'No new migrations.');
    return;
  }

  const badNames = prod ? [] : files.filter((f) => !NAME.test(basename(f)));
  const named = files.filter((f) => !badNames.includes(f));
  const squawk = squawkHits(named);
  let refuse = badNames.length > 0;

  for (const f of badNames) console.log(`${f}: bad name, must be YYYYMMDDHHMMSS_name.sql`);
  for (const f of named) {
    const sql = readFileSync(join(root, f), 'utf8');
    const reasons = [...squawk[f], ...grepHits(sql)];
    const approved = OK_LINE.test(sql);
    if (!reasons.length) {
      if (list) console.log(`${f}: ok`);
      continue;
    }
    if (approved) {
      console.log(`${f}: destructive, approved (${reasons.join(', ')})`);
      continue;
    }
    if (list) console.log(`${f}: destructive, no OK line (${reasons.join(', ')})`);
    else console.log(`DESTRUCTIVE: needs ${approver}'s OK: ${f} (${reasons.join(', ')})`);
    if (strict) refuse = true;
  }

  if (refuse) {
    if (strict) console.log('Add to the migration file, only after the OK: -- destructive-ok: <what>, approved by <name> <YYYY-MM-DD>');
    process.exitCode = 1;
  }
}

main();
