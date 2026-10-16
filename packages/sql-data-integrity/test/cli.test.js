import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';
import { parseCheck } from '../src/integrity.js';
import { createDemoDatabase } from '../src/integrity.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('parseArgs defaults to the clean dataset and text output', () => {
  assert.deepEqual(parseArgs([]), { dataset: 'clean', db: null, format: 'text' });
});

test('parseArgs rejects unknown options and conflicting sources', () => {
  assert.throws(() => parseArgs(['--dataset', 'prod']), /Unknown dataset/);
  assert.throws(() => parseArgs(['--format', 'html']), /Unknown format/);
  assert.throws(() => parseArgs(['--dataset', 'demo', '--db', 'x.db']), /not both/);
});

test('parseCheck needs every header and a known severity', () => {
  assert.throws(() => parseCheck('-- id: a\n-- severity: error\nSELECT 1;'), /needs id, severity and description/);
  assert.throws(() => parseCheck('-- id: a\n-- severity: high\n-- description: d\nSELECT 1;'), /unknown severity/);
  assert.equal(parseCheck('-- id: a\n-- severity: warning\n-- description: d\nSELECT 1;').id, 'a');
});

test('CLI exits 0 on clean data', () => {
  const res = run();
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /15\/15 checks passed, 0 error\(s\), 0 warning\(s\), 0 bad row\(s\)/);
});

test('CLI exits 1 on the demo dataset and lists the bad rows', () => {
  const res = run('--dataset', 'demo');
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL  order_total_mismatch/);
  assert.match(res.stdout, /order_id=1, total_cents=5197, items_total_cents=4997/);
  assert.match(res.stdout, /warn  invalid_emails/);
});

test('CLI prints a Markdown table', () => {
  const res = run('--dataset', 'demo', '--format', 'md');
  assert.match(res.stdout, /^\*\*9\/15 checks passed\*\*/);
  assert.match(res.stdout, /\| FAIL \| `payment_mismatch` \| 1 \|/);
});

test('CLI checks an existing SQLite file', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-')), 'shop.db');
  const db = await createDemoDatabase();
  fs.writeFileSync(file, Buffer.from(db.export()));
  const res = run('--db', file);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /9\/15 checks passed, 5 error\(s\), 1 warning\(s\)/);
});

test('CLI exits 2 with a message for a missing file', () => {
  const res = run('--db', 'does-not-exist.db');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such file|ENOENT/i);
});
