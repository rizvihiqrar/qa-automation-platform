// A failed or hung browser install must not cost a job its whole 20 minute timeout.
// Two things went wrong on GitHub's runners on 2026-10-22: `playwright install
// --with-deps` stalled on an Ubuntu mirror inside apt until the job was cancelled
// (ai-test-generator), and on a later run it failed at once because the runner's own
// apt held the dpkg lock (five jobs). On a slow mirror a try that is cut off leaves its apt-get
// running, which holds the lock too. scripts/install-playwright-browser.sh cuts a stalled try off
// after 120 s (300 s for the later tries), waits for any running apt to finish, and tries up to 3 times. Every workflow must
// install through it, and this test keeps new ones from calling `playwright install` directly.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

test('when apt cannot be reached the last try installs the browser without apt, and says so (the break: use --with-deps on every try)', () => {
  const script = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');
  const branch = script.match(/if \[ "\$attempt" -eq 3 \]; then\n([\s\S]*?)\n  else\n([\s\S]*?)\n  fi\n/);
  assert.ok(branch, 'the third try is a branch of its own: if attempt is 3 ... else ... fi');
  const [, last, early] = branch;
  assert.ok(last.includes('npx playwright install "${@:-chromium}"'), 'it installs the browsers asked for');
  assert.ok(!last.includes('--with-deps'), 'it does not touch apt');
  assert.match(last, /::warning::/, 'the run shows that the system packages were skipped');
  assert.ok(early.includes('--with-deps'), 'the first two tries still install the system packages');
  assert.match(script, /for attempt in 1 2 3/, 'the branch above is the last of the three tries');
  assert.match(script, /\nexit 1\n$/, 'a failed last try still fails the step');
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

// 2026-11-11: ten jobs failed with "Temporary failure resolving 'security.ubuntu.com'". The script now
// waits for the Ubuntu hosts to resolve before each try that uses apt.
const dnsFunction = () => fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8').replaceAll(String.fromCharCode(13), '').match(/^wait_for_dns\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
const runWaitForDns = (getentBody) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-'));
  const counter = path.join(dir, 'count').split(path.sep).join('/');
  fs.writeFileSync(path.join(dir, 'getent'), `#!/usr/bin/env bash\nn=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${counter}"\n${getentBody}\n`, { mode: 0o755 });
  const result = spawnSync('bash', ['-c', `${dnsFunction()}\nwait_for_dns`], { env: { ...process.env, PATH: `${dir.split(path.sep).join('/')}${path.delimiter}${process.env.PATH}`, DNS_WAIT: '0' }, encoding: 'utf8' });
  const looks = Number(fs.readFileSync(path.join(dir, 'count'), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, looks };
};

test('the install script waits for DNS before a try that uses apt, and installs without apt if it never answers (the break: remove the wait)', () => {
  const script = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');
  assert.ok(dnsFunction(), 'the script defines wait_for_dns');
  const lf = script.replaceAll(String.fromCharCode(13), '');
  const loop = lf.slice(lf.indexOf('for attempt'));
  const early = loop.match(/\n  else\n([\s\S]*?)\n  fi\n/)[1];
  assert.ok(early.indexOf('wait_for_dns') !== -1 && early.indexOf('wait_for_dns') < early.indexOf('--with-deps'), 'wait for DNS before the with-deps install');
  assert.match(early, /::warning::[^\n]*resolves/, 'the run shows that DNS was down');
  assert.ok(!early.slice(early.indexOf('else')).includes('playwright install'), 'a try skipped for DNS does not install and exit: the next try uses apt again');
  assert.ok(script.indexOf('wait_for_dns()') < script.indexOf('for attempt'), 'defined before the first try');
});

test('wait_for_dns returns at once when the hosts resolve, retries through a blip, accepts any one host, and gives up after six looks', () => {
  assert.deepEqual(runWaitForDns('exit 0'), { status: 0, looks: 1 });
  assert.deepEqual(runWaitForDns('[ "$n" -ge 5 ]'), { status: 0, looks: 5 });
  assert.deepEqual(runWaitForDns('exit 2'), { status: 1, looks: 18 });
  // one host answering is enough (the Azure mirror can be up while security.ubuntu.com is not)
  assert.deepEqual(runWaitForDns('[ "$n" -ge 3 ]'), { status: 0, looks: 3 });
});
