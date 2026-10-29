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
  assert.equal(b - a, 30);
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
  assert.match(pushes[0], /refs\/heads\/monitoring-data$/);
  assert.doesNotMatch(code, /git (checkout|switch) main|refs\/heads\/main/);
});

test('the history is saved before the alert step, so an issue problem never loses a result', () => {
  assert.ok(at('node src/run.ts') < at('git push') && at('git push') < at('node src/alert.ts'));
});

test('installs the browser through the shared script', () => {
  assert.ok(code.includes('scripts/install-playwright-browser.sh'));
  assert.doesNotMatch(code, /playwright install/);
});

test('has a time limit, so a stalled run cannot hold the next ones', () => {
  assert.match(code, /timeout-minutes: (\d+)/);
  assert.ok(Number(code.match(/timeout-minutes: (\d+)/)[1]) <= 15);
});
