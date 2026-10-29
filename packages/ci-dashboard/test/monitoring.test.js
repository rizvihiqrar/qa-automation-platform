import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../src/metrics.js';
import { renderMonitoring, sparkline, STALE_AFTER_MS } from '../src/monitoring.js';
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

test('a monitor that has not reported for over 3 hours says the numbers are out of date', () => {
  assert.equal(STALE_AFTER_MS, 3 * 3600_000);
  const stale = renderMonitoring(summary([site()], '2026-10-29T08:00:00.000Z'), NOW);
  assert.match(stale, /has not reported for more than 3 hours/);
  assert.doesNotMatch(renderMonitoring(summary([site()], '2026-10-29T09:30:00.000Z'), NOW), /has not reported/); // exactly 3 hours
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
