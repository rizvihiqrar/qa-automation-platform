import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { failed, formatText, loadChecks, parametersOf, parseCheck, runChecks, summarize, CHECKS_DIR, STALE_KEY_MS } from '../src/checks.ts';
import { inject, parseArgs } from '../src/check.ts';
import { MAX_MINOR } from '../src/money.ts';
import { SAMPLE_NOW, buildSample } from '../src/sample.ts';

// The SQL ledger checks. Each one is proven by a defect put straight into the database,
// past the API and with foreign keys off, as a manual fix, a bad migration or another
// tool could: the defect must make exactly the expected checks fire, and the clean
// sample must make none fire. As in sql-data-integrity, some defects rightly break more
// than one rule (a credit one cent too high leaves the transfer and the currency
// unbalanced), and those are listed.

const checks = loadChecks();
const fired = (db: DatabaseSync, now = SAMPLE_NOW) => runChecks(db, checks, { now }).filter(failed).map((r) => r.id).sort();

// Sample ids: accounts 1 Ada, 2 Bo (CAD), 4 Chiyo (JPY), 6 Dana, 7 Eli (USD), 9 Faris
// (KWD); funding 3 CAD, 5 JPY, 8 USD, 10 KWD. Transfer 4 is Ada to Bo, 10.00, keyed
// rent-2026-10, entries 7 (debit) and 8 (credit). Dana's balance is 0, Faris holds the
// KWD limit exactly, and the key in-flight was claimed at 12:00:22, before SAMPLE_NOW.
const DEFECTS: { name: string; rule: string; sql: string; expect: string[] }[] = [
  { name: 'a transfer lost its credit', rule: 'BK-R26', sql: 'DELETE FROM ledger_entries WHERE id = 8;', expect: ['currency_not_zero', 'transfer_entry_count', 'transfer_not_balanced'] },
  { name: 'a third entry, written twice by a retry', rule: 'BK-R26', sql: "INSERT INTO ledger_entries VALUES (19, 4, 2, 1000, 'CAD');", expect: ['currency_not_zero', 'transfer_entry_count', 'transfer_not_balanced'] },
  { name: 'two extra entries that cancel out', rule: 'BK-R26', sql: "INSERT INTO ledger_entries VALUES (19, 4, 1, -500, 'CAD'), (20, 4, 2, 500, 'CAD');", expect: ['entry_mismatch', 'transfer_entry_count'] },
  { name: 'a credit one cent too high', rule: 'BK-R26', sql: 'UPDATE ledger_entries SET amount = 1001 WHERE id = 8;', expect: ['currency_not_zero', 'entry_mismatch', 'transfer_not_balanced'] },
  { name: 'the debit and the credit swapped', rule: 'BK-R26', sql: 'UPDATE ledger_entries SET amount = -amount WHERE transfer_id = 2;', expect: ['entry_mismatch', 'negative_balance', 'overdrawn_in_history'] },
  { name: 'a credit to the wrong account, in another currency', rule: 'BK-R26', sql: 'UPDATE ledger_entries SET account_id = 7 WHERE id = 8;', expect: ['currency_mismatch', 'entry_mismatch'] },
  { name: 'an entry in the wrong currency', rule: 'BK-R26', sql: "UPDATE ledger_entries SET currency = 'USD' WHERE id = 10;", expect: ['currency_mismatch', 'currency_not_zero'] },
  { name: 'a transfer row in the wrong currency', rule: 'BK-R26', sql: "UPDATE transfers SET currency = 'USD' WHERE id = 5;", expect: ['currency_mismatch'] },
  { name: 'an account\'s currency changed after it was used', rule: 'BK-R26', sql: "UPDATE accounts SET currency = 'USD' WHERE id = 4;", expect: ['currency_mismatch'] },
  {
    name: 'a withdrawal from an empty account', rule: 'BK-R27',
    sql: "INSERT INTO transfers VALUES (10, 'withdrawal', 6, 8, 1, 'USD', '2026-10-20T12:01:00.000Z'); INSERT INTO ledger_entries VALUES (19, 10, 6, -1, 'USD'), (20, 10, 8, 1, 'USD');",
    expect: ['negative_balance', 'overdrawn_in_history'],
  },
  {
    name: 'an overdraft refilled a second later', rule: 'BK-R27',
    sql: `INSERT INTO transfers VALUES (10, 'withdrawal', 6, 8, 1, 'USD', '2026-10-20T12:01:00.000Z'); INSERT INTO ledger_entries VALUES (19, 10, 6, -1, 'USD'), (20, 10, 8, 1, 'USD');
          INSERT INTO transfers VALUES (11, 'deposit', 8, 6, 1, 'USD', '2026-10-20T12:01:01.000Z'); INSERT INTO ledger_entries VALUES (21, 11, 8, -1, 'USD'), (22, 11, 6, 1, 'USD');`,
    expect: ['overdrawn_in_history'],
  },
  {
    name: 'one fils past the currency limit', rule: 'BK-R27',
    sql: "INSERT INTO transfers VALUES (10, 'deposit', 10, 9, 1, 'KWD', '2026-10-20T12:01:00.000Z'); INSERT INTO ledger_entries VALUES (19, 10, 10, -1, 'KWD'), (20, 10, 9, 1, 'KWD');",
    expect: ['currency_limit'],
  },
  { name: 'a transfer recorded as a deposit', rule: 'BK-R27', sql: "UPDATE transfers SET kind = 'deposit' WHERE id = 2;", expect: ['wrong_account_kind'] },
  { name: 'a deposit recorded as a transfer', rule: 'BK-R27', sql: "UPDATE transfers SET kind = 'transfer' WHERE id = 1;", expect: ['wrong_account_kind'] },
  { name: 'an entry for an account that doesn\'t exist', rule: 'BK-R28', sql: 'UPDATE ledger_entries SET account_id = 99 WHERE id = 8;', expect: ['entry_mismatch', 'orphan_entries'] },
  { name: 'an entry for a transfer that doesn\'t exist', rule: 'BK-R28', sql: "INSERT INTO ledger_entries VALUES (19, 99, 1, 5, 'CAD');", expect: ['currency_not_zero', 'orphan_entries', 'transfer_not_balanced'] },
  { name: 'an account deleted with its history', rule: 'BK-R28', sql: 'DELETE FROM accounts WHERE id = 7;', expect: ['orphan_entries', 'orphan_transfers'] },
  { name: 'a transfer deleted, its key left behind', rule: 'BK-R28', sql: 'DELETE FROM ledger_entries WHERE transfer_id = 4; DELETE FROM transfers WHERE id = 4;', expect: ['orphan_keys'] },
  {
    // The UNIQUE constraint refuses this (see below), so the table is rebuilt without
    // it first, as a hand-written migration might.
    name: 'a migration dropped UNIQUE, and a second key points at a transfer', rule: 'BK-R28',
    sql: `CREATE TABLE keys_copy (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, transfer_id INTEGER REFERENCES transfers (id), created_at TEXT NOT NULL);
          INSERT INTO keys_copy SELECT * FROM idempotency_keys; DROP TABLE idempotency_keys; ALTER TABLE keys_copy RENAME TO idempotency_keys;
          INSERT INTO idempotency_keys VALUES ('rent-again', 'sample', 4, '2026-10-20T12:01:00.000Z');`,
    expect: ['key_shared_transfer'],
  },
  { name: 'a key in flight for 10 minutes and 1 ms', rule: 'BK-R29', sql: "UPDATE idempotency_keys SET created_at = '2026-10-20T11:54:59.999Z' WHERE key = 'in-flight';", expect: ['stale_in_flight_keys'] },
  { name: 'a key in flight for exactly 10 minutes', rule: 'BK-R29', sql: "UPDATE idempotency_keys SET created_at = '2026-10-20T11:55:00.000Z' WHERE key = 'in-flight';", expect: [] },
  { name: 'a linked key a day old', rule: 'BK-R29', sql: "UPDATE idempotency_keys SET created_at = '2026-10-19T12:00:00.000Z' WHERE key = 'rent-2026-10';", expect: [] },
];

describe('the checks', () => {
  test('BK-R30 the 14 checks load, with unique ids, one per file', () => {
    assert.equal(checks.length, 14);
    assert.equal(new Set(checks.map((c) => c.id)).size, 14);
    assert.deepEqual(checks.filter((c) => c.severity === 'warning').map((c) => c.id), ['stale_in_flight_keys']);
  });

  test('BK-R26 BK-R27 BK-R28 BK-R29 the clean sample, built through the Ledger, passes every check', () => {
    const ledger = buildSample();
    try {
      const results = runChecks(ledger.db, checks, { now: SAMPLE_NOW });
      assert.deepEqual(results.filter(failed), []);
      assert.deepEqual(summarize(results), { checks: 14, passed: 14, errors: 0, warnings: 0, badRows: 0 });
    } finally {
      ledger.close();
    }
  });

  for (const { name, rule, sql, expect } of DEFECTS) {
    test(`${rule} defect "${name}" fires exactly: ${expect.join(', ') || 'nothing'}`, () => {
      const ledger = buildSample();
      try {
        inject(ledger.db, sql);
        assert.deepEqual(fired(ledger.db), [...expect].sort());
      } finally {
        ledger.close();
      }
    });
  }

  test('BK-R30 every check is proven by a defect that fires it', () => {
    const covered = new Set(DEFECTS.flatMap((d) => d.expect));
    assert.deepEqual(checks.map((c) => c.id).filter((id) => !covered.has(id)), []);
  });

  test('BK-R30 the checks no defect fires alone are the ones whose rule always breaks another too', () => {
    // A check that only ever fires with others could be a copy of one of them. These
    // can't fire alone by design: a transfer with a missing entry is also unbalanced,
    // and so is its currency; a negative balance is also a negative running balance;
    // an entry for a missing account can't match its transfer unless the transfer is
    // an orphan too.
    const alone = new Set(DEFECTS.filter((d) => d.expect.length === 1).map((d) => d.expect[0]!));
    const withOthers = checks.map((c) => c.id).filter((id) => !alone.has(id));
    assert.deepEqual(withOthers, ['transfer_entry_count', 'transfer_not_balanced', 'entry_mismatch', 'currency_not_zero', 'negative_balance', 'orphan_entries', 'orphan_transfers']);
  });

  test('BK-R28 with foreign keys on, as the Ledger sets them, the database refuses an orphan; the checks are for every other connection', () => {
    const ledger = buildSample();
    try {
      assert.throws(() => ledger.db.exec("INSERT INTO ledger_entries VALUES (19, 99, 1, 5, 'CAD')"), /FOREIGN KEY constraint failed/);
      assert.throws(() => ledger.db.exec("INSERT INTO idempotency_keys VALUES ('rent-again', 'sample', 4, '2026-10-20T12:01:00.000Z')"), /UNIQUE constraint failed/);
    } finally {
      ledger.close();
    }
  });

  test('BK-R27 the limit in the SQL is the one the API enforces', () => {
    const sql = checks.find((c) => c.id === 'currency_limit')!.sql;
    assert.match(sql, new RegExp(`> ${MAX_MINOR}\\b`));
  });

  test('BK-R29 a key counts as stale after 10 minutes in flight', () => {
    assert.equal(STALE_KEY_MS, 10 * 60 * 1000);
  });
});

describe('portable SQL, for Postgres on Day 49', () => {
  // SQLite accepts things Postgres refuses or reads differently. None of them may appear
  // in a check, outside its comments.
  const SQLITE_ONLY: [RegExp, string][] = [
    [/\b(ifnull|iif|glob|typeof|strftime|julianday|datetime|printf|instr|group_concat|total|unixepoch)\s*\(/i, 'a SQLite-only function'],
    [/"/, 'double quotes (a string in SQLite, an identifier in Postgres)'],
    [/==/, '== (Postgres has only =)'],
    [/\browid\b|\bautoincrement\b/i, 'rowid or AUTOINCREMENT'],
    [/\blimit\s+-1\b/i, 'LIMIT -1'],
    [/\?\d*|@\w+|\$\w+/, 'a placeholder other than :name'],
  ];
  const body = (sql: string) => sql.replace(/--.*$/gm, '');

  for (const check of checks) {
    test(`BK-R30 ${check.file} uses only SQL that Postgres runs too`, () => {
      for (const [pattern, what] of SQLITE_ONLY) assert.doesNotMatch(body(check.sql), pattern, `${check.file} uses ${what}`);
    });
  }

  test('BK-R30 the guard catches what it is meant to', () => {
    const caught = (sql: string) => SQLITE_ONLY.some(([pattern]) => pattern.test(body(sql)));
    for (const bad of ['SELECT IFNULL(amount, 0) FROM t', 'SELECT "x"', 'WHERE a == b', 'SELECT rowid FROM t', 'WHERE id = ?', 'WHERE x GLOB (y)'])
      assert.ok(caught(bad), bad);
    assert.ok(!caught("SELECT COALESCE(SUM(e.amount), 0) FROM e WHERE k = 'x' AND c < :stale_before -- \"comment\""));
  });
});

describe('the runner', () => {
  test('BK-R30 a header line split by CRLF is read without its \\r', () => {
    const check = parseCheck('-- id: x\r\n-- severity: error\r\n-- description: d\r\nSELECT 1;', 'x.sql');
    assert.deepEqual([check.id, check.severity, check.description], ['x', 'error', 'd']);
  });

  test('BK-R30 a check without its headers, or with an unknown severity, is refused', () => {
    assert.throws(() => parseCheck('-- id: x\nSELECT 1;', 'x.sql'), /needs id, severity and description/);
    assert.throws(() => parseCheck('-- id: x\n-- severity: fatal\n-- description: d\nSELECT 1;', 'x.sql'), /unknown severity "fatal"/);
  });

  test('BK-R30 two checks with one id are refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'banking-checks-'));
    after(() => rmSync(dir, { recursive: true, force: true }));
    for (const f of ['a.sql', 'b.sql']) writeFileSync(join(dir, f), '-- id: same\n-- severity: error\n-- description: d\nSELECT 1 WHERE 0;');
    assert.throws(() => loadChecks(pathToFileURL(dir + sep)), /duplicate check ids: same/);
  });

  test('BK-R30 parameters are found outside comments and casts', () => {
    assert.deepEqual(parametersOf('-- :not_this\nSELECT x::text FROM t WHERE a < :stale_before AND b < :stale_before'), ['stale_before']);
  });

  test('BK-R30 a check that can\'t run is reported as an error, not skipped', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const results = runChecks(db, checks, { now: SAMPLE_NOW });
      assert.equal(results.length, 14);
      assert.ok(results.every((r) => r.error?.includes('no such table')), 'every check reports the missing table');
      assert.equal(summarize(results).errors, 14);
      const unknown = runChecks(db, [parseCheck('-- id: p\n-- severity: warning\n-- description: d\nSELECT 1 WHERE 1 < :tomorrow;', 'p.sql')]);
      assert.deepEqual([unknown[0]!.severity, unknown[0]!.error], ['error', 'unknown parameter :tomorrow']);
    } finally {
      db.close();
    }
  });

  test('BK-R30 sums past 2^53 are shown exactly', () => {
    const ledger = buildSample();
    try {
      inject(ledger.db, "INSERT INTO transfers VALUES (10, 'deposit', 10, 9, 1, 'KWD', '2026-10-20T12:01:00.000Z'); INSERT INTO ledger_entries VALUES (19, 10, 10, -1, 'KWD'), (20, 10, 9, 1, 'KWD');");
      const limit = runChecks(ledger.db, checks, { now: SAMPLE_NOW }).find((r) => r.id === 'currency_limit')!;
      assert.deepEqual(limit.rows.map((r) => ({ ...r })), [{ currency: 'KWD', issued: MAX_MINOR + 1n }]);
      assert.match(formatText([limit]), /FAIL  currency_limit +1 row\(s\)\n +currency=KWD, issued=100000000000000000\n/);
    } finally {
      ledger.close();
    }
  });
});

describe('npm run check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banking-check-cli-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (...args: string[]) => spawnSync(process.execPath, ['src/check.ts', ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  // On a real file the checks run at the real time, so the sample's key in flight is
  // long stale; `settled` lets that request finish (give its key up) first.
  const sampleFile = (name: string, { sql, settled = true }: { sql?: string; settled?: boolean } = {}) => {
    const path = join(dir, name);
    const ledger = buildSample(path);
    if (settled) ledger.releaseKey('in-flight');
    if (sql) inject(ledger.db, sql);
    ledger.close();
    return path;
  };

  test('BK-R30 a clean ledger file: every check passes, exit 0', () => {
    const run = cli('--db', sampleFile('clean.db'));
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /14\/14 checks passed, 0 error\(s\), 0 warning\(s\), 0 bad row\(s\)/);
  });

  test('BK-R30 a broken ledger file: the failing check and its rows are shown, exit 1', () => {
    const run = cli('--db', sampleFile('broken.db', { sql: 'UPDATE ledger_entries SET amount = 1001 WHERE id = 8;' }));
    assert.equal(run.status, 1);
    assert.match(run.stdout, /FAIL  transfer_not_balanced +1 row\(s\)\n +transfer_id=4, total=1/);
  });

  test('BK-R29 BK-R30 a warning alone is shown but doesn\'t fail: exit 0', () => {
    const run = cli('--db', sampleFile('warned.db', { settled: false }));
    assert.equal(run.status, 0);
    assert.match(run.stdout, /warn  stale_in_flight_keys +1 row\(s\)\n +key=in-flight/);
  });

  test('BK-R30 the file is opened read-only: checking it changes nothing', () => {
    const path = sampleFile('untouched.db');
    const before = readFileSync(path);
    cli('--db', path);
    assert.deepEqual(readFileSync(path), before);
  });

  test('BK-R30 --demo puts in the demo defects and fails 6 checks with 1 warning, exit 1', () => {
    const run = cli('--demo');
    assert.equal(run.status, 1);
    assert.match(run.stdout, /7\/14 checks passed, 6 error\(s\), 1 warning\(s\), 7 bad row\(s\)/);
  });

  test('BK-R30 a missing file or wrong arguments: a message and exit 2', () => {
    const missing = cli('--db', join(dir, 'nope.db'));
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /unable to open database file/);
    for (const args of [[], ['--db'], ['--db', '--demo'], ['--demo', 'x'], ['--format', 'md']]) {
      assert.throws(() => parseArgs(args), /usage: node src\/check.ts --db <file> \| --demo/, args.join(' '));
    }
    assert.equal(cli().status, 2);
  });
});

test('BK-R30 the checks live in sql/checks, one rule per file, numbered in order', () => {
  assert.ok(CHECKS_DIR.href.endsWith('/sql/checks/'));
  assert.deepEqual(checks.map((c) => Number(c.file.slice(0, 2))), Array.from({ length: 14 }, (_, i) => i + 1));
});
