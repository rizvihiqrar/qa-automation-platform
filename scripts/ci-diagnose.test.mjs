// Tests for the diagnosis of a confirmed CI failure (scripts/ci-diagnose.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorLines, ciCommands, report } from './ci-diagnose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('error lines: real failures kept, timestamps and colours stripped, noise and expected failures dropped', () => {
  const log = [
    '2026-10-18T23:05:29.3381938Z ✔ a passing test',
    '2026-10-18T23:05:30.0000000Z Received 6743643 of 6743643 (100.0%), 8.7 MBs/sec',
    '2026-10-18T23:05:41.1736975Z   ✘   1 tests/review/helpers.js:24:3 › RV-01: cart [known defect] (6.7s)',
    '2026-10-18T23:06:05.0694619Z   \u001b[31m✘  26 tests/review/session.spec.js:12:5 › RV-17: glitch user (5.5s)\u001b[39m',
    '2026-10-18T23:06:19.5559696Z     Error: expect(locator).toHaveText(expected) failed',
    '2026-10-18T23:06:19.5559696Z     Error: expect(locator).toHaveText(expected) failed',
    '2026-10-18T23:06:20.0000000Z ##[error]Process completed with exit code 1.',
  ].join('\n');
  assert.deepEqual(errorLines(log), [
    '  ✘  26 tests/review/session.spec.js:12:5 › RV-17: glitch user (5.5s)',
    '    Error: expect(locator).toHaveText(expected) failed',
  ]);
});

test('error lines are capped, saying how many more there were', () => {
  const log = Array.from({ length: 20 }, (_, i) => `Error: number ${i}`).join('\n');
  const lines = errorLines(log, 5);
  assert.equal(lines.length, 6);
  assert.equal(lines.at(-1), '… 15 more');
});

test('every package job in ci.yml has its command, without the smoke variant', () => {
  const yaml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const commands = ciCommands(yaml);
  const packages = [...yaml.matchAll(/- \{ package: ([\w-]+),/g)].map(([, p]) => p);
  assert.ok(packages.length > 20);
  for (const p of packages) assert.ok(commands[p], `${p} has no command`);
  assert.equal(commands['ai-test-generator'], 'npm test && npm run review && npm run test:e2e && npm run test:review');
});

test('the report names the failure, what changed since green, and a fix prompt', () => {
  const md = report({
    repo: 'me/repo',
    run: { number: 9, url: 'https://x/run/9', sha: 'abcdef1234', event: 'schedule' },
    failedJobs: [{ name: 'api', url: 'https://x/job/1', errors: ['Error: boom'] }, { name: 'ui', url: 'https://x/job/2', errors: [] }],
    lastGreen: { number: 8, url: 'https://x/run/8', sha: '1234567890' },
    commits: [{ sha: 'fedcba9876', message: 'Change the api' }],
    commands: { api: 'npm test' },
  });
  assert.match(md, /failed again when re-run:\*\* \[run #9\]\(https:\/\/x\/run\/9\), `abcdef1`, schedule/);
  assert.match(md, /### api\n\nRuns in `packages\/api`: `npm test`\n\n```\nError: boom\n```/);
  assert.match(md, /### ui\n\n_No error lines found; open the log._/);
  assert.match(md, /- `fedcba9` Change the api/);
  assert.match(md, /```text\nFix the CI failure on main of me\/repo\..*Failing jobs: api, ui\..*1 commit\(s\) since\./s);
  assert.match(md, /don't just retry, raise a timeout or loosen a check without saying why/);
});

test('with no commits since the last green run, the report points at the environment', () => {
  const md = report({
    repo: 'me/repo', run: { number: 9, url: 'u', sha: 'abcdef1', event: 'schedule' }, failedJobs: [],
    lastGreen: { number: 8, url: 'g', sha: 'abcdef1' }, commits: [], commands: {},
  });
  assert.match(md, /none \(the same commit passed before: suspect the environment or a live site\)/);
});
