-- id: wrong_account_kind
-- severity: error
-- description: A deposit not from the funding account, a withdrawal not to it, or a transfer not between two customer accounts (BK-R27)
SELECT t.id AS transfer_id, t.kind, f.kind AS from_kind, o.kind AS to_kind
FROM transfers t
JOIN accounts f ON f.id = t.from_account_id
JOIN accounts o ON o.id = t.to_account_id
WHERE NOT ((t.kind = 'deposit'    AND f.kind = 'funding'  AND o.kind = 'customer')
        OR (t.kind = 'withdrawal' AND f.kind = 'customer' AND o.kind = 'funding')
        OR (t.kind = 'transfer'   AND f.kind = 'customer' AND o.kind = 'customer'));
