// Refreshes the screenshots in docs/assets/ from the live pages. The two dashboard pictures at the top
// of the root README are no longer taken from here by hand: the Refresh README screenshots workflow
// retakes them every Monday and saves them on the screenshots branch (SCREENSHOT_OUT).
//   cd scripts/screenshots && npm ci && npx playwright install chromium && npm run capture
// Pass names to capture only some: npm run capture -- dashboard reports
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE = 'https://rizvihiqrar.github.io/qa-automation-platform';
// SCREENSHOT_OUT: where to save (the Refresh README screenshots workflow saves to its own branch).
const OUT = process.env.SCREENSHOT_OUT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/assets');

const shots = [
  { name: 'dashboard', url: `${SITE}/`, scheme: 'light', wait: '.tile .value', waitRequired: true },
  { name: 'dashboard-dark', url: `${SITE}/`, scheme: 'dark', wait: '.tile .value', waitRequired: true },
  { name: 'reports-index', url: `${SITE}/reports/`, scheme: 'light' },
  { name: 'traceability-matrix', url: `${SITE}/reports/traceability/`, scheme: 'light' },
  { name: 'langfuse-traces', url: `${SITE}/reports/langfuse-traces/`, scheme: 'light' },
  { name: 'playwright-report', url: `${SITE}/reports/regression/index.html`, scheme: 'light', wait: '.test-file-title, .test-file-header, .chip' },
  { name: 'food-truck-report', url: `${SITE}/reports/food-truck-postman/reports/index.html`, scheme: 'light', out: '../../packages/food-truck-postman/docs/report.png' },
  // The per-package table: pass rate and Flaky / Recovered status, which is the flaky-job tracking.
  { name: 'dashboard-packages', url: `${SITE}/`, scheme: 'light', element: 'section.card.wide' },
];

const wanted = process.argv.slice(2);
const browser = await chromium.launch();
for (const s of shots) {
  if (wanted.length && !wanted.includes(s.name)) continue;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: s.scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const response = await page.goto(s.url, { waitUntil: 'networkidle' });
  // Keep the old picture rather than save an error page.
  if (!response?.ok()) throw new Error(`${s.url} answered ${response?.status()}`);
  // waitRequired: a page that answers 200 but has not drawn its numbers is an error, not a picture.
  if (s.wait) await page.waitForSelector(s.wait, { timeout: 15_000 }).catch((error) => { if (s.waitRequired) throw error; });
  const file = path.join(OUT, s.out ?? `${s.name}.png`);
  if (s.element) await page.locator(s.element).first().screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log('saved', file);
  await context.close();
}
await browser.close();
