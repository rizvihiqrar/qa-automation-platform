// Races real requests at two server processes on one SQLite file, then leaves the
// file for `npm run check`. CI runs both, so a ledger the races broke fails the job.
//   node src/race.ts raced.db && node src/check.ts --db raced.db
// The screening before each movement takes 20 ms, so requests overlap in each process
// as well as across the two.

import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnServers } from './servers.ts';

type Tally = Record<string, number>;

export async function race(dbPath: string, log: (line: string) => void = console.log): Promise<Record<string, Tally>> {
  for (const suffix of ['', '-journal']) rmSync(dbPath + suffix, { force: true });
  const servers = await spawnServers(2, dbPath, { SCREENING_DELAY_MS: '20' });
  const [one, two] = servers.bases as [string, string];
  const pick = (i: number) => (i % 2 ? one : two);
  const post = async (base: string, path: string, body: unknown, key?: string) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json() as { id?: number; code?: string };
    return { status: res.status, ...json };
  };
  const tally = (replies: { status: number; code?: string }[]): Tally => {
    const counts: Tally = {};
    for (const r of replies) {
      const key = `${r.status}${r.code ? ` ${r.code}` : ''}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };
  const open = async (currency: string) => (await post(one, '/accounts', { owner: 'Race', currency })).id!;
  const results: Record<string, Tally> = {};
  const record = (name: string, replies: { status: number; code?: string }[]) => {
    results[name] = tally(replies);
    log(`${name}: ${JSON.stringify(results[name])}`);
  };

  try {
    const spender = await open('CAD');
    await post(one, `/accounts/${spender}/deposits`, { amount: '100.00', currency: 'CAD' });
    record('60 withdrawals of 10.00 from 100.00', await Promise.all(Array.from({ length: 60 }, (_, i) =>
      post(pick(i), `/accounts/${spender}/withdrawals`, { amount: '10.00', currency: 'CAD' }))));

    const from = await open('CAD');
    const to = await open('CAD');
    await post(one, `/accounts/${from}/deposits`, { amount: '100.00', currency: 'CAD' });
    record('20 transfers of 10.00 from 100.00', await Promise.all(Array.from({ length: 20 }, (_, i) =>
      post(pick(i), '/transfers', { from_account_id: from, to_account_id: to, amount: '10.00', currency: 'CAD' }))));

    const keyed = await open('CAD');
    record('one key sent 10 times', await Promise.all(Array.from({ length: 10 }, (_, i) =>
      post(pick(i), `/accounts/${keyed}/deposits`, { amount: '9.00', currency: 'CAD' }, 'race-key'))));

    const full = await open('KWD');
    await post(one, `/accounts/${full}/deposits`, { amount: '99999999999999.969', currency: 'KWD' });
    record('10 deposits of 0.010 KWD with room for 3', await Promise.all(Array.from({ length: 10 }, (_, i) =>
      post(pick(i), `/accounts/${full}/deposits`, { amount: '0.010', currency: 'KWD' }))));

    // Transfers in every direction between four accounts at once, some of them more
    // than the sender holds: what's left must still balance.
    const ring = [await open('JPY'), await open('JPY'), await open('JPY'), await open('JPY')];
    for (const id of ring) await post(one, `/accounts/${id}/deposits`, { amount: '1000', currency: 'JPY' });
    record('120 transfers around four JPY accounts', await Promise.all(Array.from({ length: 120 }, (_, i) =>
      post(pick(i), '/transfers', { from_account_id: ring[i % 4], to_account_id: ring[(i * 3 + 1) % 4], amount: String(100 + (i * 37) % 400), currency: 'JPY' }))));
  } finally {
    await servers.stop();
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.argv[2];
  if (!dbPath || process.argv.length > 3) {
    console.error('usage: node src/race.ts <file>');
    process.exitCode = 2;
  } else {
    await race(dbPath);
    console.log(`raced ledger left in ${dbPath}`);
  }
}
