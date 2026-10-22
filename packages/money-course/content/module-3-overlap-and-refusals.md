# Module 3: Requests at the same time, and refusals (O5, O6)

About 20 minutes. Drafted with AI from the banking API's own rules and tests, and reviewed by the author.

## Overlap

A real bank serves many customers at once. If two requests each check "is there enough money?" before either has taken it, both pass, and the account is overdrawn. The API stops this by checking the balance **again, inside the step that writes the money**. A check made earlier is only a forecast.

A test that sends requests one after another can never show this bug: the first has finished before the second starts. The requests must overlap. The banking API has a setting for this, `SCREENING_DELAY_MS`, a pause in each request standing in for a slow outside check (fraud, limits). While one request waits, others run.

## Lab 5 (O5): twenty at once

Start the API with the pause, and fund an account:

```bash
cd packages/banking-api && SCREENING_DELAY_MS=150 npm start
```

Open Ada (1) and Bo (2) in CAD and deposit `"100.00"` into Ada. Then send twenty transfers of `"10.00"` from Ada to Bo **at the same time**. With plain Node:

```bash
node -e "
const send = () => fetch('http://localhost:4100/transfers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from_account_id: 1, to_account_id: 2, amount: '10.00', currency: 'CAD' }) }).then((r) => r.status);
Promise.all(Array.from({ length: 20 }, send)).then((codes) => console.log(codes.filter((c) => c === 201).length, 'went through'));"
```

Then read Ada's balance. Expected: 10 went through, Ada has 0.00. 100.00 pays for ten. If 20 went through, or Ada is below zero, the account was overdrawn.

## Refusals

When a request is wrong, the API decides, and says so: a status in the 400s and a code, `{ "error": "...", "code": "insufficient_funds" }`. A **500** means something broke that the API did not expect. They are different on purpose: a client can act on a 422 (change the amount, pick another account), and cannot act on a 500. Monitoring should only wake someone for a 500.

| Request | Answer |
|---|---|
| A withdrawal one cent over the balance | `422 insufficient_funds` |
| A transfer to an account that does not exist | `404 not_found` |
| A transfer from an account to itself | `422 same_account` |
| A currency that is not CAD, USD, JPY or KWD | `400 invalid_currency` |

## Lab 6 (O6): refusals, not faults

Send each of the four requests in the table and write down the status and code. Then sort what you got into two piles: refusals (4xx with a code) and faults (5xx). Every answer to a customer's mistake belongs in the first pile.

## Check yourself

Quiz questions Q13 to Q18. When you are ready, do the practical.
