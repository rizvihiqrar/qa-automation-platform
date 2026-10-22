// A failed or hung browser install must not cost a job its whole 20 minute timeout.
// Two things went wrong on GitHub's runners on 2026-10-22: `playwright install
// --with-deps` stalled on an Ubuntu mirror inside apt until the job was cancelled
// (ai-test-generator), and on a later run it failed at once because the runner's own
// apt held the dpkg lock (five jobs). On a slow mirror a try that is cut off leaves its apt-get
// running, which holds the lock too. scripts/install-playwright-browser.sh cuts a stalled try off
// after 300 s, waits for any running apt to finish, and tries up to 3 times. Every workflow must
// install through it, and this test keeps new ones from calling `playwright install` directly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const SCRIPT = 'scripts/install-playwright-browser.sh';

const linesOf = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line, i) => ({ where: `${path.basename(file)}:${i + 1}`, line }));
const workflowLines = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) => linesOf(path.join(WORKFLOWS, f)));

test('the install script retries three times under a timeout, and waits for a running apt between', () => {
  const script = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');
  assert.match(script, /for attempt in 1 2 3/);
  assert.match(script, /timeout -k 10 300 npx playwright install --with-deps chromium/);
  assert.match(script, /pgrep -x/);
});

test('workflows install the browser through the script, never directly', () => {
  const direct = workflowLines.filter(({ line }) => line.includes('playwright install'));
  assert.deepEqual(direct.map((d) => d.where), [], 'call the script instead of `playwright install`');
  const viaScript = workflowLines.filter(({ line }) => line.includes('install-playwright-browser.sh'));
  assert.ok(viaScript.length >= 4, `found ${viaScript.length} steps that use the script`);
});
