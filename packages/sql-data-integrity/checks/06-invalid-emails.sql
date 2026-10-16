-- id: invalid_emails
-- severity: warning
-- description: Emails missing a local part, an @, or a domain with a dot, or containing spaces
SELECT id AS customer_id, email
FROM customers
WHERE email NOT LIKE '%_@_%._%'
   OR email LIKE '% %';
