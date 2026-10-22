# Module 2: The ledger and retries (O3, O4)

About 20 minutes. Drafted with AI from the banking API's own rules and tests, and reviewed by the author.

## The ledger

Every movement of money is written twice: one entry out of one account and one entry into another, the same amount, in one step. A deposit comes out of the bank's funding account for that currency. So the sum of every balance, funding accounts included, never changes. You cannot see the funding accounts through the API, but you can see what they imply: when money moves between two customers, the two balances together stay the same.

## Lab 3 (O3): add up before and after

1. Open two CAD accounts, Ada (1) and Bo (2). Deposit `"25.00"` into Ada.
2. Write down Ada's and Bo's balances, and add them: 25.00.
3. Transfer `"10.00"` from Ada to Bo:

```bash
curl -s -X POST localhost:4100/transfers -H 'Content-Type: application/json' -d '{"from_account_id":1,"to_account_id":2,"amount":"10.00","currency":"CAD"}'
```

4. Read both balances again and add them. It must still be 25.00 (15.00 and 10.00). A sum of 25.01 means a cent was created. A 24.99 means one was lost.

Why this check works: it does not need to know how the code does it. Any bug that makes the two entries unequal shows up in the sum.

## Retries and the Idempotency-Key

A client sends a transfer and the reply is lost. Did the money move? It cannot tell, and retrying could move it twice. The `Idempotency-Key` header is the answer: the API remembers the key with the request, and a repeat of the same request gets the first answer back (with the header `Idempotent-Replayed: true`) instead of a second movement.

A key belongs to one request. Reused for a different request, it is refused with `422 idempotency_key_mismatch`, because replaying the first answer would tell the client the wrong thing happened.

## Lab 4 (O4): send twice, predict the answer

Open two new CAD accounts (they are accounts 3 and 4 if you followed Lab 3) and deposit `"50.00"` into account 3, then:

```bash
curl -si -X POST localhost:4100/transfers -H 'Content-Type: application/json' -H 'Idempotency-Key: lab-4' -d '{"from_account_id":3,"to_account_id":4,"amount":"5.00","currency":"CAD"}'
```

Before each of the next sends, write your prediction (replay, new transfer, or refusal) and then compare:

1. The same request again, key `lab-4`.
2. The same key with `"amount":"6.00"`.
3. A new key `lab-4b`, amount `"5.00"`.

Prediction: a replay (201 and `Idempotent-Replayed`), a `422 idempotency_key_mismatch`, and a new transfer. Check the sender's balance: 40.00 after all three (two transfers of 5.00 moved, the replay and the refusal did not).

## Check yourself

Quiz questions Q07 to Q12.
