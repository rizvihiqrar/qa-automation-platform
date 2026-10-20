[![banking-api: accounts and transfers on a double-entry ledger, every cent exact](docs/banner.svg)](docs/banner.svg)

# banking-api

A small banking API built to be tested: accounts in four currencies, deposits, withdrawals and transfers, on a double-entry ledger in SQLite. Money never touches floating point. Amounts arrive and leave as decimal strings and are held as whole minor units (cents, yen, fils) in BigInt and SQL integers, so amounts no JavaScript number can hold stay exact. A retried request moves money once (idempotency keys), and requests sent at the same time, even through two server processes on one database file, can't overdraw an account. 14 SQL checks then read the database itself and prove that every transfer balances, whatever wrote to it. They run on clean data, on the files real races leave, after random runs, and in CI, where a broken ledger fails the build. 30 written [rules](SPEC.md) are checked by 216 designed cases and 8 property-based tests, and 56 mistakes were put back on purpose to prove the tests catch each one. It is the base for Day 46's UI and Day 49's Postgres.

**In plain English:** computers store most numbers in a way that can't hold 0.10 exactly, so adding ten cents three times gives 0.30000000000000004. A bank can't round its way out of that. This API counts whole cents instead, and every movement of money is written twice, once out of one account and once into another, so the books always balance. And when a phone on a bad connection sends "pay rent" twice, or two payments leave the same account in the same instant, the rent is paid once and the account never goes below zero. Last, a set of checks reads the books directly, the way an auditor would, so a bad manual fix or a buggy script shows up even when the API itself never misbehaved.

[![The demo run: two accounts opened, three 0.10 deposits making exactly 0.30, a 90 trillion dollar deposit kept to the cent, a JSON number refused with 400, an overdraft refused with 422, and the statement with a running balance](docs/demo.png)](docs/demo.png)

*`npm run demo` against the real API: three 0.10 deposits make 0.30, a deposit above 2^53 cents keeps its last cent, a JSON number and an overdraft are refused, and the statement shows the balance after each entry. Then a transfer sent twice with the same `Idempotency-Key` is replayed, not repeated, and the same key with another amount is refused. Last, three withdrawals of the whole balance are sent at once: one passes. The last line shows what doubles would have answered. ([dark version](docs/demo-dark.png))*

## Installation

```bash
cd packages/banking-api && npm ci
```

Node 24 or later. No runtime dependencies: the server is `node:http`, the database is `node:sqlite`, and Node runs the TypeScript directly.

## Quick start

Start the API, then move money with plain JSON. Amounts are strings.

```bash
npm start   # http://localhost:4100, ledger in memory
curl -s -X POST localhost:4100/accounts -H 'Content-Type: application/json' -d '{"owner":"Ada","currency":"CAD"}'
curl -s -X POST localhost:4100/accounts/1/deposits -H 'Content-Type: application/json' -d '{"amount":"25.00","currency":"CAD"}'
curl -s localhost:4100/accounts/1/entries
```

## At a glance

- Money as whole minor units in BigInt and SQL `INTEGER`; no amount is ever a JavaScript number
- Amounts sent and returned as strings: `"12.34"` is accepted, `12.34` is refused with `400`
- Four currencies with different decimals: CAD and USD 2, JPY 0, KWD 3
- Exact above 2^53 minor units, up to 99,999,999,999,999,999 per currency
- Double-entry ledger: every movement is one debit and one credit of the same amount, in one transaction
- Balances are the sum of ledger entries, never a stored number that could drift
- Overdrafts, transfers between currencies and transfers to the same account are refused with `422`, and nothing is written
- Statements with the balance after each entry, worked out in SQL
- `Idempotency-Key` on every money movement: a retry replays the first answer, a reused key with another request is `422`, a key still running is `409`
- Real races, not simulated ones: two server processes on one SQLite file, and a slow screening step during which requests overlap
- No overdraft and no `500` under load: the funds check runs again inside the write, and a busy database waits, then answers `503`
- 14 SQL ledger checks, one `.sql` file each: every transfer balances, no balance ever dipped below zero, no orphan rows
- Each check proven by a defect put into the database past the API, and run on clean, raced and randomly generated ledgers
- `npm run check -- --db ledger.db` exits 1 on a broken ledger; CI runs it on a file two servers have just raced
- Portable SQL, guarded by a test, so the same checks can run on Postgres (Day 49)
- 30 numbered [rules](SPEC.md); a test fails if any rule has no test
- 227 tests in about three seconds: 216 designed cases, 8 property-based tests, 3 spec checks
- 56 deliberate mistakes, each caught

## Features

### Money as strings and minor units

An amount is read digit by digit from a JSON string, never through `Number` or `parseFloat`, and kept as a BigInt count of minor units. Day 39 showed why the string matters: a JSON number has already lost digits before any code sees it (`537704868.1699999` arrives as `537704868.17`), so no server can refuse what it was never sent.

| Sent | CAD | JPY | KWD |
|---|---|---|---|
| `"12.34"` | 1234 cents | refused: no decimals | 12340 fils |
| `"12"` | 1200 cents | 12 yen | 12000 fils |
| `"1.230"` | refused: 3 decimals | refused | 1230 fils |
| `12.34` (a number) | refused | refused | refused |
| `"-1"`, `"1e3"`, `"007"`, `" 1"` | refused | refused | refused |

Responses always carry the currency's decimals: a deposit of `"5"` comes back as `"5.00"` in CAD and `"5.000"` in KWD. The limit, 10^17 − 1 minor units per currency, keeps every sum inside SQLite's 64-bit integers while staying above 2^53, so the amounts that break doubles are inside the range tested.

### A double-entry ledger

```sql
-- sql/schema.sql (abridged)
CREATE TABLE transfers      (id, kind, from_account_id, to_account_id, amount INTEGER CHECK (amount > 0), currency, created_at);
CREATE TABLE ledger_entries (id, transfer_id, account_id, amount INTEGER CHECK (amount <> 0), currency);
```

Each deposit, withdrawal or transfer writes one `transfers` row and two `ledger_entries` rows, `-amount` and `+amount`, inside `BEGIN IMMEDIATE … COMMIT`. Deposits come from, and withdrawals go to, an internal funding account per currency, so the entries in each currency always sum to zero. The API never shows a funding account; it shows `null` where one would appear. A balance is `SUM(amount)` over the account's entries, and a statement's running balance is a window function over the same rows.

### Retried requests: idempotency keys

A client that times out can't tell whether its transfer went through. With an `Idempotency-Key` header it can send the same request again safely:

```bash
curl -s -X POST localhost:4100/transfers -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: rent-2026-10' -d '{"from_account_id":1,"to_account_id":2,"amount":"5.00","currency":"CAD"}'
```

| The same key again, with | Answer | Written |
|---|---|---|
| the same request (`"5"` and `"5.00"` count as the same) | `201`, the first answer's body, `Idempotent-Replayed: true` | nothing |
| a different amount, account, route or currency | `422 idempotency_key_mismatch` | nothing |
| the first request still running, here or on another server | `409 idempotency_key_in_use` | nothing |
| after a refusal (`404`, `422`) or a failure | treated as new: refused requests keep no key | the movement, once |
| 24 hours or more after first use | treated as new: the key has expired | the movement |

```sql
-- sql/schema.sql
CREATE TABLE idempotency_keys (
  key         TEXT    PRIMARY KEY,
  fingerprint TEXT    NOT NULL,                        -- route, accounts, amount, currency
  transfer_id INTEGER UNIQUE REFERENCES transfers (id), -- NULL while in flight
  created_at  TEXT    NOT NULL
);
```

A keyed request claims its key first, and the key is linked to its transfer in the same transaction that writes the transfer. A test makes that link fail on purpose: the transfer is rolled back with it, so no movement exists without its key.

### Requests at the same time

Each movement awaits a screening step first, standing in for an outside fraud or limits check (`SCREENING_DELAY_MS` makes it slow). Other requests run during that wait, so the balance read before it may be stale by the time the money moves. The fix is to check again where it can't go stale:

```ts
// src/ledger.ts: the bank's rules run again inside the write transaction
apply(m: Movement, key?: string): Result<Transfer> {
  return this.#write(() => {          // BEGIN IMMEDIATE ... COMMIT
    const refusal = this.check(m);    // funds and the limit, read under the write lock
    if (refusal) return refusal;
    // insert the transfer, the two entries, and link the key
  });
}
```

What the tests measured, sending requests together and letting the database decide the order:

| Race | Without the fix | With it |
|---|---|---|
| 20 transfers of 10.00 at once from 100.00, one process | 20 pass, balance −100.00 | 10 pass, balance 0.00 |
| 10 deposits at once, room for 3 under the KWD limit | 10 pass, limit passed | 3 pass |
| 60 withdrawals of 10.00 from 100.00 through two processes on one file | 37 pass, balance −270.00 | 10 pass, 50 refused |
| The same, on the code before today (check already inside the transaction) | 1 to 4 of 60 answered `500 database is locked` | no `500`: a busy connection waits up to 5 s |
| One key sent 10 times at once to two servers | (no keys before today) | one `201`, nine `409`, a later retry replayed |

### SQL ledger checks

The tests above go through the API. These checks go straight to the database and ask whether the books still balance, however the rows got there: through the API, a manual fix, a migration, or a script with foreign keys off (SQLite's default for any connection that doesn't turn them on). Each check is a `.sql` file in [`sql/checks`](sql/checks) whose query returns the rows that break one rule.

[![npm run check -- --demo: 7 of 14 checks pass; transfer_not_balanced, entry_mismatch, currency_not_zero, overdrawn_in_history, wrong_account_kind and orphan_keys fail with their rows, and stale_in_flight_keys warns](docs/checks.png)](docs/checks.png)

*`npm run check -- --demo`: the sample ledger with five defects put in by hand. A credit raised by one cent fails three checks. An overdraft refilled a second later fails only the history check, since the balance now is fine. Every failing row is printed, and the run exits 1. ([dark version](docs/checks-dark.png))*

| # | Check | Rule | Finds |
|---:|---|---|---|
| 1 | `transfer_entry_count` | BK-R26 | A transfer without exactly two entries |
| 2 | `transfer_not_balanced` | BK-R26 | A transfer whose entries don't sum to zero |
| 3 | `entry_mismatch` | BK-R26 | An entry that isn't the transfer's debit (−amount, from account) or credit (+amount, to account) |
| 4 | `currency_mismatch` | BK-R26 | An entry whose currency differs from its transfer's or its account's |
| 5 | `currency_not_zero` | BK-R26 | A currency whose entries don't sum to zero |
| 6 | `negative_balance` | BK-R27 | A customer balance below zero |
| 7 | `overdrawn_in_history` | BK-R27 | A customer whose running balance went below zero at any entry, even if refilled later |
| 8 | `currency_limit` | BK-R27 | A currency holding more than 10^17 − 1 minor units |
| 9 | `wrong_account_kind` | BK-R27 | A deposit not from the funding account, a withdrawal not to it, a transfer not between customers |
| 10 | `orphan_entries` | BK-R28 | An entry for a transfer or account that doesn't exist |
| 11 | `orphan_transfers` | BK-R28 | A transfer for an account that doesn't exist |
| 12 | `orphan_keys` | BK-R28 | An idempotency key pointing at a transfer that doesn't exist |
| 13 | `key_shared_transfer` | BK-R28 | One transfer answering for two keys (if the `UNIQUE` constraint was lost) |
| 14 | `stale_in_flight_keys` | BK-R29 | A key in flight for over 10 minutes: a request that stopped (a warning, not an error) |

Two entries that sum to zero can still be wrong, so one check compares each entry with its transfer row:

```sql
-- sql/checks/03-entry-mismatch.sql
SELECT e.id AS entry_id, e.transfer_id, e.account_id, e.amount,
       t.from_account_id, t.to_account_id, t.amount AS transfer_amount
FROM ledger_entries e
JOIN transfers t ON t.id = e.transfer_id
WHERE NOT ((e.account_id = t.from_account_id AND e.amount = -t.amount)
        OR (e.account_id = t.to_account_id AND e.amount = t.amount));
```

**How each check is proven.** A clean sample ledger is built through the `Ledger` itself: every currency, every kind of movement, a whole balance spent, KWD filled to its limit exactly, a keyed transfer, refusals that write nothing, and a key still in flight. All 14 checks pass on it. Then 22 defects are put into copies of it with plain SQL, past the API and with foreign keys off. Each test asserts the exact set of checks that fires:

| Defect put in | Checks that fire |
|---|---|
| A credit one cent too high | `transfer_not_balanced`, `entry_mismatch`, `currency_not_zero` |
| Two extra entries that cancel out | `transfer_entry_count`, `entry_mismatch` |
| The debit and the credit swapped | `entry_mismatch`, `negative_balance`, `overdrawn_in_history` |
| A transfer row in the wrong currency | `currency_mismatch` |
| An overdraft refilled a second later | `overdrawn_in_history` |
| One fils past the KWD limit | `currency_limit` |
| An account deleted with its history | `orphan_entries`, `orphan_transfers` |
| A migration dropped `UNIQUE`, and a second key points at a transfer | `key_shared_transfer` |
| A key in flight for 10 minutes and 1 ms / for exactly 10 minutes | `stale_in_flight_keys` / nothing |

A test fails if any check has no defect that fires it. Seven checks never fire alone, and a test names them and why: a transfer missing an entry is also unbalanced, and a negative balance is also a negative running balance.

**Where they run.**

| Ledger | How it's made | Where |
|---|---|---|
| Clean sample | Built through the `Ledger`, fixed clock | [`checks.test.ts`](test/checks.test.ts) |
| Raced files | Two `node src/server.ts` processes on one SQLite file, with and without a slow screening | [`concurrency.test.ts`](test/concurrency.test.ts), read-only while the servers still run |
| Random runs | The end of each of 300 random sequences of up to 40 moves | [`ledger.property.test.ts`](test/ledger.property.test.ts) |
| A fresh race in CI | `npm run race -- raced.db`: five races, 220 requests in all, at two servers, in three currencies | The CI job, then `npm run check -- --db raced.db` |

**Postgres.** The checks are plain SQL (`LEFT JOIN`, `GROUP BY … HAVING`, a window function), and a test fails if one uses something only SQLite accepts: `IFNULL`, `GLOB`, `strftime`, double-quoted strings, `==`, `rowid`, or a placeholder other than `:name`. Day 49 runs the same files on Postgres.

### Refusals

Every refusal is `{ "error", "code" }`, checked in a fixed order: the request first, then the idempotency key, then whether the accounts exist, then the bank's rules.

| Status | Codes |
|---|---|
| `400` | `invalid_json`, `invalid_body`, `invalid_currency`, `invalid_amount`, `invalid_owner`, `invalid_account_id`, `invalid_idempotency_key` |
| `404` | `not_found` (account, transfer or route; funding accounts too) |
| `405` | `method_not_allowed`, with `Allow` |
| `409` | `idempotency_key_in_use` (the first request with this key is still running) |
| `413` | `body_too_large` (over 16 KB) |
| `415` | `unsupported_media_type` (a POST that isn't `application/json`) |
| `422` | `idempotency_key_mismatch`, `same_account`, `currency_mismatch`, `insufficient_funds`, `limit_exceeded` |
| `503` | `busy`, with `Retry-After: 1` (another process held the database for over 5 seconds) |

### Endpoints

| Method | Path | Body | Answer |
|---|---|---|---|
| `POST` | `/accounts` | `owner`, `currency` | `201` the account, balance zero |
| `GET` | `/accounts/:id` | | the account and its balance |
| `GET` | `/accounts/:id/entries` | | the account and its entries, oldest first, each with `balance_after` |
| `POST` | `/accounts/:id/deposits` | `amount`, `currency` | `201` the transfer |
| `POST` | `/accounts/:id/withdrawals` | `amount`, `currency` | `201` the transfer, or `422 insufficient_funds` |
| `POST` | `/transfers` | `from_account_id`, `to_account_id`, `amount`, `currency` | `201` the transfer |
| `GET` | `/transfers/:id` | | the transfer and its two entries |
| `GET` | `/health` | | `{ "status": "ok" }` |

The three `POST` routes that move money take an optional `Idempotency-Key` header (1 to 255 visible ASCII characters).

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4100` | Port the API listens on (qa-practice-api uses 4000) |
| `DATABASE_PATH` | none: in memory | A SQLite file to keep the ledger in across restarts; several servers can share one |
| `SCREENING_DELAY_MS` | `0` | Makes the screening before each movement take this long, as a slow outside check would; the race tests use it |

## CI integration

The package runs as its own job in the root [CI workflow](../../.github/workflows/ci.yml), and its TypeScript is type-checked in the `typecheck` job.

```yaml
- { package: banking-api, browsers: false, command: npm test && npm run demo && npm run race -- raced.db && npm run check -- --db raced.db }
```

After the tests and the demo, the job races requests at two server processes on one file and runs the SQL checks on what they left. `npm run check` exits 1 if any check fails, so a race bug that slips past every test still fails the job.

## Results

[![The test run: ledger-check defect tests passing, each naming the exact checks it fires, 227 tests, 0 failures](docs/tests.png)](docs/tests.png)

*Part of `npm test`: the first of the defect tests, each naming the exact checks its defect must fire, then the totals. ([dark version](docs/tests-dark.png))*

| Tests | Count | What they check |
|---|---:|---|
| [`money.test.ts`](test/money.test.ts) | 60 | Reading and writing amounts: boundary values, equivalence classes and inputs that break float or loose parsing, each tagged with its technique |
| [`api.test.ts`](test/api.test.ts) | 67 | Every endpoint and refusal over HTTP, including a database failure injected between the debit and the credit |
| [`idempotency.test.ts`](test/idempotency.test.ts) | 22 | Keys over HTTP: format boundaries, replays of all three movements, mismatches, a request held in its screening to show `409`, refused and failed requests keeping no key, a failure injected into the key link, and expiry at exactly 24 hours on an injected clock |
| [`concurrency.test.ts`](test/concurrency.test.ts) | 10 | Real races: overlapping requests in one process during a 20 ms screening, and two `node src/server.ts` processes on one SQLite file, with and without a slow screening. Checks the counts of `201` and `422`, that nothing is a `500`, a lock held from outside, `503` when it's held too long, and runs the SQL ledger checks on both files the races left |
| [`checks.test.ts`](test/checks.test.ts) | 57 | The SQL ledger checks: the clean sample passes, 22 defects put in past the API each fire exactly the checks they should, the SQL is portable to Postgres (one test per file, and a test that the guard itself catches SQLite-only SQL), the runner reports a check that can't run, and the CLI's exit codes |
| [`money.property.test.ts`](test/money.property.test.ts) | 7 | fast-check: any amount round-trips, no JSON number is accepted, any accepted text is plain digits, neighbours above 2^53 stay apart |
| [`ledger.property.test.ts`](test/ledger.property.test.ts) | 1 | A model of the bank: 300 random sequences of up to 40 moves across six accounts in three currencies. After every move each balance matches the model; at the end, all 14 SQL ledger checks pass |
| [`spec.test.ts`](test/spec.test.ts) | 3 | Every rule in [SPEC.md](SPEC.md) has a test, and every rule a test names exists |

### Deliberate breaks

Each mistake was put into the code, the tests run, and the code restored. All 56 were caught. The three that depend on timing between processes (B21 to B23) were run five times each and caught every time. B35 to B40 write bad rows; their counts include the defect tests, which fail because the sample ledger is built with the broken code. B41 to B56 break the checks, the runner and the CLI themselves.

| # | Mistake | Caught by |
|---|---|---:|
| B01 | Amounts read through a double (`Math.round(Number(value) * 100)`) | 10 tests |
| B02 | JSON numbers accepted | 6 |
| B03 | One decimal too many accepted (`"1.005"` read as 1005 cents) | 6 |
| B04 | Zero accepted as an amount | 6 |
| B05 | The limit not applied to a single amount | 3 |
| B06 | The leading zero dropped when writing (`".01"`) | 18 |
| B07 | `<=` for `<` in the funds check: the whole balance can't be spent | 3 |
| B08 | No funds check | 4 |
| B09 | No transaction around the two entries | 1 |
| B10 | The receiving account's currency not checked | 3 |
| B11 | No same-account check (the database refuses it, as a `500`) | 3 |
| B12 | The currency limit not enforced | 2 |
| B13 | Integers read from SQLite as JavaScript numbers (the driver's default) | 15 |
| B14 | Funding accounts visible through `GET /accounts/:id` | 1 |
| B15 | Every statement row shows the final balance | 1 |
| B16 | Statement newest first | 2 |
| B17 | The database's error message shown to the client | 1 |
| B18 | `Cache-Control: no-store` missing | 2 |
| B19 | No body size limit | 1 |
| B20 | Any content type read as JSON | 1 |
| B21 | No busy timeout: a second process fails at once | 3 to 4 |
| B22 | Funds checked only before the screening, not again when writing | 6 |
| B23 | `BEGIN` (deferred) for `BEGIN IMMEDIATE` | 2 |
| B24 | A busy database answered with `500`, not `503` | 1 |
| B25 | The `Idempotency-Key` ignored | 13 |
| B26 | The amount left out of the key's fingerprint | 2 |
| B27 | No `Idempotent-Replayed` header on a replay | 7 |
| B28 | A refused request keeps its key | 4 |
| B29 | The key linked after the transfer commits, not in its transaction | 1 |
| B30 | No in-flight check: a running key counts as free | 3 |
| B31 | `<` for `<=` in the expiry: a key lives 1 ms too long | 2 |
| B32 | Keys never expire | 2 |
| B33 | Key length not checked | 1 |
| B34 | Accounts and funds checked before the key (a replay after the balance ran out is refused) | 2 |
| B35 | Both entries written in CAD, whatever the currency | 23 |
| B36 | The transfer row records from and to swapped (the entries are right) | 34 |
| B37 | Every transfer row recorded as kind `transfer` | 32 |
| B38 | The transfer row written in CAD, whatever the currency | 24 |
| B39 | The debit one minor unit short of the credit | 46 |
| B40 | No funds or limit check inside the write transaction; `npm run race` + `npm run check` also exits 1 | 37 |
| B41 | `transfer_entry_count`: `> 2` for `<> 2` (a missing entry passes) | 1 |
| B42 | `entry_mismatch` compares amounts, not accounts | 3 |
| B43 | `currency_mismatch` ignores the account's currency | 2 |
| B44 | `negative_balance` counts funding accounts too | 27 |
| B45 | `overdrawn_in_history` runs one balance across all accounts (no `PARTITION BY`) | 4 |
| B46 | `currency_limit`: `>=` for `>` (the limit itself fails) | 27 |
| B47 | `wrong_account_kind` accepts any transfer | 2 |
| B48 | `orphan_entries` ignores a missing account | 2 |
| B49 | `orphan_keys` reports keys still in flight | 24 |
| B50 | `stale_in_flight_keys`: `<=` for `<` (exactly 10 minutes is stale) | 1 |
| B51 | The runner drops a check that can't run instead of reporting it | 1 |
| B52 | The runner reads sums as JavaScript numbers | 1 |
| B53 | The CLI exits 0 on a broken ledger | 2 |
| B54 | The CLI fails on a warning | 1 |
| B55 | The CLI opens the file read-write | 1 |
| B56 | Defects put in with foreign keys on (the orphan defects can't be made) | 5 |

### What building it found

- **Random amounts don't find boundaries.** The first version of the ledger model generated random amounts, and with it B07 (`<=` for `<`) and B12 (the limit switched off) passed the property test; only designed cases caught them. Random amounts almost never equal a balance exactly, and fast-check's default size kept sequences too short to reach the limit. The model now also generates "the whole balance", "what's left under the limit", and one more than each, worked out when the move runs, and longer sequences. It catches both.
- **A break can be caught for the wrong reason.** The first "no transaction" break removed `BEGIN` and `COMMIT` but not `ROLLBACK`, so refusals crashed and six tests failed, none of them about atomicity. With every transaction statement removed, exactly one test fails: the one that makes the database refuse the credit after the debit is written. No ordinary request can show a half-written transfer, because nothing fails between the two inserts; only an injected failure proves the transaction is there.
- **SQLite drivers hand back integers as JavaScript numbers by default.** Without `setReadBigInts(true)` (B13), every balance passes through a double on its way out of the database. Fifteen tests catch it, including the deposit above 2^53.
- **A test depended on the order tests ran in.** The funding-account test expected the first KWD deposit to create the funding account, but an earlier test had already made one. It now has its own server.
- **The race on day one wasn't an overdraft, it was a `500`.** Day 43's code already checked funds inside `BEGIN IMMEDIATE`, and that lock holds across processes, so two servers on one file never overdrew. But SQLite's default busy timeout is zero: a second process that found the lock taken failed at once with `database is locked`, and 1 to 4 requests in 60 answered `500`. The fix is a 5 second busy timeout, and `503` with `Retry-After` if even that runs out.
- **The overdraft needs a wait between the check and the write.** It appeared as soon as a slow step (the screening) sat between reading the balance and writing: 20 transfers of 10.00 from 100.00 all passed. Checking again inside the write transaction fixed it, and the early check stays only so the screening isn't asked about requests that would be refused anyway.
- **`BEGIN` instead of `BEGIN IMMEDIATE` doesn't overdraw in SQLite; it deadlocks.** Two deferred transactions both read, then both try to write, and SQLite refuses one at once without waiting, so the race tests saw `503`s, not a negative balance. On Postgres the same mistake under `READ COMMITTED` would overdraw: both transactions sum the old entries. Day 49 needs `SELECT … FOR UPDATE` on the account row for the same guarantee.
- **A COMMIT can be busy too.** The test that holds the lock from outside failed one run in six: its `COMMIT` had to wait for a reader in the server process, and it had no busy timeout. Every connection, the tests' included, now sets one.
- **Two breaks were first caught by a hang, not a failure.** With the key ignored, the request meant to get `409` went into the held screening and never came back, so the test run timed out. The test now races that request against a one-second timer and fails with a reason.
- **The API never reads the currency column on entries.** Balances are summed per account, so entries written in the wrong currency (B35), or a transfer row in the wrong currency (B38), change nothing a client sees. Before today, no designed case caught either; only the model test's inline SQL did. That inline SQL is now the checks, which catch both on the clean sample and after every random run.
- **A balance of zero can hide an overdraft.** Day 44's check on the raced file looked only at final balances. An overdraft refilled a second later leaves a final balance that looks fine, and only the running balance shows it (`overdrawn_in_history`). Removing `PARTITION BY` from that check (B45) mixes all accounts into one running balance, and four tests catch it.
- **A race bug fails CI even without a race assertion.** With the funds check taken out of the transaction (B40), `npm run race` followed by `npm run check` exits 1: `negative_balance`, `overdrawn_in_history` and `currency_limit` fire on the raced file. The CI job would fail even if no race test counted the `201`s.
- **Foreign keys are off for everyone else.** SQLite enforces them only on connections that ask, and the `Ledger` asks. The `sqlite3` shell, a migration script or a reporting tool doesn't, so an orphan row needs no bug in the API. A test shows the `Ledger`'s connection refusing the same orphan that the defect tests put in with foreign keys off. Leaving them on in the defect helper (B56) makes four orphan defects impossible to create.
- **Read-write would turn a typo into a database.** Opening the file without `readOnly` (B55) didn't change an existing file. It was caught because a mistyped path created a new, empty database, and the CLI then reported 14 missing tables instead of "unable to open database file".
- **Some checks can't fire alone, and that's correct.** A transfer missing its credit is also unbalanced, and so is its currency. A test lists the seven checks that only ever fire with others, with the reason, so a check that quietly copies another can't hide among them.

## FAQ

### Why strings and not JSON numbers?

JSON numbers are read as doubles. `0.29` is fine, but `537704868.1699999` and `537704868.17` are the same double, and digits past about 16 are gone before any code runs. A string arrives exactly as it was sent. Day 39 found this in the [AI-written discount code](../../docs/ai-written-code/properties-and-mutation.md).

### Why not a decimal library?

Whole minor units in BigInt need no library and map straight onto SQL `INTEGER` (`BIGINT` on Postgres). The ledger sums integers, and integers add exactly.

### Can two requests at once overdraw an account?

No, and the tests show it for real rather than by interleaving calls by hand. Requests overlap during the screening wait in one process, and across two server processes on one SQLite file. The funds check runs again inside the `BEGIN IMMEDIATE` transaction that writes, so the outcome is the same as running the requests one after another. Taking that second check out (B22) lets 20 of 20 transfers through where 10 should pass.

### Why not store the balance with a `CHECK (balance >= 0)`?

`UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?` is safe on both SQLite and Postgres. But it brings back a stored number that can drift from the ledger, which BK-R09 rules out, and the SQL checks would then have to reconcile the two. Locking and checking inside the transaction keeps one source of truth.

### Why SQL checks when the schema has constraints?

Constraints guard the rows the database is told about, one row at a time: a `CHECK (amount > 0)`, a foreign key. They can't say that a transfer's two entries sum to zero, or that a balance never dipped below zero last Tuesday, and foreign keys only apply on connections that turn them on. The checks look at the whole ledger at once, whatever wrote to it, and the tests show both sides: the `Ledger`'s connection refuses an orphan, and the checks catch the same orphan when another connection writes it.

### How do I check my own ledger file?

`npm run check -- --db path/to/ledger.db`. The file is opened read-only, with a 5 second busy timeout, so it can be checked while servers are using it. The exit code is 0 for clean (warnings allowed), 1 for a failing check, and 2 for a file that can't be opened. To see what failures look like, `npm run check -- --demo` runs the checks on the sample ledger with defects put in.

### Will the checks run on Postgres?

They are written to, and a test fails if one uses SQL only SQLite accepts. The one parameter, `:stale_before`, becomes `$1` there. The history check orders entries by id, which matches the order they were written because each write holds the lock: the whole database in SQLite, and on Postgres the account rows taken `FOR UPDATE` before the entries get their ids. Day 49 runs them there.

### What changes on Postgres (Day 49)?

`BEGIN IMMEDIATE` locks the whole SQLite database, so checking inside the transaction is enough. Postgres locks rows, and under `READ COMMITTED` two transactions can both sum the old entries. The same guarantee there needs `SELECT … FROM accounts WHERE id = $1 FOR UPDATE` before the sum, taken in a fixed order (lowest id first) so two opposite transfers can't deadlock. The race tests here are written against HTTP, so they can run unchanged against that version.

### Why does a key whose first request crashed stay `409`?

The claim is a row with no transfer yet. If the server stops before it finishes, nothing removes the row, so the key stays in flight until it expires after 24 hours. Taking over an abandoned key sooner needs a lease with a token, which this demo leaves out (see [SPEC.md](SPEC.md#out-of-scope-today)).

### Is there any sign-in?

No: anyone can move money between any accounts. Access control is tested on [qa-practice-api](../qa-practice-api/README.md); here the subject is the money. [SPEC.md](SPEC.md#out-of-scope-today) lists what is out of scope.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `400 invalid_amount: amount must be a string` | The amount was sent as a JSON number | Quote it: `"amount": "12.34"` |
| `400 invalid_amount: at most 2 decimals for CAD` | More decimals than the currency has, even a trailing zero | Send `"1.23"`, not `"1.230"` |
| `415 unsupported_media_type` | The POST has no `Content-Type: application/json` | Add the header |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node older than 22.5 | Use Node 24, as CI does |
| The balance is gone after a restart | The ledger is in memory by default | Set `DATABASE_PATH=banking.db` |
| `422 idempotency_key_mismatch` | The key was used for another amount, account or route in the last 24 hours | Use a new key for a new request |
| `409 idempotency_key_in_use` | The first request with this key hasn't finished | Wait and retry with the same key: it replays once done |
| `503 busy` | Another process held the database file for over 5 seconds | Retry after `Retry-After` seconds |
| `npm run check` exits 2: `unable to open database file` | The path is wrong; the CLI never creates a file | Check the path to the `.db` file |
| `warn stale_in_flight_keys` | A keyed request stopped more than 10 minutes ago and left its key in flight | Nothing is wrong with the money; the key frees itself 24 hours after first use |
| Every check says `could not run: no such table` | The file isn't a banking-api ledger | Point `--db` at the file in `DATABASE_PATH` |

## Development

```bash
npm ci
npm test                          # 227 tests, about three seconds
npm run demo                      # the requests in the screenshot above
npm run check -- --demo           # the SQL ledger checks on a ledger with defects put in
npm run race -- raced.db          # race two servers on one file, then:
npm run check -- --db raced.db    # check what they left
npm start                         # the API on PORT (4100)
```

The README images are real output, captured with `npm run terminal` in [`scripts/screenshots`](../../scripts/screenshots/terminal.mjs).

## License

MIT
