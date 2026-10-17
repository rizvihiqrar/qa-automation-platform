// Keeps the ZAP triage in packages/qa-practice-api/README.md ("Security scan") in step
// with the rule file the CI scan uses (zap/rules.tsv) and with the job itself: every
// triaged rule is in both, a fixed finding is FAIL (it can't come back unnoticed), an
// accepted or false-positive one is IGNORE, and nothing in the rule file switches a
// rule off without a reason in the README.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'packages', 'qa-practice-api');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replaceAll('\r\n', '\n');

const readme = read(PKG, 'README.md');
const ci = read(ROOT, '.github', 'workflows', 'ci.yml');
const LEVEL = { Fixed: 'FAIL', Accepted: 'IGNORE', 'False positive': 'IGNORE' };

// "id <TAB> LEVEL <TAB> (alert name) decision: reason" lines; # starts a comment.
export function rules(tsv) {
  return tsv.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((line) => {
    const [id, level, note = ''] = line.split('\t');
    const m = note.match(/^\((.+)\) (fixed|accepted|false positive): .+$/);
    return { id, level, alert: m?.[1], decision: m?.[2], line };
  });
}

// "| 10021 | alert | risk | where | Fixed | reason |" rows of the triage table.
export function triage(md) {
  const section = md.split('\n### Security scan\n')[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^\| (\d+) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+) \|$/gm)]
    .map(([, id, alert, risk, where, decision, reason]) => ({ id, alert, risk, where, decision, reason }));
}

const tsv = rules(read(PKG, 'zap', 'rules.tsv'));
const table = triage(readme);

test('the README has a triage table and the rule file has rules', () => {
  assert.ok(table.length >= 3, `only ${table.length} triage rows`);
  assert.ok(tsv.length >= 3, `only ${tsv.length} rules`);
});

test('every rule line is well formed, and each rule is listed once', () => {
  for (const r of tsv) {
    assert.match(r.id, /^\d+$/, r.line);
    assert.ok(['FAIL', 'IGNORE', 'WARN'].includes(r.level), `${r.id}: level ${r.level}`);
    assert.ok(r.alert && r.decision, `${r.id}: note must read "(alert name) decision: reason"`);
  }
  const ids = tsv.map((r) => r.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('the README and the rule file triage the same rules, with the same names', () => {
  assert.deepEqual(table.map((r) => r.id).sort(), tsv.map((r) => r.id).sort());
  for (const row of table) {
    assert.equal(tsv.find((r) => r.id === row.id).alert, row.alert, `rule ${row.id} name`);
  }
});

test('fixed findings are FAIL; accepted and false positives are IGNORE, with a reason', () => {
  for (const row of table) {
    assert.ok(row.decision in LEVEL, `rule ${row.id}: decision "${row.decision}"`);
    const rule = tsv.find((r) => r.id === row.id);
    assert.equal(rule.level, LEVEL[row.decision], `rule ${row.id} is ${row.decision} in the README`);
    assert.equal(rule.decision, row.decision.toLowerCase(), `rule ${row.id}: rule file says ${rule.decision}`);
    assert.ok(row.reason.split(' ').length >= 8, `rule ${row.id}: the reason is too short to be one`);
  }
});

test('the CI job scans with this rule file and fails on anything not clean', () => {
  const job = ci.split('\n  zap-baseline:\n')[1]?.split(/\n  [a-z-]+:\n/)[0];
  assert.ok(job, 'no zap-baseline job in ci.yml');
  assert.match(job, /cp [^\n]*zap\/rules\.tsv/);
  assert.match(job, /zap-api-scan\.py[\s\S]*-c rules\.tsv/);
  assert.match(job, / -S /, 'safe mode (passive rules only)');
  assert.match(job, /exit \$\{status:-0\}/, 'the scan exit code must reach the job');
  assert.doesNotMatch(job, /continue-on-error/);
});

test('the ZAP version in the README is the one CI pins', () => {
  const pinned = ci.match(/ghcr\.io\/zaproxy\/zaproxy:(\d+\.\d+\.\d+)/)?.[1];
  assert.ok(pinned, 'the ZAP image must be pinned to a version');
  assert.match(readme, new RegExp(`OWASP ZAP\\]\\([^)]+\\) ${pinned.replaceAll('.', '\\.')}\\b`));
});
