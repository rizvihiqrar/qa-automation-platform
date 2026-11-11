import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, repoRoot } from '../src/build.ts';
import { METRICS, monthName, toMarkdown, type ReportInput } from '../src/report.ts';
import type { Run } from '../src/metrics.ts';
import type { IssueLike } from '../src/escaped.ts';

const base: ReportInput = {
  month: '2026-11',
  repo: 'o/r',
  generated: '2026-11-30',
  flaky: { flaky: 1, total: 20, rate: 0.05 },
  red: { fixHours: [2, 4, 30], medianHours: 4, stillRed: null },
  time: { count: 20, medianMinutes: 11.5, p90Minutes: 18 },
  escaped: { escaped: [], caughtBeforeMain: 0, byLayer: [], withoutTest: [] },
  problems: [],
};

const headings = (md: string) => [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]!);

test('the report shows exactly the four metrics, each with what it counts, why it is tracked and how it can mislead', () => {
  const md = toMarkdown(base);
  assert.deepEqual(headings(md).filter((h) => (METRICS as readonly string[]).includes(h)), [...METRICS]);
  for (const name of METRICS) {
    const body = md.split(`## ${name}\n`)[1]!.split('\n## ')[0]!;
    for (const label of ['What it counts:', 'Why it is tracked:', 'How it can mislead:']) assert.ok(body.includes(label), `${name} has "${label}"`);
  }
});

test('the report has no number-of-tests or coverage metric, and says why it leaves them out', () => {
  const md = toMarkdown(base);
  const table = md.split('\n## ')[0]!;
  assert.doesNotMatch(table, /\|\s*(number of tests|test count|coverage)/i);
  assert.match(md, /## Left Out On Purpose[\s\S]*number of tests and code coverage are not here/);
});

test('the summary table gives the value of each metric', () => {
  const table = toMarkdown(base).split('\n## ')[0]!;
  assert.match(table, /\| Flaky rate \| 5\.0% \(1 of 20 runs\) \|/);
  assert.match(table, /\| Time to fix a red main \| median 4\.0 h over 3 reds \|/);
  assert.match(table, /\| CI run time \| median 11\.5 min, slowest tenth 18\.0 min \|/);
  assert.match(table, /\| Escaped bugs \| 0 \(0 more caught before main\) \|/);
});

test('a red main that has not ended is shown as still red, with how long (the break: leave it out)', () => {
  const md = toMarkdown({ ...base, red: { fixHours: [], medianHours: null, stillRed: { since: '2026-11-10T09:30:00Z', hours: 52 } } });
  assert.match(md, /\*\*Still red:\*\* since 2026-11-10 09:30 UTC, 2\.2 days so far/);
  assert.match(md, /median none ended over 0 reds/);
});

test('a month with no runs says so instead of printing zero or NaN', () => {
  const md = toMarkdown({ ...base, flaky: { flaky: 0, total: 0, rate: null }, red: { fixHours: [], medianHours: null, stillRed: null }, time: { count: 0, medianMinutes: null, p90Minutes: null } });
  assert.match(md, /\| Flaky rate \| no runs \(0 of 0 runs\) \|/);
  assert.match(md, /main was never red/);
  assert.doesNotMatch(md, /NaN|undefined|null/);
});

test('escaped bugs are listed with their layer, test count and a link, and the ones with no test are named', () => {
  const entry = { id: 'x', title: 'A | B bug', found: '2026-11-03', escaped: true, layer: 'unit' as const, shouldHaveCaught: 's', testsAdded: [], source: 'docs/rca/01-x.md' };
  const md = toMarkdown({ ...base, escaped: { escaped: [entry], caughtBeforeMain: 2, byLayer: [{ layer: 'unit', count: 1 }], withoutTest: [entry] } });
  assert.match(md, /\| \[A \\\| B bug\]\(\.\.\/\.\.\/\.\.\/docs\/rca\/01-x\.md\) \| 2026-11-03 \| unit \| 0 \|/);
  assert.match(md, /By layer: unit 1\./);
  assert.match(md, /\*\*Still without a test:\*\* A \| B bug\./);
});

test('issues the report could not read are listed, so a half-filled form is not a quiet zero', () => {
  const md = toMarkdown({ ...base, problems: [{ source: 'https://github.com/o/r/issues/9', message: '#9: "Which layer missed it" must be one of unit' }] });
  assert.match(md, /## Issues that need fixing[\s\S]*#9: "Which layer missed it"[\s\S]*\(\[issue\]\(https:\/\/github\.com\/o\/r\/issues\/9\)\)/);
});

test('a title with brackets or parentheses cannot break the link in the table', () => {
  const entry = { id: 'x', title: 'Fix [a] (b) bug', found: '2026-11-03', escaped: true, layer: 'unit' as const, shouldHaveCaught: 's', testsAdded: ['t'], source: 'https://github.com/o/r/issues/1' };
  const md = toMarkdown({ ...base, escaped: { escaped: [entry], caughtBeforeMain: 0, byLayer: [{ layer: 'unit', count: 1 }], withoutTest: [] } });
  assert.match(md, /\| \[Fix \\\[a\\\] \(b\) bug\]\(https:\/\/github\.com\/o\/r\/issues\/1\) \|/);
});

test('the headline escaped-bug number says when issues could not be read, so it is not mistaken for the whole truth', () => {
  const md = toMarkdown({ ...base, problems: [{ source: 'u', message: 'm' }, { source: 'v', message: 'n' }] });
  assert.match(md.split('\n## ')[0]!, /\| Escaped bugs \| 0 \(0 more caught before main\), plus 2 issues not read \(see below\) \|/);
});

test('month names read in words', () => {
  assert.equal(monthName('2026-01'), 'January 2026');
  assert.equal(monthName('2026-12'), 'December 2026');
});

// End to end on small saved samples: runs and issues in, report out, same every time.
const run = (day: string, conclusion: string, attempt = 1): Run => ({ id: Number(day.replace(/\D/g, '')), createdAt: `${day}T10:00:00Z`, startedAt: `${day}T10:00:00Z`, updatedAt: `${day}T10:12:00Z`, attempt, conclusion, firstAttempt: attempt > 1 ? 'failure' : null });
const runs = [run('2026-11-01', 'success'), run('2026-11-02', 'failure'), run('2026-11-03', 'success', 2), run('2026-10-20', 'failure')];
const issues: IssueLike[] = [
  { number: 3, title: 'Refund email sent twice', created_at: '2026-11-04T09:00:00Z', html_url: 'https://github.com/o/r/issues/3', body: '### Which layer missed it\n\nintegration\n\n### Which test should have caught it\n\nA retry test\n\n### Test added\n\nretry.test: refund once\n' },
  { number: 4, title: 'Half filled', created_at: '2026-11-05T09:00:00Z', html_url: 'https://github.com/o/r/issues/4', body: '' },
];

test('buildReport joins the saved runs, the seed and the issues into one report for the month', () => {
  const md = buildReport({ month: '2026-11', repo: 'o/r', now: '2026-11-30T12:00:00Z', runs, issues, root: repoRoot });
  assert.match(md, /# Quality Report: November 2026/);
  assert.match(md, /\| Flaky rate \| 33\.3% \(1 of 3 runs\) \|/); // the 2026-10-20 run is another month
  assert.match(md, /median 6\.5 days over 2 reds/); // 24 h on 2 to 3 November, and the red from 20 October that ended on 1 November
  assert.match(md, /Refund email sent twice/);
  assert.match(md, /Game day: the line to the database was cut/); // the seed entry found on 2026-11-09
  assert.match(md, /#4: "Which layer missed it" must be one of/);
  assert.equal(buildReport({ month: '2026-11', repo: 'o/r', now: '2026-11-30T12:00:00Z', runs, issues, root: repoRoot }), md, 'same input, same report');
});
