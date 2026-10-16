# Charter: Explore inventory sorting and filtering with many products to find ordering errors

**Tester:** QA
**Area:** Inventory
**Timebox:** 45
**Started:** 2026-10-16T10:30

## Notes
[10:32] NOTE: Four sort options; default is name A to Z.
[10:41] ISSUE: Staging product data was reset mid-session; lost 10 minutes re-creating test products.
[10:58] BUG: Price high-to-low places a $49.99 item after a $9.99 item when prices have more than two decimals in the database.
[11:12] QUESTION: Should sort choice persist after reload? It currently resets to A to Z.
[11:27] NOTE: Session ended; ran over because of the data reset.
