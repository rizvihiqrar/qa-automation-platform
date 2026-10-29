// The Monitor workflow (.github/workflows/monitor.yml) runs unattended every 30 minutes, so its
// promises are checked here instead of by watching it: it runs on a schedule, a down site never
// fails it, it never writes to main, and a result is saved before the alert step can fail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { triggers } from './ci-health.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'monitor.yml'), 'utf8');
const code = yaml.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
const at = (needle) => {
  const i = code.indexOf(needle);
  assert.notEqual(i, -1, `monitor.yml has "${needle}"`);
  return i;
};

test('runs on a schedule and by hand', () => {
  assert.deepEqual(triggers(yaml).sort(), ['schedule', 'workflow_dispatch']);
});

test('the schedule is every 30 minutes, off the hour', () => {
  const cron = code.match(/cron:\s*'([^']+)'/)?.[1];
  assert.match(cron ?? '', /^\d+,\d+ \* \* \* \*$/, 'two minutes an hour');
  const [a, b] = cron.split(' ')[0].split(',').map(Number);
  assert.equal((((b - a) % 60) + 60) % 60, 30, 'the two minutes are half an hour apart');
  assert.ok(a !== 0 && b !== 0, 'GitHub delays and drops runs queued at :00');
});

test('runs one at a time and never cancels a run that is saving', () => {
  assert.match(code, /concurrency:\s*\n\s+group: monitor\s*\n\s+cancel-in-progress: false/);
});

test('may write contents and issues and nothing else', () => {
  const block = code.match(/^permissions:\n((?:  .*\n)+)/m)?.[1] ?? '';
  assert.deepEqual(block.trim().split('\n').map((l) => l.trim().split(/\s+/)[0]).sort(), ['contents:', 'issues:']);
  assert.match(block, /contents: write/);
});

test('a down site cannot fail the workflow: no step hides a failure and none turns a result into an error', () => {
  assert.doesNotMatch(code, /continue-on-error/);
  assert.doesNotMatch(code, /\|\|\s*true/);
  // The only way run.ts fails is MonitorBroken or a crash; the workflow has no other check on the sites.
  assert.doesNotMatch(code, /exit 1/);
});

test('pushes only to the monitoring-data branch, never to main', () => {
  const pushes = code.split('\n').filter((l) => /git push/.test(l));
  assert.equal(pushes.length, 1);
  assert.match(pushes[0], /git push --force origin HEAD:refs\/heads\/monitoring-data$/);
  assert.doesNotMatch(code, /git (checkout|switch) main|refs\/heads\/main/);
});

test('the history is saved before the alert step, so an issue problem never loses a result', () => {
  assert.ok(at('node src/run.ts') < at('git push --force') && at('git push --force') < at('node src/alert.ts'));
});

test('the alert step still runs when saving failed, but not when the check itself broke', () => {
  assert.match(code, /id: check/);
  assert.match(code, /if: always\(\) && steps\.check\.outcome == 'success'/);
});

test('only a missing branch starts a new history: any other lookup failure stops the run', () => {
  assert.match(code, /elif \[ "\$found" -eq 2 \]; then\s+git worktree add --orphan/);
  assert.match(code, /else\s+echo "::error::[^\n]*\s+exit "\$found"/);
});

test('the branch keeps one commit: each run replaces the last', () => {
  assert.match(code, /git commit -q --amend/);
});

test('a fork does not run its own copy', () => {
  assert.match(code, /if: github\.repository == 'rizvihiqrar\/qa-automation-platform'/);
});

test('installs the browser through the shared script', () => {
  assert.ok(code.includes('scripts/install-playwright-browser.sh'));
  assert.doesNotMatch(code, /playwright install/);
});

test('has a time limit, so a stalled run cannot hold the next ones', () => {
  assert.match(code, /timeout-minutes: (\d+)/);
  assert.ok(Number(code.match(/timeout-minutes: (\d+)/)[1]) <= 15);
});

// The Dashboard workflow shows the monitoring history (packages/ci-dashboard/src/monitoring.js).
const dashboard = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'dashboard.yml'), 'utf8')
  .split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');

test('the dashboard is rebuilt on a schedule too, so the uptime section is never old', () => {
  assert.ok(triggers(dashboard).includes('schedule'));
  const hours = Number(dashboard.match(/cron:\s*'\d+ \*\/(\d+) \* \* \*'/)?.[1]);
  assert.ok(hours >= 1 && hours <= 3, `rebuilt every ${hours} hours`);
});

test('the dashboard fetches the summary from monitoring-data, and a missing or broken one never fails the build', () => {
  assert.match(dashboard, /git show FETCH_HEAD:summary\.json > monitoring-summary\.json/);
  assert.match(dashboard, /if ! \{ git fetch --depth 1 origin monitoring-data && git show/, 'a failed fetch or show is caught (the step runs under bash -e)');
  assert.match(dashboard, /elif \[ "\$found" -ne 2 \]; then\s+echo "::warning::/, 'only "no such branch" is silent');
  assert.match(dashboard, /--monitoring monitoring-summary\.json/);
  assert.ok(dashboard.indexOf('monitoring-summary.json') < dashboard.indexOf('node packages/ci-dashboard/src/build.js'));
});
