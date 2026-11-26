import { Ledger, type Movement, type Result, type Store, type Transfer } from './ledger.ts';
import { MAX_MINOR } from './money.ts';

// A small ledger built through the Ledger itself, never by hand: the clean dataset the
// SQL checks must pass, and the base the defects are put into. Every currency, every
// kind of movement, a whole balance spent, a currency filled to its limit exactly, a
// keyed transfer, refused movements that write nothing, and a key still in flight.

// The time the checks are run at. The clock starts five minutes earlier and moves one
// second per reading, so the key in flight is younger than the 10 minutes BK-R29 allows.
export const SAMPLE_NOW = new Date('2026-10-20T12:05:00.000Z');
const START = Date.parse('2026-10-20T12:00:00.000Z');

// The sample's clock, for a store made elsewhere (each call starts it again).
export const sampleClock = (): (() => string) => {
  let tick = 0;
  return () => new Date(START + 1000 * tick++).toISOString();
};

// The sample in a SQLite ledger (`:memory:` unless a file is given).
export async function buildSample(path = ':memory:'): Promise<Ledger> {
  const ledger = new Ledger(path, sampleClock());
  await fillSample(ledger);
  return ledger;
}

// The sample's movements, into any empty store whose clock is sampleClock().
export async function fillSample(ledger: Store): Promise<void> {
  const must = (result: Result<Transfer>) => {
    if (!result.ok) throw new Error(`sample movement refused: ${result.error}`);
  };

  const ada = (await ledger.openAccount('Ada', 'CAD')).id;
  const bo = (await ledger.openAccount('Bo', 'CAD')).id;
  must(await ledger.deposit(ada, 10_000n, 'CAD'));
  must(await ledger.transfer(ada, bo, 2_500n, 'CAD'));
  must(await ledger.withdraw(bo, 2_500n, 'CAD')); // the whole balance
  const rent: Movement = { kind: 'transfer', from: ada, to: bo, amount: 1_000n, currency: 'CAD' };
  await ledger.claimKey('rent-2026-10', 'sample');
  must(await ledger.apply(rent, 'rent-2026-10'));

  const chiyo = (await ledger.openAccount('Chiyo', 'JPY')).id;
  must(await ledger.deposit(chiyo, 5_000n, 'JPY'));
  must(await ledger.withdraw(chiyo, 1_200n, 'JPY'));

  const dana = (await ledger.openAccount('Dana', 'USD')).id;
  const eli = (await ledger.openAccount('Eli', 'USD')).id;
  must(await ledger.deposit(dana, 1n, 'USD'));
  must(await ledger.transfer(dana, eli, 1n, 'USD')); // one cent, all of it

  const faris = (await ledger.openAccount('Faris', 'KWD')).id;
  must(await ledger.deposit(faris, MAX_MINOR, 'KWD')); // the currency limit, exactly

  // Refused: these write nothing.
  for (const refused of [await ledger.withdraw(dana, 1n, 'USD'), await ledger.deposit(faris, 1n, 'KWD'), await ledger.transfer(ada, chiyo, 1n, 'CAD')]) {
    if (refused.ok) throw new Error('a sample refusal was accepted');
  }

  await ledger.claimKey('in-flight', 'sample'); // claimed, its transfer not written yet
}
