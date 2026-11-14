import { chromium } from '@playwright/test';
import { measure } from './drill.ts';
import { renderReport } from './report.ts';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  console.log(renderReport(await measure(page)));
} finally {
  await browser.close();
}
