#!/usr/bin/env node
// Audits both versions of the demo site and writes reports/REPORT-before.md and
// reports/REPORT-after.md. Exit code 1 if the "after" site has any issue.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import { startSite } from './server.js';
import { axeViolations, focusIssues, placeholderOnlyFields } from './checks.js';
import { buildFindings, toMarkdown } from './report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGES = ['index.html', 'product.html', 'checkout.html'];

export async function auditVersion(browser, baseUrl, version) {
  const pages = [];
  for (const name of PAGES) {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${baseUrl}/${version}/${name}`);
    pages.push({ page: name, axe: await axeViolations(page), focus: await focusIssues(page), placeholders: await placeholderOnlyFields(page) });
    await page.context().close();
  }
  return { version, pages, findings: buildFindings(pages) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const site = await startSite();
  const browser = await chromium.launch();
  try {
    fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
    let afterIssues = 0;
    for (const version of ['before', 'after']) {
      const result = await auditVersion(browser, site.url, version);
      const md = toMarkdown(result);
      fs.writeFileSync(path.join(ROOT, 'reports', `REPORT-${version}.md`), md);
      const count = result.findings.reduce((n, f) => n + f.count, 0);
      console.log(`${version}: ${result.findings.length} issue type(s), ${count} instance(s) -> reports/REPORT-${version}.md`);
      if (version === 'after') afterIssues = count;
    }
    if (afterIssues > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    await site.close();
  }
}
