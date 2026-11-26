import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { MAX_MINOR, PAYMENT_LIMITS, type Currency } from '../src/money.ts';
import { ON_POSTGRES, failingChecks, openTestStore, rowsOf } from './helpers.ts';

// A model of the bank: random sequences of deposits, withdrawals and transfers between
// accounts in three currencies, run against the real ledger and against a few lines of
// BigInt arithmetic. After every step the two must agree, and the ledger must hold
// together. Runs on the store directly (no HTTP), so it can make thousands of moves. On
// Postgres each run gets a schema of its own, which takes longer, so it makes 60 runs there.

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

test('BK-PR-08 BK-R06 BK-R09 BK-R10 BK-R11 BK-R12 BK-R13 BK-R14 BK-R15 BK-R26 BK-R27 BK-R28 BK-R39 BK-R40 any sequence of moves: the ledger matches the model and holds together', async () => {
  // size 'max': fast-check's default keeps arrays short, and short sequences rarely
  // reach the limit.
  await fc.assert(fc.asyncProperty(fc.array(move, { minLength: 1, maxLength: 40, size: 'max' }), async (moves) => {
    // A fixed clock, so a run never crosses midnight UTC in the middle of the daily limit (BK-R40).
    const ledger = await openTestStore(() => '2026-11-22T12:00:00.000Z');
    try {
      const ids: number[] = [];
      for (const [i, c] of ACCOUNTS.entries()) ids.push((await ledger.openAccount(`Owner ${i}`, c)).id);
      const balances = ACCOUNTS.map(() => 0n);
      const issued: Record<string, bigint> = { CAD: 0n, JPY: 0n, KWD: 0n };
      const sent = ACCOUNTS.map(() => 0n); // what each account has sent today
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
          result = await ledger.deposit(ids[m.account]!, amount, c);
          if (!expected) { balances[m.account]! += amount; issued[c]! += amount; }
        } else if (m.kind === 'withdrawal') {
          const c = ACCOUNTS[m.account]!;
          const amount = resolve(m.amount, m.account);
          if (balances[m.account]! < amount) expected = 'insufficient_funds';
          else if (amount > PAYMENT_LIMITS[c].single) expected = 'payment_limit';
          else if (sent[m.account]! + amount > PAYMENT_LIMITS[c].daily) expected = 'daily_limit';
          result = await ledger.withdraw(ids[m.account]!, amount, c);
          if (!expected) { balances[m.account]! -= amount; issued[c]! -= amount; sent[m.account]! += amount; }
        } else {
          const from = ACCOUNTS[m.from]!;
          const currency = m.currency === 'own' ? from : otherCurrency(from);
          const amount = resolve(m.amount, m.from);
          if (m.from === m.to) expected = 'same_account';
          else if (from !== currency || ACCOUNTS[m.to] !== currency) expected = 'currency_mismatch';
          else if (balances[m.from]! < amount) expected = 'insufficient_funds';
          else if (amount > PAYMENT_LIMITS[currency].single) expected = 'payment_limit';
          else if (sent[m.from]! + amount > PAYMENT_LIMITS[currency].daily) expected = 'daily_limit';
          result = await ledger.transfer(ids[m.from]!, ids[m.to]!, amount, currency);
          if (!expected) { balances[m.from]! -= amount; balances[m.to]! += amount; sent[m.from]! += amount; }
        }
        assert.equal(result.ok ? null : result.code, expected, JSON.stringify(m, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)));
        if (result.ok) moved += 1;

        // The ledger agrees with the model, account by account (BK-R09, BK-R12).
        for (const [i, id] of ids.entries()) {
          const found = (await ledger.getAccount(id))!;
          assert.equal(found.balance, balances[i], `account ${i}`);
          assert.ok(found.balance >= 0n);
          // The statement ends on the balance (BK-R15).
          const statement = await ledger.statement(id);
          assert.equal(statement.at(-1)?.balance_after ?? 0n, found.balance);
        }
      }

      // The ledger holds together (BK-R13, BK-R14): one transfer per accepted move, and
      // every SQL ledger check passes on what the moves left (BK-R26 to BK-R28). Then
      // each currency's customer balances add up to what the model says was issued.
      const q = (sql: string) => rowsOf(ledger, sql);
      assert.equal(Number((await q('SELECT COUNT(*) AS n FROM transfers'))[0]!.n), moved);
      assert.deepEqual(await failingChecks(ledger), []);
      for (const [c, total] of Object.entries(issued)) {
        assert.ok(total <= MAX_MINOR);
        const held = (await q(`SELECT COALESCE(SUM(e.amount), 0) AS total FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
                        WHERE a.kind = 'customer' AND e.currency = '${c}'`))[0]!.total;
        assert.equal(BigInt(held as bigint | number), total, c);
      }
    } finally {
      await ledger.close();
    }
  }), { numRuns: ON_POSTGRES ? 60 : 300 });
});
