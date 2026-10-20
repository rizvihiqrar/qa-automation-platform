import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { Ledger } from '../src/ledger.ts';
import { MAX_MINOR, type Currency } from '../src/money.ts';

// A model of the bank: random sequences of deposits, withdrawals and transfers between
// accounts in three currencies, run against the real ledger and against a few lines of
// BigInt arithmetic. After every step the two must agree, and the ledger must hold
// together. Runs on the Ledger directly (no HTTP), so it can make thousands of moves.

const ACCOUNTS: Currency[] = ['CAD', 'CAD', 'CAD', 'JPY', 'JPY', 'KWD'];

// An amount is a number of minor units, or a boundary worked out from the model when
// the move runs: the whole balance, or what is left under the currency's limit, each
// exactly or one more. Random amounts alone almost never land on a boundary: before
// these were added, putting `<=` in place of `<` in the funds check, or switching the
// limit off, passed this test (they were caught only by the designed cases).
type Amount = bigint | 'balance' | 'balance+1' | 'room' | 'room+1';

type Move =
  | { kind: 'deposit'; account: number; amount: Amount }
  | { kind: 'withdrawal'; account: number; amount: Amount }
  | { kind: 'transfer'; from: number; to: number; amount: Amount; currency: 'own' | 'other' };

// Mostly small amounts, so balances run out and refusals happen; sometimes huge ones,
// so the limit is reached; sometimes exactly on a boundary.
const amount: fc.Arbitrary<Amount> = fc.oneof(
  { weight: 6, arbitrary: fc.bigInt({ min: 1n, max: 50_000n }) },
  { weight: 1, arbitrary: fc.bigInt({ min: MAX_MINOR / 3n, max: MAX_MINOR }) },
  { weight: 2, arbitrary: fc.constantFrom('balance' as const, 'balance+1' as const, 'room' as const, 'room+1' as const) },
);
const account = fc.integer({ min: 0, max: ACCOUNTS.length - 1 });
const move: fc.Arbitrary<Move> = fc.oneof(
  fc.record({ kind: fc.constant('deposit' as const), account, amount }),
  fc.record({ kind: fc.constant('withdrawal' as const), account, amount }),
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('transfer' as const), from: account, to: account, amount, currency: fc.constantFrom('own' as const, 'other' as const) }) },
);

const otherCurrency = (c: Currency): Currency => (c === 'CAD' ? 'JPY' : 'CAD');

test('BK-PR-08 BK-R06 BK-R09 BK-R10 BK-R11 BK-R12 BK-R13 BK-R14 BK-R15 any sequence of moves: the ledger matches the model and holds together', () => {
  // size 'max': fast-check's default keeps arrays short, and short sequences rarely
  // reach the limit.
  fc.assert(fc.property(fc.array(move, { minLength: 1, maxLength: 40, size: 'max' }), (moves) => {
    const ledger = new Ledger();
    try {
      const ids = ACCOUNTS.map((c, i) => ledger.openAccount(`Owner ${i}`, c).id);
      const balances = ACCOUNTS.map(() => 0n);
      const issued: Record<string, bigint> = { CAD: 0n, JPY: 0n, KWD: 0n };
      let moved = 0;

      // A boundary amount, from the model; at least 1, since 0 is not an amount.
      const resolve = (a: Amount, account: number): bigint => {
        const room = MAX_MINOR - issued[ACCOUNTS[account]!]!;
        const value = a === 'balance' ? balances[account]! : a === 'balance+1' ? balances[account]! + 1n
          : a === 'room' ? room : a === 'room+1' ? room + 1n : a;
        return value < 1n ? 1n : value;
      };

      for (const m of moves) {
        let result;
        let expected: string | null = null;
        if (m.kind === 'deposit') {
          const c = ACCOUNTS[m.account]!;
          const amount = resolve(m.amount, m.account);
          if (issued[c]! + amount > MAX_MINOR) expected = 'limit_exceeded';
          result = ledger.deposit(ids[m.account]!, amount, c);
          if (!expected) { balances[m.account]! += amount; issued[c]! += amount; }
        } else if (m.kind === 'withdrawal') {
          const c = ACCOUNTS[m.account]!;
          const amount = resolve(m.amount, m.account);
          if (balances[m.account]! < amount) expected = 'insufficient_funds';
          result = ledger.withdraw(ids[m.account]!, amount, c);
          if (!expected) { balances[m.account]! -= amount; issued[c]! -= amount; }
        } else {
          const from = ACCOUNTS[m.from]!;
          const currency = m.currency === 'own' ? from : otherCurrency(from);
          const amount = resolve(m.amount, m.from);
          if (m.from === m.to) expected = 'same_account';
          else if (from !== currency || ACCOUNTS[m.to] !== currency) expected = 'currency_mismatch';
          else if (balances[m.from]! < amount) expected = 'insufficient_funds';
          result = ledger.transfer(ids[m.from]!, ids[m.to]!, amount, currency);
          if (!expected) { balances[m.from]! -= amount; balances[m.to]! += amount; }
        }
        assert.equal(result.ok ? null : result.code, expected, JSON.stringify(m, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)));
        if (result.ok) moved += 1;

        // The ledger agrees with the model, account by account (BK-R09, BK-R12).
        ids.forEach((id, i) => {
          const found = ledger.getAccount(id)!;
          assert.equal(found.balance, balances[i], `account ${i}`);
          assert.ok(found.balance >= 0n);
          // The statement ends on the balance (BK-R15).
          const statement = ledger.statement(id);
          assert.equal(statement.at(-1)?.balance_after ?? 0n, found.balance);
        });
      }

      // The ledger holds together (BK-R13, BK-R14): one transfer per accepted move, two
      // entries each, equal and opposite, in the transfer's currency; every currency
      // sums to zero; nothing in a currency passes the limit (BK-R06).
      const q = (sql: string) => { const s = ledger.db.prepare(sql); s.setReadBigInts(true); return s.all(); };
      assert.equal(Number(q('SELECT COUNT(*) AS n FROM transfers')[0]!.n), moved);
      assert.deepEqual(q(`
        SELECT t.id FROM transfers t LEFT JOIN ledger_entries e ON e.transfer_id = t.id
        GROUP BY t.id
        HAVING COUNT(e.id) <> 2 OR SUM(e.amount) <> 0 OR MIN(e.amount) <> -t.amount OR MAX(e.amount) <> t.amount
            OR SUM(e.currency <> t.currency) > 0`), []);
      assert.deepEqual(q('SELECT currency FROM ledger_entries GROUP BY currency HAVING SUM(amount) <> 0'), []);
      for (const [c, total] of Object.entries(issued)) {
        assert.ok(total <= MAX_MINOR);
        const held = q(`SELECT COALESCE(SUM(e.amount), 0) AS total FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
                        WHERE a.kind = 'customer' AND e.currency = '${c}'`)[0]!.total;
        assert.equal(held, total, c);
      }
    } finally {
      ledger.close();
    }
  }), { numRuns: 300 });
});
