// The banking UI with a frozen clock and a fixed set of accounts, so every screenshot is the same
// every time. It is the real banking-api app (same HTML, CSS, script and API), started in memory with
// a ledger whose clock never moves: the statement dates, the only part of the UI that changes from
// run to run, are fixed, so nothing on a page needs masking.
import type { AddressInfo } from 'node:net';
import { createApp } from '../../banking-api/src/app.ts';
import { Ledger } from '../../banking-api/src/ledger.ts';

const FROZEN = '2026-01-15T10:30:00.000Z';
const ledger = new Ledger(':memory:', () => FROZEN);

// Accounts are opened in a fixed order, so their ids are always 1 Ada, 2 Grace, 3 Alan and 4 Mariam.
// The ledger's methods are async (banking-api's Store), so each call is awaited: the ids and
// balances are there before the server takes its first request.
const ada = await ledger.openAccount('Ada Lovelace', 'USD');
const grace = await ledger.openAccount('Grace Hopper', 'USD');
await ledger.openAccount('Alan Turing', 'CAD');
await ledger.openAccount('Mariam Al-Sabah', 'KWD');
for (const result of [
  await ledger.deposit(ada.id, 125_000n, 'USD'),
  await ledger.withdraw(ada.id, 4_550n, 'USD'),
  await ledger.transfer(ada.id, grace.id, 20_000n, 'USD'),
  await ledger.deposit(grace.id, 9_999n, 'USD'),
]) {
  if (!result.ok) throw new Error(`the screenshot accounts could not be set up: ${result.error}`);
}

const port = Number(process.env.PORT ?? 4400);
const server = createApp(ledger);
server.listen(port, '127.0.0.1', () => {
  console.log(`visual-regression-demo listening on http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
