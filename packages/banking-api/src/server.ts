import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import { Ledger } from './ledger.ts';

// DATABASE_PATH keeps the ledger in a SQLite file; without it, the ledger lives in
// memory and is gone when the server stops. Several servers can share one file.
// PORT=0 picks a free port; the log line names the one chosen.
const port = Number(process.env.PORT ?? 4100);
const ledger = new Ledger(process.env.DATABASE_PATH ?? ':memory:');

// SCREENING_DELAY_MS stands in for a slow outside check (fraud, limits) awaited
// before each movement: the wait in which two requests overlap (BK-R24).
const delay = Number(process.env.SCREENING_DELAY_MS ?? 0);
const screen = () => new Promise<void>((resolve) => setTimeout(resolve, delay));

const server = createApp(ledger, { screen });
server.listen(port, () => {
  const { port: chosen } = server.address() as AddressInfo;
  console.log(`banking-api listening on http://localhost:${chosen} (ledger: ${process.env.DATABASE_PATH ?? 'in memory'})`);
});
