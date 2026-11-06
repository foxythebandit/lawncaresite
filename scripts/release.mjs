#!/usr/bin/env node
// The only path to prod. 7 steps; any failure stops the rest and says what to do. Safe to rerun.
//   1 update from main  2 npm run check  3 destructive OK  4 re-date old files, push
//   5 migrate prod      6 merge the PR   7 confirm the deploy
// --dry-run: steps 1-4 (these do commit and push the branch), step 5 as `db push --dry-run`, then stops.
// On main: steps 1, 2, 3, 5 only ("catch up prod").
// Step 7 waits up to 15 minutes. After that, rerun: a merged branch skips straight to step 7.
//
// Not verified on a real project when written (no prod was touched while building the kit).
// Check these on each repo's first dry run:
//   - `supabase link` and `db push --linked` with only the access token, no DB password
//   - the JSON fields of `supabase migration list --linked` (same as --local: local, remote, time)
//   - the JSON fields of `supabase functions list` (slug, updated_at) in catch-up mode
//   - the JSON fields of `eas workflow:runs` and `workflow:view` (from eas-cli's source, not a real run)

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).kit ?? {};
const bin = join(root, 'node_modules/.bin/supabase');
const TEMP_DIR = join(root, 'supabase/.temp');
const REF_FILE = join(TEMP_DIR, 'project-ref');
const LINK_FILE = join(root, 'supabase/.link.json');
const LOCK = join(root, 'supabase/supabase.lock');
const MIGRATIONS = 'supabase/migrations';
const FUNCTIONS = 'supabase/functions';
const LOCK_POLL_MS = 10_000;
const POLL_MS = 15_000;
const CI_APPEAR_MS = 5 * 60_000;
// KIT_DEPLOY_WAIT_MS is for tests.
const DEPLOY_WAIT_MS = Number(process.env.KIT_DEPLOY_WAIT_MS) || 15 * 60_000;
let deployDeadline = 0;

// `npm run release --dry-run` doesn't reach argv: npm keeps the flag and sets npm_config_dry_run.
const dryRun = process.argv.includes('--dry-run') || process.env.npm_config_dry_run === 'true';

// ---------- helpers

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? r.error?.message ?? '').trim() };
}

const show = (cmd, args) => run(cmd, args, { stdio: 'inherit' });
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);

function stop(what, todo) {
  console.error(`\nRelease stopped: ${what}`);
  if (todo) console.error(`What to do: ${todo}`);
  process.exit(1);
}

// gh prints pure JSON. Supabase config warnings can print around its JSON, which is always an object.
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* has warnings */ }
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return null; }
}

const step = (n, title) => console.log(`\n== Step ${n}: ${title}`);
const passed = (n) => console.log(`Step ${n} passed.`);

// ---------- lock (R3): shared by all worktrees of this repo

function lockDir() {
  const common = git('rev-parse', '--git-common-dir').out;
  return join(isAbsolute(common) ? common : join(root, common), 'release.lock');
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

async function takeLock(branch) {
  const dir = lockDir();
  for (;;) {
    let made = false;
    try { mkdirSync(dir); made = true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (made) break;
    let owner = null;
    try { owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')); } catch { /* being written, or a crash */ }
    const abandoned = !owner && Date.now() - statSync(dir).mtimeMs > 60_000;
    if ((owner && !isAlive(owner.pid)) || abandoned) {
      console.log(`Taking over a stale release lock${owner ? ` from ${owner.branch}` : ''}.`);
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (owner) console.log(`waiting for release by ${owner.branch} (${owner.folder}, since ${owner.started})`);
    await sleep(LOCK_POLL_MS);
  }
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ branch, folder: root, pid: process.pid, started: new Date().toISOString() }));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

// ---------- prod access

const hasEnvToken = Boolean(process.env.SUPABASE_ACCESS_TOKEN);
const linked = (args, options) => (hasEnvToken ? run(bin, args, options) : run('direnv', ['exec', '.', bin, ...args], options));

// The CLI keeps the link in supabase/.temp, and in supabase/.link.json in stack mode. Every place found must agree.
function linkedRefs() {
  const refs = [];
  if (existsSync(REF_FILE)) refs.push(readFileSync(REF_FILE, 'utf8').trim());
  if (existsSync(LINK_FILE)) {
    const link = JSON.parse(readFileSync(LINK_FILE, 'utf8'));
    refs.push(link.project?.ref, link.active_branch?.ref);
  }
  return refs;
}
const isLinkedToProd = () => {
  const refs = linkedRefs();
  return refs.length > 0 && refs.every((ref) => ref === kit.prodProjectRef) && !hasOldLink();
};
// A project-ref with no .link.json came from a CLI older than stack mode. It breaks prod reads even when its ref is right.
const hasOldLink = () => existsSync(REF_FILE) && !existsSync(LINK_FILE);

function ensureLinked() {
  if (!kit.prodProjectRef) stop('package.json has no kit.prodProjectRef.');
  if (!hasEnvToken && !run('direnv', ['exec', '.', 'printenv', 'SUPABASE_ACCESS_TOKEN']).out) {
    stop('no Supabase token.', 'run inside the repo with direnv, or set SUPABASE_ACCESS_TOKEN.');
  }
  if (!isLinkedToProd()) {
    // `supabase link` also records prod's versions and a timestamp in supabase.lock, which would dirty the tree. Nothing uses them (services are bundled).
    const lock = existsSync(LOCK) ? readFileSync(LOCK) : null;
    if (hasOldLink()) rmSync(TEMP_DIR, { recursive: true, force: true });
    const r = linked(['link', '--project-ref', kit.prodProjectRef]);
    if (lock) writeFileSync(LOCK, lock);
    if (!r.ok || !isLinkedToProd()) stop(`could not link to ${kit.prodProjectRef}: ${r.err}`);
  }
}

function prodMigrations() {
  const r = linked(['migration', 'list', '--linked', '--output-format', 'json']);
  const list = parseJson(r.out)?.migrations;
  if (!list) stop(`could not read prod's migrations: ${r.err}`);
  const remote = list.map((m) => m.remote).filter(Boolean).sort();
  return {
    newest: remote.at(-1) ?? '',
    missing: list.filter((m) => m.local && !m.remote).map((m) => m.local),
  };
}

// ---------- step 4: re-date

function newMigrationFiles() {
  const base = git('merge-base', 'origin/main', 'HEAD').out;
  return git('diff', '--name-only', '--no-renames', '--diff-filter=A', base, 'HEAD', '--', MIGRATIONS).out
    // kit.restoredMigrations: renamed files prod already ran. They are never re-dated.
    .split('\n').filter((f) => f && !(kit.restoredMigrations ?? []).includes(basename(f))).sort();
}

// Files keep their order: everything from the first out-of-date file onward gets a new time.
function reDate(newest) {
  const files = newMigrationFiles();
  const first = files.findIndex((f) => basename(f).slice(0, 14) <= newest);
  if (first < 0) return false;
  const now = Date.now();
  files.slice(first).forEach((file, i) => {
    const stamp = new Date(now + i * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const r = git('mv', file, join(MIGRATIONS, `${stamp}${basename(file).slice(14)}`));
    if (!r.ok) stop(`could not rename ${file}: ${r.err}`);
  });
  const c = git('commit', '-m', `Re-date migrations after ${newest}`);
  if (!c.ok) stop(`could not commit the re-dated files: ${c.err}`);
  return true;
}

// ---------- step 5: CI, migrate, functions

async function waitForCi(sha) {
  const deadline = Date.now() + CI_APPEAR_MS;
  console.log(`Waiting for CI on ${sha.slice(0, 7)}...`);
  for (;;) {
    const runs = parseJson(gh('run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--json', 'databaseId,status,conclusion,url').out) ?? [];
    if (runs.length) {
      const id = String(runs[0].databaseId);
      if (!show('gh', ['run', 'watch', id, '--exit-status', '--interval', '15']).ok) stop(`CI is red: ${runs[0].url}`, 'fix it, push, then rerun.');
      return;
    }
    if (Date.now() > deadline) stop(`no CI run for ${sha} after 5 minutes.`, 'check that the push reached GitHub, then rerun.');
    await sleep(POLL_MS);
  }
}

function migrate(missing) {
  if (!missing.length && !dryRun) {
    console.log('no database change: prod already has every migration');
    return [];
  }
  const preview = linked(['db', 'push', '--linked', '--dry-run'], { stdio: 'inherit' });
  if (!preview.ok) stop('`supabase db push --dry-run` failed.', 'read the output above.');
  if (dryRun) return missing;
  if (!linked(['db', 'push', '--linked', '--yes'], { stdio: 'inherit' }).ok) {
    stop('`supabase db push` failed. The app stays on the old version.', 'read the output above, fix the migration, rerun.');
  }
  const after = prodMigrations();
  if (after.missing.length) stop(`still missing on prod: ${after.missing.join(', ')}`);
  return missing;
}

function allFunctions() {
  if (!existsSync(join(root, FUNCTIONS))) return [];
  return readdirSync(join(root, FUNCTIONS), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name);
}

function changedFunctions() {
  const changed = git('diff', '--name-only', 'origin/main...HEAD', '--', `${FUNCTIONS}/`).out.split('\n').filter(Boolean);
  const names = new Set(changed.map((f) => f.split('/')[2]));
  if (names.has('_shared')) return allFunctions();
  return allFunctions().filter((name) => names.has(name));
}

function deployFunctions() {
  const names = changedFunctions();
  if (dryRun) {
    console.log(names.length ? `Would deploy functions: ${names.join(', ')}` : 'No functions to deploy.');
    return;
  }
  for (const name of names) {
    console.log(`Deploying function ${name}...`);
    const r = linked(['functions', 'deploy', name, '--project-ref', kit.prodProjectRef, '--use-api'], { stdio: 'inherit' });
    if (!r.ok) stop(`function ${name} failed to deploy.`, 'read the output above, then rerun.');
  }
}

// Catch-up has no branch diff: list functions changed since they were deployed, and stop for a person.
function checkFunctionsCatchUp() {
  const r = linked(['functions', 'list', '--project-ref', kit.prodProjectRef, '--output-format', 'json']);
  const parsed = parseJson(r.out);
  const deployed = Array.isArray(parsed) ? parsed : parsed?.functions;
  if (!deployed) stop(`could not read deployed functions: ${r.err}`, 'check them by hand.');
  const shared = Number(git('log', '-1', '--format=%ct', '--', `${FUNCTIONS}/_shared`).out) || 0;
  const behind = allFunctions().filter((name) => {
    const fn = deployed.find((d) => d.slug === name);
    if (!fn) return true;
    const committed = Math.max(Number(git('log', '-1', '--format=%ct', '--', `${FUNCTIONS}/${name}`).out) || 0, shared);
    return committed * 1000 > Number(fn.updated_at);
  });
  if (behind.length) stop(`these functions have commits newer than their deployed version: ${behind.join(', ')}`, 'a person decides: deploy them or say why not.');
}

// ---------- step 6: merge

function pullRequests(branch) {
  return parseJson(gh('pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url,state,headRefOid,mergeCommit').out) ?? [];
}

function merge(branch, sha) {
  let pr = pullRequests(branch).find((p) => p.state === 'OPEN');
  if (!pr) {
    const created = gh('pr', 'create', '--fill', '--base', 'main', '--head', branch);
    if (!created.ok) stop(`could not create the PR: ${created.err}`, 'the DB is one step ahead, which is harmless; fix it and rerun.');
    pr = pullRequests(branch).find((p) => p.state === 'OPEN');
    if (!pr) stop('could not find the PR just created.', 'rerun.');
  }
  const r = gh('pr', 'merge', String(pr.number), '--squash', '--match-head-commit', sha);
  if (!r.ok) stop(`merge refused: ${r.err}`, 'the DB is one step ahead, which is harmless; fix it and rerun.');
  const merged = pullRequests(branch).find((p) => p.number === pr.number);
  if (merged?.state !== 'MERGED' || !merged.mergeCommit?.oid) stop(`PR ${pr.url} isn't merged yet.`, 'rerun.');
  const del = git('push', 'origin', '--delete', branch);
  if (!del.ok) console.log(`Could not delete the remote branch: ${del.err}`);
  return merged;
}

// ---------- step 7: confirm the deploy

async function poll(link, check) {
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deployDeadline) stop('deploy not seen. The merge already happened.', `check Vercel/EAS (${link}), then rerun; the rerun only checks the deploy.`);
    await sleep(POLL_MS);
  }
}

async function confirmGithubActions(sha, workflow) {
  const link = `workflow ${workflow}`;
  const found = await poll(link, () => {
    const runs = parseJson(gh('run', 'list', '--workflow', workflow, '--limit', '20', '--json', 'headSha,databaseId,url').out) ?? [];
    return runs.find((r) => r.headSha === sha);
  });
  if (!show('gh', ['run', 'watch', String(found.databaseId), '--exit-status', '--interval', '15']).ok) stop(`deploy failed: ${found.url}`);
  return `Deploy live: ${found.url}`;
}

async function confirmVercel(sha) {
  const repo = parseJson(gh('repo', 'view', '--json', 'nameWithOwner,url').out);
  const api = `repos/${repo.nameWithOwner}/deployments`;
  const link = await poll(`${repo.url}/deployments`, () => {
    const deployment = (parseJson(gh('api', `${api}?sha=${sha}&environment=Production`).out) ?? [])[0];
    if (!deployment) return null;
    const latest = (parseJson(gh('api', `${api}/${deployment.id}/statuses`).out) ?? [])[0];
    if (latest?.state === 'failure' || latest?.state === 'error') stop(`deploy failed: ${latest.target_url || latest.log_url}`);
    return latest?.state === 'success' ? latest.environment_url || latest.target_url || `${repo.url}/deployments` : null;
  });
  if (kit.prodUrl) {
    const live = await poll(kit.prodUrl, async () => {
      try { return (await fetch(kit.prodUrl)).status === 200; } catch { return false; }
    });
    if (!live) stop(`${kit.prodUrl} isn't answering.`);
  }
  return `Deploy live: ${link}`;
}

// Fields checked against real runs (id, status, gitCommitHash; jobs[].type, logURL). Waiting on a live run hasn't been tried.
async function confirmEas(sha, workflow) {
  const eas = (...args) => run('npx', ['eas-cli', ...args]);
  const done = await poll(`npx eas-cli workflow:runs --workflow ${workflow}`, () => {
    const runs = parseJson(eas('workflow:runs', '--workflow', workflow, '--json', '--limit', '20').out) ?? [];
    const found = runs.find((r) => r.gitCommitHash === sha);
    if (found?.status === 'FAILURE' || found?.status === 'CANCELED') stop(`deploy failed: EAS workflow run ${found.id}`);
    return found?.status === 'SUCCESS' ? found : null;
  });
  const view = parseJson(eas('workflow:view', done.id, '--json', '--non-interactive').out);
  const link = view?.logURL ?? `EAS workflow run ${done.id}`;
  const submitted = view?.jobs?.some((j) => j.type === 'SUBMISSION' && j.status === 'SUCCESS');
  return submitted ? `Submitted to the App Store: ${link}` : `Deploy live: ${link}`;
}

async function confirmDeploy(sha) {
  deployDeadline = Date.now() + DEPLOY_WAIT_MS;
  const deploy = kit.deploy ?? {};
  if (deploy.type === 'github-actions') return confirmGithubActions(sha, deploy.workflow);
  if (deploy.type === 'vercel-git') return confirmVercel(sha);
  if (deploy.type === 'eas-workflow') return confirmEas(sha, deploy.workflow);
  return stop(`unknown kit.deploy.type: ${deploy.type}`);
}

// ---------- main

async function main() {
  const branch = git('branch', '--show-current').out;
  if (!branch) stop('not on a branch.', 'check out your feature branch or main.');
  if (!gh('auth', 'status').ok) stop('the GitHub CLI isn\'t set up.', 'install it (cli.github.com), run `gh auth login`, then rerun.');
  const onMain = branch === 'main';

  await takeLock(branch);

  if (git('status', '--porcelain').out) stop('the working tree is not clean.', 'commit or stash your changes, then rerun.');

  // R4: already merged, so only the deploy check is left. Checked first: step 1 would change HEAD.
  if (!onMain) {
    const head = git('rev-parse', 'HEAD').out;
    const done = pullRequests(branch).find((p) => p.state === 'MERGED' && p.headRefOid === head);
    if (done) {
      console.log(`PR ${done.url} is already merged.`);
      step(7, 'Confirm the deploy is live');
      console.log(await confirmDeploy(done.mergeCommit.oid));
      console.log('already released');
      return;
    }
  }

  step(1, 'Update the branch to the latest main');
  if (!git('fetch', 'origin', 'main').ok) stop('could not fetch origin/main.', 'check your network, then rerun.');
  const merged = git('merge', '--no-edit', 'origin/main');
  if (!merged.ok) stop(`merge conflict with main: ${merged.out}`, 'resolve, then rerun.');
  if (onMain && git('rev-list', 'origin/main..HEAD').out) {
    stop('local main has commits that are not on origin/main.', 'this script never commits to main; move them to a branch.');
  }
  passed(1);

  step(2, 'npm run check');
  if (!show('npm', ['run', 'check']).ok) stop('`npm run check` failed.', 'read the output above, fix it, rerun.');
  passed(2);

  step(3, 'Destructive changes need the OK line');
  ensureLinked();
  const strictArgs = onMain ? ['--strict', '--prod'] : ['--strict'];
  const destructive = show(process.execPath, ['scripts/check-migrations.mjs', ...strictArgs]);
  if (destructive.status === 1) stop('a destructive migration has no OK line.', 'ask for the OK, add the `-- destructive-ok:` line, rerun.');
  if (!destructive.ok) stop('the migration check could not run.', 'read the line above, fix it, rerun.');
  passed(3);

  if (!onMain) {
    step(4, 'Re-date older migration files');
    const { newest } = prodMigrations();
    if (reDate(newest)) {
      console.log(`Re-dated new migrations after ${newest}. Rebuilding (the order changed).`);
      if (!show('npm', ['run', 'db:reset']).ok || !show('npm', ['run', 'test:db']).ok) stop('the rebuild failed after re-dating.', 'read the output above, fix it, rerun.');
    }
    const pushed = git('push', '-u', 'origin', branch);
    if (!pushed.ok) stop(`git push failed: ${pushed.err}`, 'fix it, then rerun.');
    passed(4);
  }

  step(5, dryRun ? 'Migrate prod (dry run)' : 'Migrate prod');
  const sha = git('rev-parse', 'HEAD').out;
  if (!dryRun) await waitForCi(sha);
  const before = prodMigrations();
  if (onMain && before.missing.some((v) => v <= before.newest)) {
    stop(`a missing migration is older than prod's newest (${before.newest}): ${before.missing.join(', ')}`, 're-date it on a feature branch and release that; this script never commits to main.');
  }
  const applied = migrate(before.missing);
  if (kit.deployFunctions) {
    if (onMain) checkFunctionsCatchUp();
    else deployFunctions();
  }
  passed(5);

  if (dryRun) {
    console.log('\ndry run: stopping before merge');
    return;
  }

  if (onMain) {
    console.log(applied.length ? `\nMigrations applied: ${applied.join(', ')}` : '\nprod is up to date');
    return;
  }

  step(6, 'Merge the PR');
  const pr = merge(branch, sha);
  passed(6);

  step(7, 'Confirm the deploy is live');
  const deployLine = await confirmDeploy(pr.mergeCommit.oid);
  passed(7);

  console.log(`\nPR: ${pr.url}`);
  console.log(`Migrations applied: ${applied.length ? applied.join(', ') : 'none'}`);
  console.log(deployLine);
}

// No process.exit on success: a clean finish keeps exit codes honest in every shell.
await main();
