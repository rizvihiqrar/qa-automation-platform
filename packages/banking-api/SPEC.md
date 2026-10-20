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
| BK-R16 | Refusals have a JSON body `{ "error", "code" }`, and the status says what kind: `400` for a request that can't be read (body, currency, amount, ids, owner), `404` for an unknown account, transfer or route, `405` for the wrong method (with `Allow`), `413` for a body over 16 KB, `415` for a POST that isn't JSON, `422` for a rule of the bank (`same_account`, `currency_mismatch`, `insufficient_funds`, `limit_exceeded`). Checks run in that order: the request first, then whether the accounts exist, then the bank's rules. Nothing a client sends gets a `500`. |
| BK-R17 | Ids in paths are positive whole numbers; any other path is `404`. Ids in a body are JSON whole numbers of 1 or more (`400 invalid_account_id` otherwise). |
| BK-R18 | Every response is `application/json`, with `Cache-Control: no-store` (balances must not be cached) and `X-Content-Type-Options: nosniff`. |

## Out of scope today

- **Who may move money.** There is no sign-in: anyone can move money between any accounts. Access control is tested on [qa-practice-api](../qa-practice-api/README.md) (Day 36); here the subject is the money.
- **Retries and races** are [Day 44](../../ROADMAP.md): idempotency keys, and two transfers at once trying to overdraw an account.
- **Ledger checks in SQL** are [Day 45](../../ROADMAP.md): queries that prove every transfer balances, run against the database itself.
- **Exchange between currencies.** Refused, not converted.
