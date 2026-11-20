// Dependency audit for one package (or the root): runs `npm audit` and fails on any
// high or critical advisory that hasn't been triaged in scripts/audit-allowlist.json.
// Triaged the way the ZAP findings are (packages/qa-practice-api/zap/rules.tsv): an
// accepted advisory names its package, its GitHub advisory ID, why it can't reach
// anything here, and a date to look again. A review date that has passed fails.
// An entry that no longer matches anything (fixed or withdrawn upstream: delete it) only warns,
// until its review date passes too.
//
//   node scripts/audit.mjs <package folder name, tools/<tool>, or . for the root>
//   node scripts/audit.mjs --all [--out audit.md]   every folder with a lockfile, in one run
//
// CI runs --all once, in the dependency-audit job, not in every test job: an advisory published
// outside the repo (picomatch, 2026-11-17) turned eight test jobs red at once. Now it turns one
// job red, and that job files the finding in the ci-health issue.
//
// Moderate and low advisories are listed but don't fail the build.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FAILING = ['high', 'critical'];

// The distinct advisories in `npm audit --json` output, with the library they're in.
export function advisories(audit) {
  const byId = new Map();
  for (const v of Object.values(audit.vulnerabilities ?? {})) {
    for (const via of v.via) {
      if (typeof via !== 'object') continue;
      const id = via.url?.split('/').pop() ?? String(via.source);
      byId.set(id, { id, library: via.name, severity: via.severity, title: via.title, range: via.range });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// The folder an audit name stands for: . is the root, tools/x is a tool, anything else a package.
export function auditDir(pkg) {
  if (pkg === '.') return ROOT;
  return pkg.startsWith('tools/') ? path.join(ROOT, pkg) : path.join(ROOT, 'packages', pkg);
}

// What fails the build. A stale entry (the advisory went away, e.g. GitHub withdrew it) only warns:
// it is good news and an outside change must not turn a passing commit red. It is deleted when its
// review_by date comes up. Untriaged high or critical advisories and expired entries still fail.
export function failCount(r) {
  return r.failures.length + r.expired.length;
}

// Which advisories fail the build, which are accepted, and which entries are stale or expired.
export function triage(found, allowlist, pkg, today) {
  const entries = allowlist.filter((e) => e.package === pkg);
  const accepted = [];
  const failures = [];
  for (const a of found) {
    const entry = entries.find((e) => e.advisory === a.id);
    if (entry) accepted.push({ ...a, entry });
    else if (FAILING.includes(a.severity)) failures.push(a);
  }
  const stale = entries.filter((e) => !found.some((a) => a.id === e.advisory));
  const expired = entries.filter((e) => e.review_by < today);
  return { failures, accepted, stale, expired, others: found.filter((a) => !FAILING.includes(a.severity) && !accepted.some((x) => x.id === a.id)) };
}

// Every folder the audit covers: the root, each tool and each package with a lockfile.
export function auditTargets(root = ROOT) {
  const names = ['.'];
  for (const [dir, prefix] of [['tools', 'tools/'], ['packages', '']]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const n of fs.readdirSync(base).sort()) {
      if (fs.existsSync(path.join(base, n, 'package-lock.json'))) names.push(prefix + n);
    }
  }
  return names;
}

// A pull request needs the audit only when it can change what is installed (a lockfile or a
// package.json) or what the audit accepts (the script and its allowlist), or the job itself (ci.yml). Other pull requests
// never meet the advisory feed, so an outside advisory cannot turn them red.
export function touchesDependencies(files) {
  return files.some((f) => /(^|\/)package(-lock)?\.json$/.test(f) || ['scripts/audit.mjs', 'scripts/audit-allowlist.json', '.github/workflows/ci.yml'].includes(f));
}

// npm audit's JSON for one folder. A registry outage or rate limit (an error object, empty output
// or output that is not JSON) is tried again after 2 s and 5 s, so a brief blip does not turn the
// audit job red.
function npmAudit(dir, waits = [2000, 5000]) {
  let why = '';
  for (let i = 0; i <= waits.length; i++) {
    if (i > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waits[i - 1]);
    const res = spawnSync('npm audit --json', { cwd: dir, shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    why = (res.stderr ?? '').trim().slice(0, 300);
    if (!res.stdout.trim()) continue;
    try {
      const parsed = JSON.parse(res.stdout);
      if (!parsed.error) return parsed;
      why = parsed.error.summary;
    } catch {
      why = `not JSON: ${res.stdout.trim().slice(0, 120)}`;
    }
  }
  throw new Error(`npm audit gave no result in ${dir}: ${why}`);
}

// Audit one folder: the printed lines, and whether it failed.
export function auditOne(pkg, allowlist, today) {
  const dir = auditDir(pkg);
  if (!fs.existsSync(path.join(dir, 'package-lock.json'))) throw new Error(`no package-lock.json in ${dir}: is "${pkg}" a package, tools/<tool> or . ?`);
  const r = triage(advisories(npmAudit(dir)), allowlist, pkg, today);
  const line = (a) => `  ${a.severity.padEnd(8)} ${a.library} ${a.range}  ${a.id}  ${a.title}`;
  const out = [];
  const block = (title, rows) => [`${title}:`, ...rows].join('\n');
  if (r.accepted.length) out.push(block('Accepted (scripts/audit-allowlist.json)', r.accepted.map((x) => [line(x), `           ${x.entry.reason}`].join('\n'))));
  if (r.others.length) out.push(block('Moderate or low, not failing', r.others.map(line)));
  if (r.failures.length) out.push(block('HIGH OR CRITICAL, not triaged', r.failures.map(line)));
  for (const e of r.stale) out.push(`::warning::STALE allowlist entry (warning only): ${e.advisory} no longer applies to ${pkg}; delete it`);
  for (const e of r.expired) out.push(`EXPIRED allowlist entry: ${e.advisory} was due for review on ${e.review_by}`);
  const bad = failCount(r);
  out.push(bad ? `${pkg}: audit FAILED` : `${pkg}: no untriaged high or critical advisories${r.stale.length ? ` (${r.stale.length} stale allowlist entries to delete)` : ''}`);
  return { pkg, failed: bad > 0, text: out.join('\n'), result: r };
}

// A folder that cannot be audited (registry down, lockfile missing) counts as a failure for that
// folder only: the other folders are still audited and the report still gets written.
export function auditSafely(pkg, allowlist, today) {
  try {
    return auditOne(pkg, allowlist, today);
  } catch (e) {
    return { pkg, failed: true, text: `${pkg}: could not be audited: ${e.message}` };
  }
}

// The ci-health issue comment for a --all run: what failed, per folder.
export function failureReport(results, today) {
  const failed = results.filter((x) => x.failed);
  return [
    `## Dependency audit failed on ${today}`,
    '',
    `${failed.length} of ${results.length} folders have an untriaged high or critical advisory, an allowlist entry past its review date, or could not be audited.`,
    '',
    ...failed.flatMap((x) => ['### ' + x.pkg, '', '```', x.text, '```', '']),
    'Fix: update the library, or triage the advisory in scripts/audit-allowlist.json (name the package, the advisory, why it cannot reach anything here, and a review date).',
    '',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'audit-allowlist.json'), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  // The changed files of a pull request on stdin, one per line: does it need the audit?
  if (args[0] === '--needed') {
    const files = fs.readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean);
    console.log(`needed=${touchesDependencies(files)}`);
    process.exit(0);
  }
  if (args[0] === '--all') {
    const outIdx = args.indexOf('--out');
    if (outIdx > -1 && !args[outIdx + 1]) throw new Error('usage: node scripts/audit.mjs --all [--out <report file>]');
    const results = [];
    for (const pkg of auditTargets()) {
      const res = auditSafely(pkg, allowlist, today);
      console.log(`::group::${pkg}
${res.text}
::endgroup::`);
      results.push(res);
    }
    const failed = results.filter((x) => x.failed);
    console.log(failed.length ? `audit FAILED in ${failed.length} of ${results.length}: ${failed.map((x) => x.pkg).join(', ')}` : `${results.length} folders audited: no untriaged high or critical advisories`);
    if (failed.length && outIdx > -1) fs.writeFileSync(args[outIdx + 1], failureReport(results, today));
    process.exit(failed.length ? 1 : 0);
  }
  const res = auditOne(args[0] ?? '.', allowlist, today);
  console.log(res.text);
  process.exit(res.failed ? 1 : 0);
}
