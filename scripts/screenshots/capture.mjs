// Refreshes the screenshots in docs/assets/ from the live pages.
//   cd scripts/screenshots && npm ci && npx playwright install chromium && npm run capture
// Pass names to capture only some: npm run capture -- dashboard reports
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE = 'https://rizvihiqrar.github.io/qa-automation-platform';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/assets');

const shots = [
  { name: 'dashboard', url: `${SITE}/`, scheme: 'light' },
  { name: 'dashboard-dark', url: `${SITE}/`, scheme: 'dark' },
  { name: 'reports-index', url: `${SITE}/reports/`, scheme: 'light' },
  { name: 'traceability-matrix', url: `${SITE}/reports/traceability/`, scheme: 'light' },
  { name: 'langfuse-traces', url: `${SITE}/reports/langfuse-traces/`, scheme: 'light' },
  { name: 'playwright-report', url: `${SITE}/reports/regression/index.html`, scheme: 'light', wait: '.test-file-title, .test-file-header, .chip' },
  // The per-package table: pass rate and Flaky / Recovered status, which is the flaky-job tracking.
  { name: 'dashboard-packages', url: `${SITE}/`, scheme: 'light', element: 'section.card.wide' },
];

const wanted = process.argv.slice(2);
const browser = await chromium.launch();
for (const s of shots) {
  if (wanted.length && !wanted.includes(s.name)) continue;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: s.scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(s.url, { waitUntil: 'networkidle' });
  if (s.wait) await page.waitForSelector(s.wait, { timeout: 15_000 }).catch(() => {});
  const file = path.join(OUT, `${s.name}.png`);
  if (s.element) await page.locator(s.element).first().screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log('saved', file);
  await context.close();
}
await browser.close();
