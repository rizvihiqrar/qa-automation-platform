# Practical checklist

One row for each objective. For each, write what the API should do, what it did, and tick it when the two match. A row where they do not match is a bug. Do not open the model answer until you have been through every row.

| # | Behaviour to check | Should | Did | Matches |
|---|---|---|---|---|
| O1 | An amount with one decimal more than the currency has is refused. Try CAD with three decimals. | | | ☐ |
| O1 | An amount sent as a JSON number is refused. | | | ☐ |
| O2 | Each of CAD, USD, JPY and KWD accepts an amount with its own number of decimals and refuses one more. | | | ☐ |
| O2 | A whole-yen deposit is kept as that many yen (check the balance). | | | ☐ |
| O3 | Open two accounts, deposit into one, transfer part of it, and add up both balances before and after. The total must not change. | | | ☐ |
| O4 | The same Idempotency-Key with the same request gives the first answer back, and money moves once. | | | ☐ |
| O4 | The same Idempotency-Key with a different amount is refused. | | | ☐ |
| O5 | Twenty transfers at once from an account that can afford ten: ten go through, the balance is not negative. | | | ☐ |
| O6 | A withdrawal over the balance, a transfer to a missing account and a transfer to the same account each answer with a 4xx and a code. | | | ☐ |
| O6 | No customer mistake answers 500. | | | ☐ |

## When you are done

Count the rows that did not match. The model answer lists six bugs. If you found fewer, the objectives of the ones you missed are the ones to go back to. If you found all six, go to the quiz's "after" mode.
