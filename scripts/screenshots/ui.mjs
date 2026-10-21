// Captures the banking UI for its README: starts the real banking-api server with a
// ledger in memory, sets up a few accounts through the API, then screenshots the pages
// in light and dark, including a refusal and a confirmation made through the page.
//   cd scripts/screenshots && npm ci && npx playwright install chromium && npm run ui
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/banking-api');
const OUT = path.join(PKG, 'docs');

const server = spawn(process.execPath, ['src/server.ts'], { cwd: PKG, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((resolve) => server.stdout.on('data', (chunk) => {
  const port = /localhost:(\d+)/.exec(chunk.toString())?.[1];
  if (port) resolve(`http://127.0.0.1:${port}`);
}));

const post = async (url, body) => (await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const ada = (await post('/accounts', { owner: 'Ada', currency: 'CAD' })).id;
const bo = (await post('/accounts', { owner: 'Bo', currency: 'CAD' })).id;
const chiyo = (await post('/accounts', { owner: 'Chiyo', currency: 'JPY' })).id;
const faris = (await post('/accounts', { owner: 'Faris', currency: 'KWD' })).id;
await post(`/accounts/${ada}/deposits`, { amount: '0.10', currency: 'CAD' });
await post(`/accounts/${ada}/deposits`, { amount: '0.10', currency: 'CAD' });
await post(`/accounts/${ada}/deposits`, { amount: '0.10', currency: 'CAD' });
await post(`/accounts/${ada}/deposits`, { amount: '90071992547409.93', currency: 'CAD' });
await post('/transfers', { from_account_id: ada, to_account_id: bo, amount: '25.00', currency: 'CAD' });
await post(`/accounts/${chiyo}/deposits`, { amount: '5000', currency: 'JPY' });
await post(`/accounts/${faris}/deposits`, { amount: '12.345', currency: 'KWD' });

const browser = await chromium.launch();
try {
  for (const scheme of ['light', 'dark']) {
    const suffix = scheme === 'dark' ? '-dark' : '';
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await context.newPage();

    await page.goto(`${base}/#/`);
    await page.locator('[data-cy=accounts]').waitFor();
    await page.screenshot({ path: path.join(OUT, `ui-accounts${suffix}.png`) });

    // A refusal and a confirmation, both made through the page.
    await page.goto(`${base}/#/accounts/${bo}`);
    await page.locator('#withdraw-amount').fill('25.01');
    await page.locator('[data-cy=withdraw-form] [data-cy=submit]').click();
    await page.locator('#withdraw-error:not(:empty)').waitFor();
    await page.locator('#deposit-amount').fill('1.230');
    await page.locator('[data-cy=deposit-form] [data-cy=submit]').click();
    await page.locator('#deposit-error:not(:empty)').waitFor();
    await page.locator('#transfer-amount').fill('5');
    await page.locator('[data-cy=transfer-form] [data-cy=submit]').click();
    await page.locator('[data-cy=transfer-form] [data-cy=status]:not(:empty)').waitFor();
    await page.locator('h1').focus();
    await page.screenshot({ path: path.join(OUT, `ui-account${suffix}.png`), fullPage: true });
    console.log('saved', `ui-accounts${suffix}.png`, `ui-account${suffix}.png`);
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
