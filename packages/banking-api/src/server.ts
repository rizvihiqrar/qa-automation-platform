import type { AddressInfo } from 'node:net';
import { createApp, type Screen } from './app.ts';
import { amlRules } from './aml.ts';
import { describeStore, openStore } from './store.ts';

// DATABASE_URL puts the ledger on Postgres (DATABASE_SCHEMA names its schema); otherwise
// DATABASE_PATH keeps it in a SQLite file, and without either it lives in memory and is gone
// when the server stops. Several servers can share one Postgres database or one SQLite file.
// PORT=0 picks a free port; the log line names the one chosen.
const port = Number(process.env.PORT ?? 4100);
const ledger = await openStore();

// SCREENING_DELAY_MS stands in for a slow outside check (fraud, limits) awaited
// before each movement: the wait in which two requests overlap (BK-R24).
// The anti-money-laundering rules (BK-R42 to BK-R45) run after the wait, so a held movement takes
// as long as any other (no timing tell), and inside the store's exclusive section with the write,
// so two movements on one account can't both read the same 24-hour total.
const delay = Number(process.env.SCREENING_DELAY_MS ?? 0);
const screen: Screen = () => new Promise<void>((resolve) => setTimeout(resolve, delay));

const server = createApp(ledger, { screen, rules: amlRules() });
server.listen(port, () => {
  const { port: chosen } = server.address() as AddressInfo;
  console.log(`banking-api listening on http://localhost:${chosen} (ledger: ${describeStore()})`);
});
