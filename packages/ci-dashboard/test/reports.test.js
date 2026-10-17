import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { redact, findSecrets, unzipTexts, embeddedZip, findEntry, resultFor, buildReports, renderReportsPage } from '../src/reports.js';

// Shaped like real tokens, but made up.
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwidXNlciI6ImRlbW8ifQ.c2lnbmF0dXJlLXZhbHVl';
const GH = `ghp_${'a1B2'.repeat(9)}`;

/**
 * A minimal zip writer, so tests use real archives.
 * @param {Array<{ name: string, text: string, deflate?: boolean }>} entries
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text, deflate = true } of entries) {
    const raw = Buffer.from(text);
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const playwrightHtml = (/** @type {Buffer} */ z) => `<html><script>window.playwrightReportBase64 = "data:application/zip;base64,${z.toString('base64')}";</script></html>`;

/** Writes files (path -> content) under a fresh temp folder and returns it. */
function tempTree(/** @type {Record<string, string | Buffer>} */ files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-test-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

test('redact replaces each kind of secret and counts them', () => {
  const input = [
    `accessToken=${JWT}`,
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123',
    `token ${GH}`,
    `key sk-ant-api03-${'x'.repeat(24)}`,
    'at C:\\Users\\someone\\project\\test.js and C:/Users/someone/x and C:\\\\Users\\\\someone\\\\y',
  ].join('\n');
  const { text, redactions } = redact(input);
  assert.equal(redactions, 7);
  for (const leaked of [JWT, 'abcdefghijklmnopqrstuvwxyz0123', GH, 'sk-ant-api03', 'someone']) assert.ok(!text.includes(leaked), leaked);
  assert.match(text, /\[redacted JWT\]/);
  assert.match(text, /\[redacted local user path\]\\project\\test\.js/);
});

test('redact leaves ordinary report text alone, including the public demo password', () => {
  const ordinary = 'Fill "secret_sauce" · /home/runner/work/repo · expected 200, got 200 · eyJust-a-word';
  assert.deepEqual(redact(ordinary), { text: ordinary, redactions: 0 });
  assert.deepEqual(findSecrets(ordinary), []);
  assert.deepEqual(findSecrets(`a ${JWT} and ${GH}`), ['JWT', 'GitHub token']);
});

test('unzipTexts reads stored and deflated entries', () => {
  const entries = unzipTexts(zip([{ name: 'report.json', text: '{"ok":true}' }, { name: 'a/b.txt', text: 'stored', deflate: false }]));
  assert.deepEqual(entries, [{ name: 'report.json', text: '{"ok":true}' }, { name: 'a/b.txt', text: 'stored' }]);
  assert.throws(() => unzipTexts(Buffer.from('not a zip at all, just text padding it out')), /not a zip/);
});

test('embeddedZip finds the archive in a Playwright report and nothing in other pages', () => {
  const z = zip([{ name: 'x.json', text: 'hi' }]);
  assert.deepEqual(embeddedZip(playwrightHtml(z)), z);
  assert.equal(embeddedZip('<html><body>Cucumber report</body></html>'), null);
});

test('findEntry prefers index.html, then the shallowest page, then Markdown', () => {
  assert.equal(findEntry(['data/x.png', 'playwright-report/index.html', 'index.html']), 'index.html');
  assert.equal(findEntry(['reports/mutation/mutation.html', 'reports/a.json']), 'reports/mutation/mutation.html');
  assert.equal(findEntry(['reports/REPORT-before.md', 'reports/REPORT-after.md']), 'reports/REPORT-after.md');
  assert.equal(findEntry(['results.json']), null);
});

test('resultFor maps a report to its jobs, counting only the last attempt', () => {
  const jobs = [
    { name: 'bdd-playwright-demo', conclusion: 'failure', attempt: 1 },
    { name: 'bdd-playwright-demo', conclusion: 'success', attempt: 2 },
    { name: 'regression scope', conclusion: 'failure' },
    { name: 'regression (shard 1/3)', conclusion: 'success' },
    { name: 'regression (shard 2/3)', conclusion: 'failure' },
    { name: 'regression report', conclusion: 'success' },
    { name: 'graphql-test-suite', conclusion: 'cancelled' },
  ];
  assert.equal(resultFor('bdd-playwright-demo', jobs), 'success');
  assert.equal(resultFor('regression', jobs), 'failure');
  assert.equal(resultFor('regression', jobs.filter((j) => j.name !== 'regression (shard 2/3)')), 'success');
  assert.equal(resultFor('graphql-test-suite', jobs), 'cancelled');
  assert.equal(resultFor('not-a-job', jobs), 'unknown');
});

test('buildReports publishes clean reports, redacts text ones, and withholds zipped data with a token', () => {
  const raw = tempTree({
    'report-postman/reports/report.html': `<td>accessToken=${JWT}</td>`,
    'report-clean/playwright-report/index.html': playwrightHtml(zip([{ name: 'report.json', text: '{"title":"login works"}' }])),
    'report-clean/playwright-report/data/shot.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'report-leaky/playwright-report/index.html': playwrightHtml(zip([{ name: 'test.json', text: `{"body":"${JWT}"}` }])),
    'report-trace/playwright-report/index.html': '<html>no data</html>',
    'report-trace/playwright-report/data/trace.zip': zip([{ name: 'network.txt', text: `Authorization: Bearer ${'t'.repeat(30)}` }]),
    'report-broken/index.html': playwrightHtml(Buffer.from('PK but truncated')),
    'blob-report-1/report-1.zip': 'ignored: not a report-* folder',
  });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-out-'));
  const rows = buildReports({ rawDir: raw, outDir: out, jobs: [{ name: 'clean', conclusion: 'success' }] });

  assert.deepEqual(rows.map((r) => r.name), ['broken', 'clean', 'leaky', 'postman', 'trace']);
  const row = (/** @type {string} */ n) => rows.find((r) => r.name === n);

  assert.equal(row('postman')?.redactions, 1);
  const published = fs.readFileSync(path.join(out, 'postman/reports/report.html'), 'utf8');
  assert.ok(!published.includes(JWT));

  assert.equal(row('clean')?.withheld, null);
  assert.equal(row('clean')?.result, 'success');
  assert.ok(fs.existsSync(path.join(out, 'clean/playwright-report/data/shot.png')));

  assert.match(row('leaky')?.withheld ?? '', /playwright-report\/index\.html contains JWT/);
  assert.match(row('trace')?.withheld ?? '', /trace\.zip contains bearer token/);
  assert.match(row('broken')?.withheld ?? '', /unreadable archive/);
  for (const name of ['leaky', 'trace', 'broken']) assert.ok(!fs.existsSync(path.join(out, name)), `${name} must not be copied`);

  assert.deepEqual(buildReports({ rawDir: path.join(raw, 'missing'), outDir: out }), []);
});

test('renderReportsPage links published reports, explains withheld ones and escapes names', () => {
  const html = renderReportsPage([
    { name: 'regression', entry: 'index.html', result: 'success', redactions: 0, withheld: null },
    { name: 'postman', entry: 'reports/report.html', result: 'failure', redactions: 2, withheld: null },
    { name: '<b>leaky</b>', entry: 'index.html', result: 'success', redactions: 0, withheld: 'index.html contains JWT' },
  ], { repo: 'o/r', run: { id: 99, number: 7, event: 'schedule', createdAt: '2026-10-17T09:00:00Z', conclusion: 'success' }, generatedAt: '2026-10-17T10:00:00Z' });
  assert.match(html, /<a href="regression\/index\.html">Open<\/a>/);
  assert.match(html, /2 tokens redacted/);
  assert.match(html, /Failed/);
  assert.match(html, /Not published: index\.html contains JWT/);
  assert.match(html, /&lt;b&gt;leaky&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>leaky/);
  assert.equal((html.match(/>Open</g) ?? []).length, 2);
  assert.match(html, /actions\/runs\/99">#7<\/a> \(schedule, 2026-10-17, success\)/);
  assert.match(renderReportsPage([], { repo: 'o/r', run: null, generatedAt: '' }), /No reports were uploaded/);
});
