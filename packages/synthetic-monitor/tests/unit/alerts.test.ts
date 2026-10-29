import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAlerts, type Gh } from '../../src/alert.ts';
import { issueTitle, planAlerts } from '../../src/alerts.ts';
import type { SiteSummary, Status } from '../../src/history.ts';

const summary = (site: string, status: Status, extra: Partial<SiteSummary> = {}): SiteSummary => ({
  site, status, failingSince: status === 'up' ? null : '2026-10-29T10:00:00Z', lastError: status === 'up' ? null : 'HTTP 503',
  uptimePct: 99.5, runs: 100, medianMs: 200, latestMs: status === 'up' ? 210 : null, slow: false, series: [], ...extra,
});

test('a down site with no open issue gets one, with the site and the error', () => {
  const [a] = planAlerts([summary('saucedemo', 'down')], []);
  assert.equal(a!.type, 'open');
  assert.equal(a!.type === 'open' && a!.title, 'Monitor: saucedemo is down');
  assert.match(a!.type === 'open' ? a!.body : '', /HTTP 503/);
  assert.match(a!.type === 'open' ? a!.body : '', /Failing since: 2026-10-29T10:00:00Z/);
});

test('a site that is still down does not get a second issue', () => {
  assert.deepEqual(planAlerts([summary('saucedemo', 'down')], [{ number: 7, title: issueTitle('saucedemo') }]), []);
});

test('a degraded site (one failed run) opens nothing and leaves an open issue alone', () => {
  assert.deepEqual(planAlerts([summary('saucedemo', 'degraded')], []), []);
  assert.deepEqual(planAlerts([summary('saucedemo', 'degraded')], [{ number: 7, title: issueTitle('saucedemo') }]), []);
});

test('a site that recovered closes its issue with a comment', () => {
  const [a] = planAlerts([summary('saucedemo', 'up')], [{ number: 7, title: issueTitle('saucedemo') }]);
  assert.deepEqual(a && { type: a.type, number: a.type === 'close' ? a.number : null }, { type: 'close', number: 7 });
  assert.match(a!.type === 'close' ? a!.comment : '', /210 ms/);
});

test('only the issue of the site that recovered is closed', () => {
  const open = [{ number: 7, title: issueTitle('saucedemo') }, { number: 8, title: issueTitle('playwright.dev') }];
  const actions = planAlerts([summary('saucedemo', 'up'), summary('playwright.dev', 'down')], open);
  assert.deepEqual(actions.map((a) => a.type), ['close']);
});

test('a slow site is shown on the dashboard but never alerts', () => {
  assert.deepEqual(planAlerts([summary('saucedemo', 'up', { slow: true, latestMs: 9000 })], []), []);
});

test('issues that are not about a site are left alone', () => {
  assert.deepEqual(planAlerts([summary('saucedemo', 'up')], [{ number: 3, title: 'Something else' }]), []);
});

test('applyAlerts lists the open monitoring issues, then opens and closes through gh', () => {
  const calls: string[][] = [];
  const gh: Gh = (args) => {
    calls.push(args);
    return args[0] === 'issue' && args[1] === 'list' ? JSON.stringify([{ number: 8, title: issueTitle('playwright.dev') }]) : '';
  };
  applyAlerts([summary('saucedemo', 'down'), summary('playwright.dev', 'up')], gh, 'o/r', 'https://run');
  assert.deepEqual(calls[0]!.slice(0, 7), ['issue', 'list', '-R', 'o/r', '--label', 'monitoring', '--state']);
  const create = calls.find((c) => c[0] === 'issue' && c[1] === 'create')!;
  assert.ok(create.includes('Monitor: saucedemo is down') && create.includes('monitoring'));
  assert.ok(create.some((a) => a.includes('https://run')));
  const close = calls.find((c) => c[1] === 'close')!;
  assert.equal(close[2], '8');
  assert.equal(calls.length, 4);
  assert.ok(calls.findIndex((c) => c[0] === 'label') < calls.findIndex((c) => c[0] === 'issue' && c[1] === 'create'), 'the label is made before an issue uses it');
});

test('the label is only made when an issue is going to be opened', () => {
  const calls: string[][] = [];
  applyAlerts([summary('saucedemo', 'up')], (args) => { calls.push(args); return '[]'; }, 'o/r');
  assert.deepEqual(calls.map((c) => c[0]), ['issue']);
});

test('an open issue for a site that is no longer watched is closed', () => {
  const [a] = planAlerts([summary('playwright.dev', 'up')], [{ number: 9, title: issueTitle('old-site') }]);
  assert.deepEqual(a && { type: a.type, number: a.type === 'close' ? a.number : null }, { type: 'close', number: 9 });
  assert.match(a!.type === 'close' ? a!.comment : '', /no longer monitored/);
});
