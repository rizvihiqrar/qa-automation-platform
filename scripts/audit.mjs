// Dependency audit for one package (or the root): runs `npm audit` and fails on any
// high or critical advisory that hasn't been triaged in scripts/audit-allowlist.json.
// Triaged the way the ZAP findings are (packages/qa-practice-api/zap/rules.tsv): an
// accepted advisory names its package, its GitHub advisory ID, why it can't reach
// anything here, and a date to look again. Also fails when an entry no longer
// matches anything (fixed upstream: delete it) or its review date has passed.
//
//   node scripts/audit.mjs <package folder name, or . for the root>
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
  const expired = entries.filter((e) => found.some((a) => a.id === e.advisory) && e.review_by < today);
  return { failures, accepted, stale, expired, others: found.filter((a) => !FAILING.includes(a.severity) && !accepted.some((x) => x.id === a.id)) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pkg = process.argv[2] ?? '.';
  const dir = pkg === '.' ? ROOT : path.join(ROOT, 'packages', pkg);
  const res = spawnSync('npm audit --json', { cwd: dir, shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const audit = JSON.parse(res.stdout);
  if (audit.error) throw new Error(`npm audit failed in ${pkg}: ${audit.error.summary}`);
  const allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'audit-allowlist.json'), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const r = triage(advisories(audit), allowlist, pkg, today);

  const line = (a) => `  ${a.severity.padEnd(8)} ${a.library} ${a.range}  ${a.id}  ${a.title}`;
  if (r.accepted.length) console.log(`Accepted (scripts/audit-allowlist.json):\n${r.accepted.map((a) => `${line(a)}\n           ${a.entry.reason}`).join('\n')}`);
  if (r.others.length) console.log(`Moderate or low, not failing:\n${r.others.map(line).join('\n')}`);
  if (r.failures.length) console.log(`HIGH OR CRITICAL, not triaged:\n${r.failures.map(line).join('\n')}`);
  for (const e of r.stale) console.log(`STALE allowlist entry: ${e.advisory} no longer applies to ${pkg}; delete it`);
  for (const e of r.expired) console.log(`EXPIRED allowlist entry: ${e.advisory} was due for review on ${e.review_by}`);
  const bad = r.failures.length + r.stale.length + r.expired.length;
  console.log(bad ? `${pkg}: audit FAILED` : `${pkg}: no untriaged high or critical advisories`);
  process.exit(bad ? 1 : 0);
}
