# Model answer

Six bugs, one for each objective. Each was planted in a copy of the banking API, and the check described here was run against it and found it. The same six checks are code in [src/model-answer.ts](../src/model-answer.ts), and [a test](../test/model-answer.test.ts) proves two things for each: it passes on the real API, and it fails on the copy with that bug planted, and on no other.

How to use this page: read each section, compare with what you found, and note the objective of any you missed. You do not need to have found all six.

## O1. One decimal too many is accepted

**Find it:** deposit `"1.005"` CAD.
**Should:** `400 invalid_amount`. CAD has two decimals.
**Did:** `201`, and the balance shows `10.05`: the extra decimal was read as part of a whole number of cents, so ten times the money arrived.
**Why it matters:** a refused amount costs the customer a retry. An accepted wrong amount costs the bank money, quietly.

## O2. Yen is given two decimals

**Find it:** open a JPY account and deposit `"100.50"`.
**Should:** `400 invalid_amount`. Yen has no decimals. A deposit of `"1250"` must leave the balance `1250`.
**Did:** `100.50` was accepted, and a deposit of `"1250"` was answered `"1250.00"`: the API now counts hundredths of a yen.
**Why it matters:** a test that only uses CAD passes. Each currency with a different number of decimals needs its own case.

## O3. The debit is one minor unit short of the credit

**Find it:** two CAD accounts, deposit `"25.00"` into the first, transfer `"10.00"` to the second, and add up both balances.
**Should:** 15.00 and 10.00, a total of 25.00, the same as before.
**Did:** 15.01 and 10.00. The total is 25.01: one cent was created by the transfer.
**Why it matters:** the status was `201` and every amount looked fine on its own. Only the sum shows it, and the sum needs no knowledge of the code.

## O4. The amount is left out of the idempotency key fingerprint

**Find it:** transfer `"5.00"` with key `K`, then send `"6.00"` with the same key `K`.
**Should:** `422 idempotency_key_mismatch`. The key was used for a different request.
**Did:** `201` with the header `Idempotent-Replayed: true`: the first transfer's answer, for a request that asked for 6.00. The client believes 6.00 moved. 5.00 did.
**Why it matters:** the retry case (same request twice) worked, so a test that only retries identically passes. The different-request case is the one to add.

## O5. Funds are not checked again when the money is written

**Find it:** fund an account with `"100.00"` and send twenty transfers of `"10.00"` at the same time.
**Should:** exactly ten answer `201`, the other ten `422 insufficient_funds`, and the balance is `0.00`.
**Did:** all twenty answer `201` and the balance is `-100.00`: each request passed the early check while the others were still waiting.
**Why it matters:** sent one after another, the same twenty requests give the right answer. Only overlapping requests show it.

## O6. A transfer to the same account fails with a 500

**Find it:** transfer `"1.00"` from an account to itself.
**Should:** `422 same_account`.
**Did:** `500 internal`: the API did not recognise the mistake, and the database refused it.
**Why it matters:** a customer mistake that answers 500 cannot be fixed by the client, and it fills the server's error alerts with something that is not an outage.

## If you found a different problem

The practical is built on the real banking API, so a difference you notice that is not on this page may be real, or may be a gap in the practical. Tell the person running the pilot.
