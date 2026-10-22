# Objectives

Each objective says what a learner does that someone else can watch: send, list, add, predict, show, tell. None of them says "understand" or "know", because those cannot be observed. Each has three quiz questions (one more in the retention check) and one planted bug in the practical.

| # | Module | The learner can | Quiz | Practical bug |
|---|---|---|---|---|
| O1 | 1 | The learner can send an amount as a string, as a JSON number and with one decimal too many, and name the answer each must get. | Q01 to Q03 | Bug O1 |
| O2 | 1 | The learner can list the decimals of CAD, USD, JPY and KWD, and write one deposit for each currency that proves its rule. | Q04 to Q06 | Bug O2 |
| O3 | 2 | The learner can add up the balances before and after a transfer and show that no money was created or lost. | Q07 to Q09 | Bug O3 |
| O4 | 2 | The learner can send a request twice with one Idempotency-Key and predict whether the second answer is a replay or a refusal. | Q10 to Q12 | Bug O4 |
| O5 | 3 | The learner can send twenty overlapping transfers from one account and show from the count of successes and the final balance that it was not overdrawn. | Q13 to Q15 | Bug O5 |
| O6 | 3 | The learner can send a refused request and tell a refusal (a 4xx answer with a code) from a server fault (a 500). | Q16 to Q18 | Bug O6 |

The text of each objective is kept in [quiz/questions.json](../quiz/questions.json), and a test fails if this table says something different.

## Why these six

They are the mistakes this repository's own banking API collected on the way to its 78 deliberate breaks, chosen because each can be checked from outside, with only the API's requests and answers: no source code is needed.
