// A failed or hung browser install must not cost a job its whole 20 minute timeout.
// Two things went wrong on GitHub's runners on 2026-10-22: `playwright install
// --with-deps` stalled on an Ubuntu mirror inside apt until the job was cancelled
// (ai-test-generator), and on a later run it failed at once because the runner's own
// apt held the dpkg lock (five jobs). On a slow mirror a try that is cut off leaves its apt-get
// running, which holds the lock too. scripts/install-playwright-browser.sh cuts a stalled try off
// after 120 s (300 s for the later tries), waits for any running apt to finish, and tries up to 3 times. Every workflow must
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
  assert.ok(script.includes('timeout -k 10 "$limit" npx playwright install --with-deps "${@:-chromium}"'), 'chromium unless browsers are named');
  // A healthy install takes 21 to 42 s; a stalled mirror must not cost the first try 300 s (2026-10-26).
  const first = Number(script.match(/\[ "\$attempt" -gt 1 \] \|\| limit=(\d+)/)?.[1]);
  const later = Number(script.match(/^  limit=(\d+)$/m)?.[1]);
  assert.ok(Number.isFinite(first) && Number.isFinite(later), 'the script sets `limit=<later>` and `|| limit=<first>` (the test reads those two lines)');
  assert.ok(first >= 90 && first <= 150, `the first try is cut off after ${first} s: long enough for a slow healthy install, short enough to fail over early`);
  assert.ok(later >= 300, `later tries keep ${later} s so a slow mirror can still finish`);
  assert.match(script, /pgrep -x/);
  // apt gives up on a silent mirror after 20 s and retries, before playwright runs it
  assert.match(script, /Acquire::http::Timeout "20"/);
  assert.match(script, /Acquire::https::Timeout "20"/);
  assert.match(script, /Acquire::Retries "3"/);
  assert.ok(script.indexOf('Acquire::Retries') < script.indexOf('for attempt'), 'set before the first try');
});

test('workflows install the browser through the script, never directly', () => {
  const direct = workflowLines.filter(({ line }) => line.includes('playwright install'));
  assert.deepEqual(direct.map((d) => d.where), [], 'call the script instead of `playwright install`');
  const viaScript = workflowLines.filter(({ line }) => line.includes('install-playwright-browser.sh'));
  assert.ok(viaScript.length >= 4, `found ${viaScript.length} steps that use the script`);
});

test('a stalled try is cleaned up, and the next try uses another mirror', () => {
  const script = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');
  const loop = script.slice(script.indexOf('for attempt'));
  // The orphaned apt-get of a cut-off try is stopped, but never while dpkg is installing.
  assert.match(loop, /pgrep -x dpkg[\s\S]*sudo pkill -x 'apt-get'/);
  assert.match(loop, /sudo dpkg --configure -a/);
  // Only after a failed try, and before the next one, apt is pointed at the main archive.
  const failed = loop.indexOf('failed.');
  const mirror = loop.indexOf('archive.ubuntu.com');
  assert.ok(failed !== -1 && mirror > failed, 'switch the mirror after a failed try, not before the first');
  assert.ok(loop.includes('azure\\.archive\\.ubuntu\\.com'), 'the Azure mirror is replaced');
  assert.ok(loop.includes('mirror\\+file:/etc/apt/apt-mirrors\\.txt'), 'the mirror list file is replaced');
  // A lock that is still held says who holds it.
  assert.match(loop, /ps -eo pid,etimes,args/);
});

// CI run 40954762292 (2026-10-29): Docker Hub answered 502 for the postgres image, and the Langfuse
// step failed at once; the re-run passed. Pulling from a registry is tried up to 3 times.
test('the Langfuse start retries its image pull', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const step = ci.slice(ci.indexOf('- name: Start Langfuse'), ci.indexOf('- run: npm ci', ci.indexOf('- name: Start Langfuse')));
  assert.match(step, /for attempt in 1 2 3/);
  assert.match(step, /docker compose[^\n]*up -d[^\n]*&& exit 0/);
  assert.match(step, /exit 1/, 'fails after the third try');
});
