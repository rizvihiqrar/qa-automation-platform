import { expect, test } from '@playwright/test';
import { checkSite } from '../../src/check.ts';
import { append, summarize, type History } from '../../src/history.ts';
import { MonitorBroken, monitor } from '../../src/monitor.ts';
import type { Site } from '../../src/sites.ts';
import { startFakeSite, type FakeSite } from '../fake-site.ts';

let site: FakeSite;
test.beforeAll(async () => { site = await startFakeSite(); });
test.afterAll(async () => { await site.close(); });

const at = (path: string, over: Partial<Site> = {}): Site => ({ name: `demo${path}`, url: site.url(path), title: /Demo shop/, selector: '#main', ...over });
const fast = { timeoutMs: 3000, retryDelayMs: 50 };

test('a healthy page passes on the first attempt, with its load time', async ({ browser }) => {
  const r = await checkSite(browser, at('/ok'), fast);
  expect(r).toMatchObject({ ok: true, attempts: 1 });
  expect(r.ms).toBeGreaterThanOrEqual(0);
  expect(r.error).toBeUndefined();
});

test('a slow page still passes, and its load time shows it', async ({ browser }) => {
  const r = await checkSite(browser, at('/slow'), fast);
  expect(r.ok).toBe(true);
  expect(r.ms).toBeGreaterThanOrEqual(1100);
});

for (const [path, error] of [['/500', /HTTP 500/], ['/404', /HTTP 404/]] as const) {
  test(`${path}: an error status is down, and the error says which`, async ({ browser }) => {
    const r = await checkSite(browser, at(path), fast);
    expect(r).toMatchObject({ ok: false, ms: null, attempts: 2 });
    expect(r.error).toMatch(error);
  });
}

test('a page with the wrong title is down, even when the status is 200', async ({ browser }) => {
  const r = await checkSite(browser, at('/wrong-title'), fast);
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/title was "Maintenance"/);
});

test('a page without its element is down', async ({ browser }) => {
  const r = await checkSite(browser, at('/no-element'), { ...fast, timeoutMs: 800 });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/Timeout/);
});

test('a page that never answers is down once the timeout passes', async ({ browser }) => {
  const r = await checkSite(browser, at('/hang'), { ...fast, timeoutMs: 700 });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/Timeout/);
});

test('a dropped connection is down', async ({ browser }) => {
  const r = await checkSite(browser, at('/drop'), fast);
  expect(r.ok).toBe(false);
  expect(r.attempts).toBe(2);
});

test('a first failure is retried inside the run, and a pass on the retry counts as up', async ({ browser }) => {
  const r = await checkSite(browser, at('/flaky-once'), fast);
  expect(r).toMatchObject({ ok: true, attempts: 2 });
  expect(site.hits('/flaky-once')).toBeGreaterThanOrEqual(2);
});

test('a failure on both attempts is down after exactly one retry', async ({ browser }) => {
  const before = site.hits('/flaky-always');
  const r = await checkSite(browser, at('/flaky-always'), fast);
  expect(r.ok).toBe(false);
  expect(site.hits('/flaky-always') - before).toBe(2);
});

test('a run is saved, and a site failing in 2 runs in a row is down, then up again when it recovers', async ({ browser }) => {
  const sites = [at('/ok'), at('/switch', { name: 'switch' })];
  let history: History = { runs: [] };
  const step = async (n: number) => {
    const out = await monitor(browser, sites, history, new Date(Date.UTC(2026, 9, 29, 12, n * 30)), fast);
    history = out.history;
    return out.summaries.find((s) => s.site === 'switch')!.status;
  };
  expect(await step(0)).toBe('up');
  site.setBroken(true);
  try {
    expect(await step(1)).toBe('degraded');
    expect(await step(2)).toBe('down');
  } finally {
    site.setBroken(false);
  }
  expect(await step(3)).toBe('up');
  expect(summarize(history).find((s) => s.site === 'demo/ok')!.status).toBe('up'); // the healthy site was never touched
});

test('when every site fails the monitor is broken: it throws and saves nothing', async ({ browser }) => {
  const history: History = append({ runs: [] }, { t: '2026-10-29T12:00:00Z', results: { x: { ok: true, ms: 1, attempts: 1 } } });
  await expect(monitor(browser, [at('/500'), at('/404')], history, new Date('2026-10-29T12:30:00Z'), fast)).rejects.toBeInstanceOf(MonitorBroken);
  expect(history.runs).toHaveLength(1);
});
