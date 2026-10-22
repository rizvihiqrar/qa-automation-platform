# Module 1: Exact amounts (O1, O2)

About 20 minutes. Drafted with AI from the banking API's own rules and tests, and reviewed by the author.

## The problem

Computers keep most decimal numbers as a close guess. In JavaScript, `0.1 + 0.2` is `0.30000000000000004`. A bank cannot be off by a fraction of a cent, so the banking API never uses those numbers for money:

- An amount travels as a **string**: `"12.34"`.
- Inside, it is whole **minor units** (cents, fils): 1234.
- The currency decides how many decimals an amount may have: CAD and USD 2, JPY 0, KWD 3.

A JSON number such as `12.34` is read as a double before the API sees it, and a long one can lose digits before any code runs (`537704868.1699999` arrives as `537704868.17`). So a JSON number is refused with `400 invalid_amount`.

## Lab 1 (O1): three ways to send an amount

Start the API: `cd packages/banking-api && npm start`. Open an account:

```bash
curl -s -X POST localhost:4100/accounts -H 'Content-Type: application/json' -d '{"owner":"Ada","currency":"CAD"}'
```

Then send a deposit three ways, and write down the status and the code you get each time:

```bash
# 1. a string
curl -s -X POST localhost:4100/accounts/1/deposits -H 'Content-Type: application/json' -d '{"amount":"12.34","currency":"CAD"}'
# 2. a JSON number
curl -s -X POST localhost:4100/accounts/1/deposits -H 'Content-Type: application/json' -d '{"amount":12.34,"currency":"CAD"}'
# 3. one decimal too many
curl -s -X POST localhost:4100/accounts/1/deposits -H 'Content-Type: application/json' -d '{"amount":"1.005","currency":"CAD"}'
```

You should see `201`, then `400 invalid_amount`, then `400 invalid_amount`. If the third were accepted, a half cent would have been rounded, or invented.

## Lab 2 (O2): one deposit per currency

| Currency | Decimals | A deposit that is accepted | A deposit that is refused |
|---|---|---|---|
| CAD | 2 | `"10.50"` | `"10.505"` |
| USD | 2 | `"10.50"` | `"10.505"` |
| JPY | 0 | `"1250"` | `"100.50"` |
| KWD | 3 | `"1.250"` | `"1.2501"` |

Open an account in each currency and send the pair. Write down what each answer was. A test that uses only CAD does not cover yen or the dinar: the rule is different for each.

## Check yourself

Take the quiz in "before" and "after" mode (questions O1 to O6, three per objective). The ones for this module are Q01 to Q06.
