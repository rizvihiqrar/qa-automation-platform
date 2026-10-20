import { createApp } from './app.ts';
import { Ledger } from './ledger.ts';

// DATABASE_PATH keeps the ledger in a SQLite file; without it, the ledger lives in
// memory and is gone when the server stops.
const port = Number(process.env.PORT ?? 4100);
const ledger = new Ledger(process.env.DATABASE_PATH ?? ':memory:');

createApp(ledger).listen(port, () => {
  console.log(`banking-api listening on http://localhost:${port} (ledger: ${process.env.DATABASE_PATH ?? 'in memory'})`);
});
