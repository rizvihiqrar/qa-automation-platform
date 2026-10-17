import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRuns, type PlaywrightReport, type PlaywrightTest } from '../src/analyze.ts';
import { buildFlakyList, planIssues, flakyBody, summaryMarkdown, issueTitle, MIN_CLEAN_RUNS, type Issue } from '../src/tracker.ts';

type Status = PlaywrightTest['status'];
const ID = 'cart.spec.js > adds an item [default]';

// One report per run; each run lists a status per test title.
const report = (tests: Record<string, Status>): PlaywrightReport => ({
  suites: [{ file: 'cart.spec.js', specs: Object.entries(tests).map(([title, status]) => ({ title, file: 'cart.spec.js', tests: [{ status }] })), suites: [] }],
});
// Runs named 101, 102, ... from a status per run for the 'adds an item' test.
const history = (...statuses: Status[]) => statuses.map((status, i) => ({ run: String(101 + i), report: report({ 'adds an item': status }) }));
const plan = (runs: ReturnType<typeof history>, open: Issue[] = []) => {
  const rows = analyzeRuns(runs);
  const list = buildFlakyList(rows, runs.map((r) => r.run), '2026-10-17T00:00:00.000Z');
  return { list, actions: planIssues(list, rows, open) };
};
const issue = (body = 'old body', id = ID): Issue => ({ number: 7, title: issueTitle(id), body });

test('analyzeRuns records the runs where a test was unstable, oldest first', () => {
  const [row] = analyzeRuns(history('expected', 'flaky', 'expected', 'unexpected'));
  assert.deepEqual(row?.unstableRuns, ['102', '104']);
});

test('buildFlakyList keeps flaky tests and lists broken ones separately', () => {
  const runs = [
    { run: '1', report: report({ shaky: 'flaky', broken: 'unexpected', fine: 'expected' }) },
    { run: '2', report: report({ shaky: 'expected', broken: 'unexpected', fine: 'expected' }) },
  ];
  const list = buildFlakyList(analyzeRuns(runs), ['1', '2'], 'now');
  assert.deepEqual(list.flaky.map((e) => e.id), ['cart.spec.js > shaky [default]']);
  assert.deepEqual(list.failing, ['cart.spec.js > broken [default]']);
  assert.deepEqual(list.runs, ['1', '2']);
});

test('a newly flaky test gets an issue', () => {
  const { actions } = plan(history('expected', 'flaky', 'expected'));
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, 'open');
  assert.equal(actions[0]?.title, `Flaky test: ${ID}`);
});

test('a test that passed on retry and one that failed between passes are both flaky', () => {
  assert.equal(plan(history('expected', 'unexpected', 'expected')).actions[0]?.kind, 'open');
});

test('an open issue is refreshed when the counts change, and left alone when they do not', () => {
  const runs = history('flaky', 'expected');
  const { list, actions } = plan(runs, [issue()]);
  assert.deepEqual(actions.map((a) => a.kind), ['update']);
  const current = flakyBody(list.flaky[0]!, 2);
  assert.deepEqual(plan(runs, [issue(current)]).actions, []);
});

test(`an issue closes once the test passed first time in at least ${MIN_CLEAN_RUNS} runs`, () => {
  const { actions } = plan(history(...Array<Status>(MIN_CLEAN_RUNS).fill('expected')), [issue()]);
  assert.equal(actions[0]?.kind, 'close');
  const comment = actions[0]?.kind === 'close' ? actions[0].comment : '';
  assert.match(comment, /all 5 of the last 5/);
  // 5 clean runs only rule out flake rates above 45%; the comment must not overclaim.
  assert.match(comment, /flake rate is now below 45% \(95% confidence\)\. That rules out frequent flakes, not rare ones/);
});

test('one or two clean runs are not enough to close an issue', () => {
  assert.deepEqual(plan(history('expected', 'expected'), [issue()]).actions, []);
});

test('a test that now fails every run keeps its issue open, marked as broken', () => {
  const { actions } = plan(history('unexpected', 'unexpected', 'unexpected'), [issue()]);
  assert.equal(actions[0]?.kind, 'update');
  assert.match(actions[0]?.kind === 'update' ? actions[0].body : '', /fails in every one of the last 3/);
});

test('an issue for a test that is no longer in the suite closes, but only with enough history', () => {
  const gone = issue('body', 'cart.spec.js > renamed test [default]');
  assert.equal(plan(history(...Array<Status>(MIN_CLEAN_RUNS).fill('expected')), [gone]).actions[0]?.kind, 'close');
  assert.deepEqual(plan(history('expected'), [gone]).actions, []);
});

test('issues with the label that this tool did not open are left alone', () => {
  const manual: Issue = { number: 3, title: 'Login is slow on Mondays', body: '' };
  assert.deepEqual(plan(history(...Array<Status>(MIN_CLEAN_RUNS).fill('expected')), [manual]).actions, []);
});

test('the issue body links each unstable run and states the closing rule', () => {
  const { list } = plan(history('flaky', 'expected', 'unexpected', 'expected'));
  const body = flakyBody(list.flaky[0]!, 4, (run) => `[run ${run}](https://example.test/${run})`);
  assert.match(body, /Unstable in \*\*2 of 4\*\* runs \(flake rate 50%, 95% CI 15%–85%\)/);
  assert.match(body, /\[run 101\]\(https:\/\/example\.test\/101\), \[run 103\]/);
  assert.match(body, /at least 5 times/);
  assert.match(body, /4 clean runs only show the flake rate is below 53% \(95% confidence\)/);
});

test('summaryMarkdown lists flaky tests and planned changes, and says when nothing was applied', () => {
  const { list, actions } = plan(history('flaky', 'expected'));
  const md = summaryMarkdown(list, actions, false);
  assert.match(md, /Flaky tests: 1 over the last 2 CI runs/);
  assert.match(md, /\| cart\.spec\.js > adds an item \[default\] \| 2 \| 1 \| 0 \| 50% \|/);
  assert.match(md, /dry run: nothing changed/);
  assert.match(md, /- Open: Flaky test:/);
  assert.match(summaryMarkdown(plan(history('expected')).list, [], true), /No test needed a retry[\s\S]*No changes\./);
});
