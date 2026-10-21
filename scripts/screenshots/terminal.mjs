// Captures real terminal output as README images: runs a command, renders what it
// printed in a terminal-style page, and screenshots it in light and dark.
//   cd scripts/screenshots && npm ci && npx playwright install chromium && npm run terminal
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const shots = [
  {
    name: 'demo',
    cwd: 'packages/banking-api',
    command: 'npm run demo --silent',
    out: 'packages/banking-api/docs',
  },
  {
    // Exits 1 on purpose: the demo ledger has defects in it.
    name: 'checks',
    cwd: 'packages/banking-api',
    command: 'npm run check --silent -- --demo',
    out: 'packages/banking-api/docs',
    failing: true,
  },
  {
    name: 'tests',
    cwd: 'packages/banking-api',
    command: 'node --test --test-reporter=spec "test/*.test.ts"',
    out: 'packages/banking-api/docs',
    // The summary and a slice of named tests; the full list is hundreds of lines.
    keep: (lines) => [...lines.filter((l) => /^\s*✔ BK-R2[6-9] defect /.test(l)).slice(0, 14), '', ...lines.filter((l) => /^ℹ /.test(l))],
  },
  {
    // The Cypress run in Chrome: the per-spec table, then the SQL checks on its ledger.
    name: 'cypress',
    cwd: 'packages/banking-api',
    command: 'npm run test:ui --silent -- --browser chrome',
    out: 'packages/banking-api/docs',
    keep: (lines) => lines.filter((l) => /^\s+│ ✔|^\s+✔  All specs|^SQL ledger checks|^\d+\/14 checks/.test(l)).map((l) => l.replace(/^\s+/, '')),
  },
];

// Names to capture only some: npm run terminal -- cypress
const wanted = process.argv.slice(2);

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const page = (title, text, dark) => `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; background: ${dark ? '#0d1117' : '#f6f8fa'}; font: 14px/1.5 ui-monospace, Consolas, monospace; }
  .term { background: ${dark ? '#161b22' : '#ffffff'}; color: ${dark ? '#e6edf3' : '#1f2328'}; border: 1px solid ${dark ? '#30363d' : '#d0d7de'}; border-radius: 8px; padding: 16px 20px; white-space: pre; display: inline-block; }
  .bar { color: ${dark ? '#8b949e' : '#59636e'}; margin-bottom: 10px; }
  .ok { color: ${dark ? '#3fb950' : '#1a7f37'}; } .no { color: ${dark ? '#f85149' : '#cf222e'}; }
</style><div class="term"><div class="bar">$ ${escape(title)}</div>${text}</div>`;

const browser = await chromium.launch();
for (const s of shots) {
  if (wanted.length && !wanted.includes(s.name)) continue;
  const run = () => {
    try {
      return execSync(s.command, { cwd: path.join(ROOT, s.cwd), encoding: 'utf8' });
    } catch (err) {
      if (s.failing && err.stdout) return err.stdout;
      throw err;
    }
  };
  const raw = run().replace(/\x1b\[[0-9;]*m/g, '').replace(/ \(\d+(\.\d+)?ms\)/g, '');
  const lines = raw.trimEnd().split('\n');
  const text = (s.keep ? s.keep(lines) : lines).map((l) => {
    const e = escape(l);
    return /-> (4\d\d)/.test(l) ? e.replace(/(-&gt; 4\d\d)/, '<span class="no">$1</span>')
      : /-> 2\d\d/.test(l) ? e.replace(/(-&gt; 2\d\d)/, '<span class="ok">$1</span>')
      : /^\s*✔/.test(l) ? `<span class="ok">${e}</span>`
      : /^(FAIL|warn) /.test(l) ? e.replace(/^(FAIL|warn)/, '<span class="no">$1</span>')
      : /^pass /.test(l) ? e.replace(/^pass/, '<span class="ok">pass</span>') : e;
  }).join('\n');
  for (const dark of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 400 }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1 });
    const tab = await context.newPage();
    await tab.setContent(page(s.command.replace(/ --silent/, ''), text, dark));
    const file = path.join(ROOT, s.out, `${s.name}${dark ? '-dark' : ''}.png`);
    await tab.locator('.term').screenshot({ path: file });
    console.log('saved', file);
    await context.close();
  }
}
await browser.close();
