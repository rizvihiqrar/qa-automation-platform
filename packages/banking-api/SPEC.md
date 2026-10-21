# banking-api: rules

[← Back to the README](README.md)

The rules the API must follow. Every test names the rules it checks (`BK-R05`), and a test in [`test/spec.test.ts`](test/spec.test.ts) fails if a rule has no test or a test names a rule that doesn't exist.

## Money

| Rule | What must hold |
|---|---|
| BK-R01 | Amounts are sent and returned as JSON strings (`"12.34"`). A JSON number is refused: JSON numbers are doubles, and digits are lost before any code sees them (`537704868.1699999` arrives as `537704868.17`). |
| BK-R02 | Each currency has its own number of decimals: CAD 2, USD 2, JPY 0, KWD 3. An amount may have up to that many decimals. More are refused, even zeros (`"1.230"` in CAD), and a JPY amount has no decimal point at all. |
| BK-R03 | An amount is plain digits with an optional decimal point that has digits on both sides. No sign, spaces, exponent (`1e3`), leading zeros (`"007"`), thousands separators or other numerals. |
| BK-R04 | Amounts are held as whole minor units (cents, yen, fils): BigInt in code, INTEGER in SQL. No amount is ever a floating-point number. |
| BK-R05 | An amount must be greater than zero. |
| BK-R06 | The money held in one currency, by all accounts together, may not pass 99,999,999,999,999,999 minor units (10^17 − 1). A deposit that would pass it is refused (`limit_exceeded`). Every sum stays inside SQLite's 64-bit integers, and the limit is above 2^53, so amounts a double can't hold are exact. |
| BK-R07 | Amounts are returned with exactly the currency's decimals: a CAD deposit of `"5"` is `"5.00"`, a KWD one `"5.000"`, a JPY one `"5"`. |

## Accounts

| Rule | What must hold |
|---|---|
| BK-R08 | An account has an owner (1 to 100 characters after trimming spaces) and one supported currency, fixed when it opens. It opens with a balance of zero. |
| BK-R09 | A balance is the sum of the account's ledger entries. No balance is stored, so none can drift from the ledger. |

## Money movements

| Rule | What must hold |
|---|---|
| BK-R10 | A transfer names `from_account_id`, `to_account_id`, `amount` and `currency`. The currency must be the currency of both accounts: there is no exchange (`currency_mismatch`). Deposits and withdrawals name `amount` and `currency`, which must be the account's. |
| BK-R11 | A transfer from an account to itself is refused (`same_account`). |
| BK-R12 | A transfer or withdrawal that would make a balance negative is refused (`insufficient_funds`), and nothing is written. Spending the whole balance is allowed. |
| BK-R13 | Every movement (deposit, withdrawal, transfer) writes one transfer row and exactly two ledger entries, a debit and a credit of the same amount, in one database transaction: all of it or none of it. |
| BK-R14 | Deposits come from, and withdrawals go to, the currency's funding account, so the entries in each currency always sum to zero. Funding accounts are internal: the API never shows them, and shows `null` where one would appear. |
| BK-R15 | An account's statement lists its entries oldest first, each with the balance after it. The last `balance_after` equals the account's balance. |

## The API

| Rule | What must hold |
|---|---|
| BK-R16 | Refusals have a JSON body `{ "error", "code" }`, and the status says what kind: `400` for a request that can't be read (body, currency, amount, ids, owner, idempotency key), `404` for an unknown account, transfer or route, `405` for the wrong method (with `Allow`), `409` for a key whose first request is still running, `413` for a body over 16 KB, `415` for a POST that isn't JSON, `422` for a key reused for another request or a rule of the bank (`same_account`, `currency_mismatch`, `insufficient_funds`, `limit_exceeded`), `503` for a database busy too long. Checks run in that order: the request first, then the idempotency key, then whether the accounts exist, then the bank's rules. Nothing a client sends gets a `500`. |
| BK-R17 | Ids in paths are positive whole numbers; any other path is `404`. Ids in a body are JSON whole numbers of 1 or more (`400 invalid_account_id` otherwise). |
| BK-R18 | Every API response is `application/json`, with `Cache-Control: no-store` (balances must not be cached) and `X-Content-Type-Options: nosniff`. The UI's three files (BK-R32) have their own types and the same two headers. |

## Retries and races

| Rule | What must hold |
|---|---|
| BK-R19 | A deposit, withdrawal or transfer may carry an `Idempotency-Key` header of 1 to 255 visible ASCII characters (`400 invalid_idempotency_key` otherwise). Keys are global, not per account. Without a key, every request is a new movement; other routes ignore the header. |
| BK-R20 | A key that completed a movement replays it: the same request with the same key answers `201` with the same body as the first time and `Idempotent-Replayed: true`, and writes nothing. The same request means the same route, accounts, amount and currency, with amounts compared in minor units (`"5"` and `"5.00"` CAD are the same). |
| BK-R21 | A key reused for a different request is `422 idempotency_key_mismatch`. A key whose first request is still running, in this process or another, is `409 idempotency_key_in_use`. Neither writes anything. |
| BK-R22 | Only a written movement keeps its key: a refused or failed request leaves no key, so the same key can be tried again. A key is linked to its transfer in the transaction that writes the transfer, so no key points at a transfer that wasn't written and no transfer answers for two keys. |
| BK-R23 | A key is kept for 24 hours from its first use. From then on it is forgotten, and a request with it is a new movement. |
| BK-R24 | Movements at the same time, in one server process or in several on one database file, can't overdraw an account or pass the currency limit: the bank's rules are checked again inside the transaction that writes, after any wait (such as the screening before a movement). The outcome is the same as running them one after another. |
| BK-R25 | A server waits up to 5 seconds for another process's write to finish instead of failing. A database that stays locked longer answers `503 busy` with `Retry-After: 1`, never `500`, and nothing is written. |

## The ledger in SQL

Rules the database itself must hold, whatever wrote to it: checked by the SQL queries in [`sql/checks`](sql/checks), one rule per file, run by `npm run check`.

| Rule | What must hold |
|---|---|
| BK-R26 | The ledger balances. Every transfer has exactly two entries: a debit of minus its amount on its from account and a credit of its amount on its to account. Each entry's currency is its transfer's and its account's. The entries of each transfer, and of each currency, sum to zero. |
| BK-R27 | No customer balance is below zero, now or at any entry in its history, even if it was refilled later. The money held in a currency stays within the limit of BK-R06. A deposit comes from the currency's funding account, a withdrawal goes to it, and a transfer is between two customer accounts. |
| BK-R28 | No row points at a row that doesn't exist: entries at transfers and accounts, transfers at accounts, keys at transfers. No transfer answers for two keys. These hold even for a connection with foreign keys off (SQLite's default) or a table that lost its `UNIQUE` constraint. |
| BK-R29 | An idempotency key in flight for more than 10 minutes is reported as a warning: its request most likely stopped and left the key blocked (see [Keys after a crash](#out-of-scope-today)). A key linked to its transfer is never stale. |
| BK-R30 | `npm run check -- --db <file>` opens a ledger read-only, runs every check, and exits 1 when an error-level check finds a row, 0 otherwise (warnings are shown but don't fail), and 2 for wrong arguments or a file it can't open. A check that can't run is an error, not a skip. Every check is proven by a defect put into the database past the API, and none fires on a clean ledger, on the files real races leave, or after random model runs. The SQL also runs on Postgres: no SQLite-only functions, double-quoted strings or placeholders other than `:name`. |

## The UI

A small banking UI served by the API's own server (plain HTML and JavaScript, no framework, no build), tested in Chrome and Firefox by Cypress ([`cypress/e2e`](cypress/e2e)), which counts as tests for the rule check above.

| Rule | What must hold |
|---|---|
| BK-R31 | `GET /accounts` lists every customer account, oldest first, each with its balance as in BK-R07; a new bank lists none. Funding accounts are never listed. |
| BK-R32 | The UI is three files served at `/`, `/app.js` and `/app.css`, with `Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`: no inline script, style or event handler, and nothing from another origin. Other methods are `405`, other paths `404` JSON. Pages are built from text, never HTML strings, so an owner's name can't become markup. |
| BK-R33 | Money in the UI is text from end to end. An amount is sent as typed, with only the spaces around it removed, as a JSON string; every amount shown is the API's string. The UI never turns an amount into a number and never adds one up. Each amount field is a text field (not `type="number"`, which takes `1e3` and rounds) with the currency in its label and its decimals in a hint. |
| BK-R34 | A refusal is shown in the form that caused it: the API's message, in an element with `role="alert"`, linked to the field it's about by `aria-describedby`, and that field marked `aria-invalid`. What was typed stays. An unknown account or page shows Account Not Found with a link back. |
| BK-R35 | One movement per filled form. The page makes one `Idempotency-Key` when a form is first sent and keeps it until a final answer (`201` or a refusal). With no answer, `409`, `502`, `503` or `504`, it tries again up to 3 times with the same key; still unconfirmed, it says so and keeps the key, so sending again replays instead of moving the money twice. While a request runs, a second click or Enter is ignored. A confirmed or refused form gets a new key, so the same amount twice on purpose is two movements. |
| BK-R36 | Balances and statements on the page are always the API's: the page reads the account again after every answer, success or refusal, and never works a balance out itself. A page left open while another tab moves money shows the fresh balance at its next answer, and its own movement is checked against the real balance, not the one on screen. |
| BK-R37 | The UI has no WCAG 2.2 A or AA violation that axe-core finds, on every screen and state, in the light and dark themes and at 375 px wide with no sideways scrolling. Every field has a visible label, everything works by keyboard, a skip link comes first, focus moves to the heading when a page opens, and the theme switch is a labelled button that says what it will do. |

## Out of scope today

- **Two real browsers at once.** Cypress drives one tab, so the second tab in BK-R36 is another client of the same API (`cy.request`, or `fetch` from inside an intercept), which is what a second tab is to the server. Two real browser contexts at once are shown with Playwright in [multi-user-flow-patterns](../multi-user-flow-patterns/README.md).

- **Who may move money.** There is no sign-in: anyone can move money between any accounts. Access control is tested on [qa-practice-api](../qa-practice-api/README.md) (Day 36); here the subject is the money.
- **Keys after a crash.** A server that stops in the middle of a keyed request leaves its key in flight (`409`) until the key expires 24 hours later. Taking over an abandoned key sooner needs a lease, which this demo leaves out.
- **Repairing a broken ledger.** The checks find and show the bad rows; fixing them is a decision for a person, made with another correcting transfer, never by editing entries.
- **Postgres.** The checks are written to run there, and [Day 49](../../ROADMAP.md) runs them there.
- **Exchange between currencies.** Refused, not converted.
