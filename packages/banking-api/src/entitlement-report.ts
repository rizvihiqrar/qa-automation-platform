import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import { probe, renderReport } from './entitlement-check.ts';
import { MATRIX, parseMatrixText, renderTable, type Matrix } from './entitlements.ts';
import { Ledger } from './ledger.ts';

// npm run entitlements: sends one real request for every role and action to an API and compares
// each answer with the matrix, prints the matrix and what came back, and exits 1 if a permission
// is missing or excessive (BK-R49). By default it starts the API itself with the committed matrix on
// a free port. `--url <base>` checks a server that is already running instead (it must accept
// requests with no role, which is how the check sets up its two accounts), and `--matrix <file>`
// compares the server with a matrix you meant instead of the committed one: the way to see what
// a wrong one looks like. Exit codes, as for `npm run check`: 0 all agree, 1 a difference, 2 wrong
// arguments or a file or server that can't be used, so a broken set-up is never read as a difference.
const USAGE = 'usage: npm run entitlements [-- --url <base>] [-- --matrix <file>]';
const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

const args = process.argv.slice(2);
let intended: Matrix = MATRIX;
let url: string | undefined;
for (let i = 0; i < args.length; i += 2) {
  const value = args[i + 1];
  if (value === undefined || (args[i] !== '--matrix' && args[i] !== '--url')) fail(USAGE);
  if (args[i] === '--url') {
    url = value!.replace(/\/+$/, '');
  } else {
    try {
      intended = parseMatrixText(readFileSync(value!, 'utf8'));
    } catch (err) {
      fail(`cannot read the matrix ${value}: ${(err as Error).message}`);
    }
  }
}

let ledger: Ledger | undefined;
let server: ReturnType<typeof createApp> | undefined;
let base = url;
if (base === undefined) {
  ledger = new Ledger();
  server = createApp(ledger);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
try {
  const report = await probe(base, intended);
  console.log(renderTable(intended));
  console.log('');
  console.log(renderReport(report));
  process.exitCode = report.findings.length === 0 ? 0 : 1;
} catch (err) {
  console.error(`could not run the check against ${base}: ${(err as Error).message}`);
  process.exitCode = 2;
} finally {
  server?.close();
  await ledger?.close();
}
