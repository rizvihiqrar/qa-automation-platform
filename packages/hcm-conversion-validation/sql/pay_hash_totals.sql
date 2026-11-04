-- Hash totals of the legacy payroll per pay period: how many results, and their gross and
-- net in whole cents. The reconciliation compares these with the same totals read back
-- from the target's pay_results report (only for the rows that were sent to the load).
SELECT period_id,
       COUNT(*) AS results,
       SUM(CAST(ROUND(gross * 100) AS INTEGER)) AS gross_cents,
       SUM(CAST(ROUND(net * 100) AS INTEGER)) AS net_cents
FROM pay_results
WHERE TRIM(employee_id) || '/' || TRIM(period_id) IN (SELECT key FROM sent)   -- record keys are trimmed
GROUP BY period_id
ORDER BY period_id;
