-- id: entry_mismatch
-- severity: error
-- description: An entry isn't the transfer's debit (-amount on its from account) or its credit (+amount on its to account) (BK-R26)
-- Two entries that sum to zero can still be wrong: the debit and credit swapped, or
-- both on the wrong accounts. Only this check compares them with the transfer row.
SELECT e.id AS entry_id, e.transfer_id, e.account_id, e.amount,
       t.from_account_id, t.to_account_id, t.amount AS transfer_amount
FROM ledger_entries e
JOIN transfers t ON t.id = e.transfer_id
WHERE NOT ((e.account_id = t.from_account_id AND e.amount = -t.amount)
        OR (e.account_id = t.to_account_id AND e.amount = t.amount));
