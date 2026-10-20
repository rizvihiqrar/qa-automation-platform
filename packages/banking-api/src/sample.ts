import { Ledger, type Movement } from './ledger.ts';
import { MAX_MINOR } from './money.ts';

// A small ledger built through the Ledger itself, never by hand: the clean dataset the
// SQL checks must pass, and the base the defects are put into. Every currency, every
// kind of movement, a whole balance spent, a currency filled to its limit exactly, a
// keyed transfer, refused movements that write nothing, and a key still in flight.

// The time the checks are run at. The clock starts five minutes earlier and moves one
// second per reading, so the key in flight is younger than the 10 minutes BK-R29 allows.
export const SAMPLE_NOW = new Date('2026-10-20T12:05:00.000Z');
const START = Date.parse('2026-10-20T12:00:00.000Z');

export function buildSample(path = ':memory:'): Ledger {
  let tick = 0;
  const ledger = new Ledger(path, () => new Date(START + 1000 * tick++).toISOString());
  const must = (result: ReturnType<Ledger['apply']>) => {
    if (!result.ok) throw new Error(`sample movement refused: ${result.error}`);
  };

  const ada = ledger.openAccount('Ada', 'CAD').id;
  const bo = ledger.openAccount('Bo', 'CAD').id;
  must(ledger.deposit(ada, 10_000n, 'CAD'));
  must(ledger.transfer(ada, bo, 2_500n, 'CAD'));
  must(ledger.withdraw(bo, 2_500n, 'CAD')); // the whole balance
  const rent: Movement = { kind: 'transfer', from: ada, to: bo, amount: 1_000n, currency: 'CAD' };
  ledger.claimKey('rent-2026-10', 'sample');
  must(ledger.apply(rent, 'rent-2026-10'));

  const chiyo = ledger.openAccount('Chiyo', 'JPY').id;
  must(ledger.deposit(chiyo, 5_000n, 'JPY'));
  must(ledger.withdraw(chiyo, 1_200n, 'JPY'));

  const dana = ledger.openAccount('Dana', 'USD').id;
  const eli = ledger.openAccount('Eli', 'USD').id;
  must(ledger.deposit(dana, 1n, 'USD'));
  must(ledger.transfer(dana, eli, 1n, 'USD')); // one cent, all of it

  const faris = ledger.openAccount('Faris', 'KWD').id;
  must(ledger.deposit(faris, MAX_MINOR, 'KWD')); // the currency limit, exactly

  // Refused: these write nothing.
  for (const refused of [ledger.withdraw(dana, 1n, 'USD'), ledger.deposit(faris, 1n, 'KWD'), ledger.transfer(ada, chiyo, 1n, 'CAD')]) {
    if (refused.ok) throw new Error('a sample refusal was accepted');
  }

  ledger.claimKey('in-flight', 'sample'); // claimed, its transfer not written yet
  return ledger;
}
