-- id: currency_mismatch
-- severity: error
-- description: An entry's currency differs from its transfer's or its account's (BK-R26)
SELECT e.id AS entry_id, e.transfer_id, e.currency AS entry_currency,
       t.currency AS transfer_currency, a.currency AS account_currency
FROM ledger_entries e
JOIN transfers t ON t.id = e.transfer_id
JOIN accounts a ON a.id = e.account_id
WHERE e.currency <> t.currency OR e.currency <> a.currency;
