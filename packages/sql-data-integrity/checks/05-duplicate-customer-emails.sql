-- id: duplicate_customer_emails
-- severity: error
-- description: The same email (ignoring case and spaces) used by more than one customer
SELECT lower(trim(email)) AS email, COUNT(*) AS customers, group_concat(id) AS customer_ids
FROM customers
GROUP BY lower(trim(email))
HAVING COUNT(*) > 1;
