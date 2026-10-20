import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import { Ledger } from './ledger.ts';

// Starts the API on a free port, makes a few real requests, and prints what came back:
// the amounts a double would get wrong, two refusals, and a statement. CI runs it.

const ledger = new Ledger();
const server = createApp(ledger);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  const shown = body ? ` ${JSON.stringify(body)}` : '';
  console.log(`${method} ${path}${shown}\n  -> ${res.status} ${JSON.stringify(json.code ? json : pick(json))}`);
  return json;
}

const pick = (o: any) => Object.fromEntries(Object.entries(o).filter(([k]) => ['id', 'kind', 'amount', 'balance', 'currency'].includes(k)));

try {
  const ada = (await call('POST', '/accounts', { owner: 'Ada', currency: 'CAD' })).id;
  const bo = (await call('POST', '/accounts', { owner: 'Bo', currency: 'CAD' })).id;
  for (let i = 0; i < 3; i++) await call('POST', `/accounts/${ada}/deposits`, { amount: '0.10', currency: 'CAD' });
  await call('POST', `/accounts/${ada}/deposits`, { amount: '90071992547409.93', currency: 'CAD' });
  await call('POST', '/transfers', { from_account_id: ada, to_account_id: bo, amount: '1.15', currency: 'CAD' });
  await call('POST', '/transfers', { from_account_id: ada, to_account_id: bo, amount: 12.34, currency: 'CAD' });
  await call('POST', '/transfers', { from_account_id: bo, to_account_id: ada, amount: '1.16', currency: 'CAD' });

  const statement = await (await fetch(`${base}/accounts/${ada}/entries`)).json();
  console.log(`\nStatement for account ${ada} (${statement.owner}, ${statement.currency})`);
  console.log(`${'kind'.padEnd(12)}${'amount'.padStart(22)}${'balance after'.padStart(22)}`);
  for (const e of statement.entries) console.log(`${e.kind.padEnd(12)}${e.amount.padStart(22)}${e.balance_after.padStart(22)}`);
  console.log(`\nAs doubles, three 0.10 deposits are ${0.1 + 0.1 + 0.1}, and 90071992547409.93 in cents is ${90071992547409.93 * 100}.`);
} finally {
  server.close();
  ledger.close();
}
