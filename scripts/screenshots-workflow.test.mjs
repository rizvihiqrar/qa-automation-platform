// H2: the dashboard pictures at the top of README.md are retaken every Monday by
// .github/workflows/screenshots.yml. main only accepts pull requests, so they are saved on the
// screenshots branch and the README links to the raw files there. This keeps the three in step:
// the workflow, the capture script and the README links. The workflow runs unattended, so its
// promises are checked here instead of by watching it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { triggers } from './ci-health.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const yaml = read('.github', 'workflows', 'screenshots.yml');
const code = yaml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const readme = read('README.md');
const capture = read('scripts', 'screenshots', 'capture.mjs');
const RAW = 'https://raw.githubusercontent.com/rizvihiqrar/qa-automation-platform/screenshots/';

/** The pictures the workflow takes: the names after `npm run capture --`. */
const taken = () => (code.match(/npm run capture -- ([^\n]+)/)?.[1] ?? '').trim().split(/\s+/);

test('runs weekly and by hand, off the hour', () => {
  assert.deepEqual(triggers(yaml).sort(), ['schedule', 'workflow_dispatch']);
  const cron = code.match(/cron:\s*'([^']+)'/)?.[1] ?? '';
  const [minute, , , , weekday] = cron.split(' ');
  assert.match(weekday, /^[0-6]$/, 'one day a week');
  assert.notEqual(minute, '0', 'GitHub delays and drops runs queued at :00');
});

test('may write contents and nothing else, and only pushes to the screenshots branch', () => {
  const block = code.match(/^permissions:\n((?:  .*\n)+)/m)?.[1] ?? '';
  assert.deepEqual(block.trim().split('\n').map((l) => l.trim().split(/\s+/)[0]), ['contents:']);
  const pushes = code.split('\n').filter((l) => /git push/.test(l));
  assert.ok(pushes.length >= 1);
  for (const line of pushes) assert.match(line, /refs\/heads\/screenshots\s*$/, `pushes to main? ${line.trim()}`);
  assert.doesNotMatch(code, /git push[^\n]*\bmain\b/);
});

test('a failed capture is never hidden, so the branch keeps the last good pictures', () => {
  assert.doesNotMatch(code, /continue-on-error/);
  assert.doesNotMatch(code, /\|\|\s*true/);
  assert.doesNotMatch(code, /set \+e|if: always\(\)/, 'no step runs after a failure');
  assert.match(capture, /if \(!response\?\.ok\(\)\) throw/, 'capture.mjs throws on an error page');
  // A 200 page that has not drawn its numbers is also an error.
  for (const name of taken()) assert.match(capture, new RegExp(`name: '${name}'[^\n]*waitRequired: true`), `${name} must wait for its numbers`);
});

test('the capture script saves where the workflow looks', () => {
  assert.match(code, /SCREENSHOT_OUT: \$\{\{ github\.workspace \}\}\/screenshots/);
  assert.match(capture, /process\.env\.SCREENSHOT_OUT \?\?/);
});

test('every picture the workflow takes exists in capture.mjs, and the README links exactly those', () => {
  const names = taken();
  assert.deepEqual(names, ['dashboard', 'dashboard-dark']);
  for (const name of names) assert.match(capture, new RegExp(`name: '${name}'`), `capture.mjs has "${name}"`);
  const links = [...readme.matchAll(/https:\/\/raw\.githubusercontent\.com\/[^\s"]+\.png/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(links)].sort(), names.map((n) => `${RAW}${n}.png`).sort());
});

test('the README no longer says when the picture was taken', () => {
  assert.doesNotMatch(readme, /as it looked on \d{4}-\d{2}-\d{2}/);
});
