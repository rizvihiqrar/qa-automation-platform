import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../src/metrics.js';
import { loadMonitoring, renderMonitoring, sparkline, STALE_AFTER_MS } from '../src/monitoring.js';
import { PAGE_STYLE, renderHtml } from '../src/render.js';

const site = (over = {}) => ({
  site: 'saucedemo', status: 'up', failingSince: null, lastError: null, uptimePct: 99.5, runs: 100,
  medianMs: 2100, latestMs: 2300, slow: false, series: [2000, 2100, 2300], ...over,
});
const summary = (sites, generatedAt = '2026-10-29T12:00:00.000Z') => ({ generatedAt, sites });
const NOW = '2026-10-29T12:30:00.000Z';

test('a site row shows its status, uptime, median and latest load time', () => {
  const html = renderMonitoring(summary([site()]), NOW);
  assert.match(html, /Uptime of public demo sites/);
  assert.match(html, /<td>saucedemo<\/td>/);
  assert.match(html, /status good[^>]*><span class="icon" aria-hidden="true">✓<\/span>Up/);
  assert.match(html, /99\.5%/);
  assert.match(html, /2100 ms/);
  assert.match(html, /2300 ms/);
});

test('down and one-failed-run are told apart, with the error, in words and not only colour', () => {
  const html = renderMonitoring(summary([
    site({ site: 'a', status: 'down', lastError: 'HTTP 503', latestMs: null, series: [2000, null, null] }),
    site({ site: 'b', status: 'degraded', lastError: 'Timeout 15000ms exceeded', latestMs: null }),
  ]), NOW);
  assert.match(html, /status critical[^>]*><span class="icon" aria-hidden="true">✕<\/span>Down/);
  assert.match(html, /HTTP 503/);
  assert.match(html, /status warning[^>]*><span class="icon" aria-hidden="true">!<\/span>One failed run/);
});

test('a slow site is marked Slow but is still Up', () => {
  const html = renderMonitoring(summary([site({ slow: true, latestMs: 9000 })]), NOW);
  assert.match(html, />Up<\/span> <span class="status warning"><span class="icon" aria-hidden="true">!<\/span>Slow/);
  assert.equal(renderMonitoring(summary([site()]), NOW).includes('Slow</span>'), false);
});

test('a monitor that has not reported for over 90 minutes says the numbers may be out of date', () => {
  assert.equal(STALE_AFTER_MS, 90 * 60_000);
  const stale = renderMonitoring(summary([site()], '2026-10-29T10:59:00.000Z'), NOW); // 91 minutes
  assert.match(stale, /has not reported for more than 90 minutes/);
  assert.doesNotMatch(renderMonitoring(summary([site()], '2026-10-29T11:00:00.000Z'), NOW), /has not reported/); // exactly 90
});

test('a missing or unreadable check time counts as out of date, not as fresh', () => {
  assert.match(renderMonitoring(summary([site()], undefined), NOW), /has not reported/);
  assert.match(renderMonitoring(summary([site()], 'last Tuesday'), NOW), /has not reported/);
  assert.match(renderMonitoring(summary([site()], undefined), NOW), /Last check unknown/);
});

test('a missing uptime shows a dash, and a status the page does not know is shown as it is', () => {
  const html = renderMonitoring(summary([site({ uptimePct: undefined, status: 'paused' })]), NOW);
  assert.doesNotMatch(html, /undefined|null/);
  assert.match(html, /status warning[^>]*><span class="icon" aria-hidden="true">\?<\/span>paused/);
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));

test('loadMonitoring: a good file gives the section and is published as monitoring.json', () => {
  const dir = tmp();
  const file = path.join(dir, 'summary.json');
  fs.writeFileSync(file, JSON.stringify(summary([site()])));
  assert.match(loadMonitoring(file, NOW, dir), /Uptime of public demo sites/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'monitoring.json'), 'utf8')).sites[0].site, 'saucedemo');
});

test('loadMonitoring: no file, a broken file or an empty summary leave the section out without failing', () => {
  const dir = tmp();
  const warnings = [];
  assert.equal(loadMonitoring(null, NOW, dir), '');
  assert.equal(loadMonitoring(path.join(dir, 'missing.json'), NOW, dir), '');
  fs.writeFileSync(path.join(dir, 'broken.json'), '{"sites": [');
  assert.equal(loadMonitoring(path.join(dir, 'broken.json'), NOW, dir, (m) => warnings.push(m)), '');
  assert.match(warnings[0], /::warning::Left out the monitoring section/);
  fs.writeFileSync(path.join(dir, 'empty.json'), '[]');
  assert.equal(loadMonitoring(path.join(dir, 'empty.json'), NOW, dir), '');
  assert.equal(fs.existsSync(path.join(dir, 'monitoring.json')), false, 'a file the page does not show is not published');
});

test('nothing to show when there is no summary or no site', () => {
  assert.equal(renderMonitoring(null, NOW), '');
  assert.equal(renderMonitoring(summary([]), NOW), '');
});

test('names and errors from the summary are escaped', () => {
  const html = renderMonitoring(summary([site({ site: '<img src=x>', status: 'down', lastError: '"><script>alert(1)</script>' })]), NOW);
  assert.doesNotMatch(html, /<img src=x>|<script>alert/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('the sparkline breaks its line where the site was down, and marks each failed run', () => {
  const svg = sparkline([100, 200, null, 300, 400]);
  assert.equal((svg.match(/<path /g) ?? []).length, 2);
  assert.equal((svg.match(/class="miss"/g) ?? []).length, 1);
});

test('a single load between two failures is drawn as a dot, and a series of failures draws no line', () => {
  assert.match(sparkline([null, 300, null]), /<circle /);
  assert.doesNotMatch(sparkline([null, 300, null]), /<path /);
  assert.equal(sparkline([null, null]), '');
  assert.equal(sparkline([]), '');
});

test('the section is placed on the page when given, and the page is the same without it', () => {
  const metrics = computeMetrics([]);
  const opts = { repo: 'o/r', generatedAt: '2026-10-29T12:00:00Z' };
  const html = renderHtml(metrics, { ...opts, monitoringHtml: renderMonitoring(summary([site()]), NOW) });
  assert.ok(html.indexOf('id="monitoring"') < html.indexOf('<h2>Packages</h2>'));
  assert.doesNotMatch(renderHtml(metrics, opts), /Uptime of public demo sites/);
});

test('the out-of-date banner may wrap: at phone width a no-wrap sentence pushed the whole page sideways', () => {
  assert.match(PAGE_STYLE, /\.stale\s*\{[^}]*white-space:\s*normal/);
  assert.match(renderMonitoring(summary([site()], '2026-10-29T01:00:00.000Z'), NOW), /class="status critical stale"/);
});
