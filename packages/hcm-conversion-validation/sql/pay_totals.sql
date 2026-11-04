-- PAY_TOTAL: pay results whose totals do not match their own lines.
-- Money is text in the legacy database, so every amount is compared in whole cents
-- (floating point would call 0.1 + 0.2 something other than 0.3). Keys are trimmed, as the
-- converter trims them, so '079263 ' still finds its lines and its record.
WITH lines AS (
  SELECT TRIM(employee_id) AS employee_id, TRIM(period_id) AS period_id,
         SUM(CASE WHEN kind = 'earning'   THEN CAST(ROUND(amount * 100) AS INTEGER) ELSE 0 END) AS earning_cents,
         SUM(CASE WHEN kind = 'deduction' THEN CAST(ROUND(amount * 100) AS INTEGER) ELSE 0 END) AS deduction_cents
  FROM pay_lines
  GROUP BY 1, 2
),
results AS (
  SELECT TRIM(employee_id) AS employee_id, TRIM(period_id) AS period_id, gross, deductions, net,
         CAST(ROUND(gross * 100) AS INTEGER) AS gross_cents,
         CAST(ROUND(deductions * 100) AS INTEGER) AS deduction_cents,
         CAST(ROUND(net * 100) AS INTEGER) AS net_cents
  FROM pay_results
)
SELECT r.employee_id, r.period_id, 'gross' AS field, r.gross AS value,
       printf('%.2f', l.earning_cents / 100.0) AS expected, 'is not the sum of its earnings lines' AS message
FROM results r JOIN lines l USING (employee_id, period_id)
WHERE r.gross_cents <> l.earning_cents
UNION ALL
SELECT r.employee_id, r.period_id, 'deductions', r.deductions,
       printf('%.2f', l.deduction_cents / 100.0), 'is not the sum of its deduction lines'
FROM results r JOIN lines l USING (employee_id, period_id)
WHERE r.deduction_cents <> l.deduction_cents
UNION ALL
SELECT employee_id, period_id, 'net', net,
       printf('%.2f', (gross_cents - deduction_cents) / 100.0), 'is not gross minus deductions'
FROM results
WHERE net_cents <> gross_cents - deduction_cents
UNION ALL
SELECT r.employee_id, r.period_id, 'lines', '', '', 'has no pay lines'
FROM results r LEFT JOIN lines l USING (employee_id, period_id)
WHERE l.employee_id IS NULL
ORDER BY 1, 2, 3;
