import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readSummary, toMarkdown } from '../src/summarize.js';

// A real k6 summary from a load run against qa-practice-api (after the scrypt fix).
const real = JSON.parse(fs.readFileSync(new URL('./fixtures/load-summary.json', import.meta.url), 'utf8'));

test('readSummary extracts totals from a real k6 summary', () => {
  const s = readSummary('load', real);
  assert.equal(s.requests, 2735);
  assert.equal(s.maxVus, 20);
  assert.equal(s.errorRate, 0);
  assert.equal(s.checksRate, 100);
  assert.ok(s.rps > 70 && s.rps < 85, `rps ${s.rps}`);
  assert.equal(s.passed, true);
});

test('readSummary lists every threshold and each tagged endpoint', () => {
  const s = readSummary('load', real);
  assert.equal(s.thresholds.length, 6);
  assert.deepEqual(s.endpoints.map((e) => e.name), ['get product', 'list products', 'login', 'place order']);
  const list = s.endpoints.find((e) => e.name === 'list products');
  assert.ok(list.p95 < 50, `list p95 ${list.p95}`);
});

test('a failed threshold fails the summary and is named in the report', () => {
  const broken = structuredClone(real);
  broken.metrics['http_req_duration{name:list products}'].thresholds['p(95)<50'].ok = false;
  broken.metrics['http_req_duration{name:list products}'].values['p(95)'] = 82.7;
  const s = readSummary('load', broken);
  assert.equal(s.passed, false);
  const md = toMarkdown([s]);
  assert.match(md, /\| load \| 2735 \|.*\| FAIL \|/);
  assert.match(md, /Failed thresholds: `http_req_duration\{name:list products\}: p\(95\)<50`/);
  assert.match(md, /\| list products \| 82\.7 \|/);
});

test('a summary with no thresholds or endpoints still renders', () => {
  const s = readSummary('empty', { metrics: { http_reqs: { values: { count: 0, rate: 0 } } } });
  assert.deepEqual([s.requests, s.passed, s.endpoints.length, s.maxVus], [0, true, 0, null]);
  assert.match(toMarkdown([s]), /\| empty \| 0 \| 0 \| 0% \| 0% \|/);
});

test('every k6 script declares thresholds and writes a summary', () => {
  for (const name of ['smoke', 'load', 'spike']) {
    const src = fs.readFileSync(new URL(`../k6/${name}.js`, import.meta.url), 'utf8');
    assert.match(src, /thresholds:/, name);
    assert.match(src, /http_req_failed: \['rate<0\.01'\]/, name);
    assert.match(src, new RegExp(`summaryWriter\\('${name}'\\)`), name);
  }
});
