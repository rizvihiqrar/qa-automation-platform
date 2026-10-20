import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from './app.ts';
import { Ledger } from './ledger.ts';

// Starts the API on a free port, makes a few real requests, and prints what came back:
// the amounts a double would get wrong, two refusals, a statement, a retried transfer
// and three withdrawals at once. CI runs it. The screening before each movement takes
// 20 ms here, as an outside check would, so requests sent together really overlap.

const ledger = new Ledger();
const server = createApp(ledger, { screen: () => sleep(20) });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(method: string, path: string, body?: unknown, key?: string): Promise<any> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  const shown = `${key ? ` [Idempotency-Key: ${key}]` : ''}${body ? ` ${JSON.stringify(body)}` : ''}`;
  const replayed = res.headers.get('idempotent-replayed') ? ' (replayed)' : '';
  console.log(`${method} ${path}${shown}\n  -> ${res.status}${replayed} ${JSON.stringify(json.code ? json : pick(json))}`);
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

  console.log('\nA transfer retried with the same key moves the money once:');
  const rent = { from_account_id: ada, to_account_id: bo, amount: '5.00', currency: 'CAD' };
  await call('POST', '/transfers', rent, 'rent-2026-10');
  await call('POST', '/transfers', rent, 'rent-2026-10');
  await call('POST', '/transfers', { ...rent, amount: '50.00' }, 'rent-2026-10');

  const all = (await (await fetch(`${base}/accounts/${bo}`)).json()).balance;
  console.log(`\nThree withdrawals of Bo's whole balance (${all}) sent at once:`);
  await Promise.all([1, 2, 3].map(() => call('POST', `/accounts/${bo}/withdrawals`, { amount: all, currency: 'CAD' })));

  console.log(`\nAs doubles, three 0.10 deposits are ${0.1 + 0.1 + 0.1}, and 90071992547409.93 in cents is ${90071992547409.93 * 100}.`);
} finally {
  server.close();
  ledger.close();
}
