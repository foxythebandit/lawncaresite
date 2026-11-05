#!/usr/bin/env node
// Doc size and repo shape checks. Each problem is one line; any failure exits 1.
// When kit.docsStrict is false, the CLAUDE.md and doc size rules only warn.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).kit ?? {};
const KB = 1024;
const SEED = 'supabase/seed.sql';

// Split so that this file doesn't match its own search.
const FORBIDDEN = ['~/bra' + 'in', '/bra' + 'in/', 'ai-work' + 'flow'].join('|');

const failures = [];
const warnings = [];
const docRule = (message) => (kit.docsStrict ? failures : warnings).push(message);

function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, status: r.status, out: r.stdout ?? '' };
}

function checkSize(file, limitKb) {
  const size = statSync(join(root, file)).size;
  if (size > limitKb * KB) docRule(`${file} is ${Math.ceil(size / KB)} KB; the limit is ${limitKb} KB.`);
}

function checkDocFolder(folder, limitKb) {
  if (!existsSync(join(root, folder))) return;
  for (const name of readdirSync(join(root, folder))) {
    if (name.endsWith('.md')) checkSize(`${folder}/${name}`, limitKb);
  }
}

// Doc sizes and CLAUDE.md
if (existsSync(join(root, 'AGENTS.md'))) checkSize('AGENTS.md', 12);
checkDocFolder('docs/architecture', 20);
checkDocFolder('docs/features', 15);
const claude = join(root, 'CLAUDE.md');
if (existsSync(claude) && readFileSync(claude, 'utf8').trim() !== '@AGENTS.md') {
  docRule('CLAUDE.md must be exactly @AGENTS.md.');
}

// No repo mentions the place the kit came from.
const mentions = git('grep', '-lIE', FORBIDDEN);
for (const file of mentions.out.split('\n').filter(Boolean)) {
  failures.push(`${file} mentions a path outside this repo; no repo may point at the workflow's home.`);
}

// New files in lib folders need a reason on the first line.
const base = git('merge-base', 'origin/main', 'HEAD');
if (!base.ok) {
  failures.push('Could not find origin/main. Run `git fetch origin main`.');
} else {
  for (const dir of kit.libDirs ?? []) {
    const added = git('diff', '--name-only', '--no-renames', '--diff-filter=A', base.out.trim(), '--', dir).out;
    const untracked = git('ls-files', '--others', '--exclude-standard', '--', dir).out;
    for (const file of `${added}\n${untracked}`.split('\n').filter(Boolean)) {
      const firstLine = readFileSync(join(root, file), 'utf8').split('\n')[0];
      if (!/^\/\/ lib-ok: \S/.test(firstLine)) failures.push(`${file} is a new file in ${dir}; put it with its feature, or start it with "// lib-ok: <reason>".`);
    }
  }
}

// Seed emails are fake.
if (existsSync(join(root, SEED))) {
  const emails = readFileSync(join(root, SEED), 'utf8').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? [];
  const real = [...new Set(emails.filter((e) => !e.endsWith('@example.test')))];
  if (real.length) failures.push(`${SEED} has emails not at @example.test: ${real.slice(0, 5).join(', ')}${real.length > 5 ? ` and ${real.length - 5} more` : ''}`);
}

for (const line of warnings) console.log(`warning: ${line}`);
for (const line of failures) console.log(`failed: ${line}`);
if (failures.length) process.exit(1);
