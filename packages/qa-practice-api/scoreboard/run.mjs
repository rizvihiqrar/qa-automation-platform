// The scoreboard (Day 39 of docs/ai-written-code): puts each of the AI's mistakes
// back (put-backs.mjs), runs every test in the package, and records which tests
// fail, grouped by technique. Writes docs/ai-written-code/scoreboard.json, which
// docs/ai-written-code/scoreboard.md and scripts/ai-written-code.test.mjs read.
//
//   npm run scoreboard            all put-backs (about 5 minutes)
//   npm run scoreboard -- CR-01   just one, printed, nothing written
//
// The source is always restored, even if a run fails or is interrupted.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { putBacks } from './put-backs.mjs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../../../docs/ai-written-code/scoreboard.json', import.meta.url));
const only = process.argv.slice(2);

// Case ID prefix → technique. Tests without one are the API's earlier tests.
export const TECHNIQUES = {
  'DC-BVA': 'Boundary values',
  'DC-DT': 'Decision tables',
  'DC-EP': 'Equivalence partitioning',
  'DC-AC': 'Access control',
  'DC-ST': 'State transitions',
  'DC-EX': 'Worked examples',
  'DC-PR': 'Property-based',
};
const prefixOf = (title) => title.match(/\b(DC-[A-Z]+)-\d{2}\b/)?.[1] ?? 'earlier';

function apply(edits) {
  const originals = new Map();
  for (const { file, find, replace } of edits) {
    const path = `${pkg}/${file}`;
    const text = originals.get(path) ?? readFileSync(path, 'utf8');
    if (!originals.has(path)) originals.set(path, text);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const current = readFileSync(path, 'utf8');
    const [f, r] = [find, replace].map((s) => s.replaceAll('\n', eol));
    const count = current.split(f).length - 1;
    if (count !== 1) throw new Error(`${file}: expected the text once, found it ${count} times: ${find}`);
    writeFileSync(path, current.replace(f, r));
  }
  return () => { for (const [path, text] of originals) writeFileSync(path, text); };
}

function run(cmd, args, env = {}) {
  // One command string: npx needs a shell on Windows, and the arguments are fixed here.
  return spawnSync([cmd, ...args].join(' '), { cwd: pkg, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
}

// Failing test titles from every Playwright test and every property test.
function failures() {
  const json = `${pkg}/reports/scoreboard-run.json`;
  if (existsSync(json)) rmSync(json);
  // CI=1: never reuse a server that is already running the unchanged code.
  run('npx', ['playwright', 'test', '--reporter=json'], { CI: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: json });
  const report = JSON.parse(readFileSync(json, 'utf8'));
  const failed = [];
  let total = 0;
  const walk = (suite) => {
    for (const s of suite.suites ?? []) walk(s);
    for (const spec of suite.specs ?? []) {
      total++;
      if (!spec.ok) failed.push(spec.title);
    }
  };
  report.suites.forEach(walk);

  const props = run('node', ['--test', '--test-reporter=tap', '"tests/properties/*.property.ts"']);
  for (const line of props.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*(ok|not ok) \d+ - (DC-PR-\d{2}.*)$/);
    if (m) { total++; if (m[1] === 'not ok') failed.push(m[2]); }
  }
  return { total, failed };
}

function group(failed) {
  const by = {};
  for (const title of failed) (by[prefixOf(title)] ??= []).push(title.match(/^(DC-[A-Z]+-\d{2})/)?.[1] ?? title);
  for (const k of Object.keys(by)) by[k].sort();
  return by;
}

const selected = only.length ? putBacks.filter((p) => only.includes(p.id)) : putBacks;
const results = [];

const baseline = failures();
console.log(`baseline: ${baseline.failed.length} of ${baseline.total} fail`);
if (baseline.failed.length) {
  console.error(baseline.failed.join('\n'));
  throw new Error('the unchanged code must pass every test first');
}

for (const p of selected) {
  const restore = apply(p.edits);
  let result;
  try {
    result = failures();
  } finally {
    restore();
  }
  const failedBy = group(result.failed);
  results.push({ id: p.id, what: p.what, failed: result.failed.length, by: failedBy });
  console.log(`${p.id}: ${result.failed.length} fail  ${Object.entries(failedBy).map(([k, v]) => `${k} ${v.length}`).join(', ') || 'NONE'}`);
}

if (!only.length) {
  writeFileSync(out, JSON.stringify({ tests: baseline.total, techniques: TECHNIQUES, putBacks: results }, null, 2) + '\n');
  console.log(`wrote ${out}`);
}
