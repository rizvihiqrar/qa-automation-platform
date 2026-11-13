# Sprint Burndown

Sample sprint, 2 to 13 March 2026: invented data, written by hand so the burndown can be checked against a hand count.

Made from `data/sprint.json` by `npm run planning`. Tickets left is counted at the end of each working day: opened on or before that day and not closed on or before it. The even line goes from day 1's count to zero on the last day. Failing cases come from the last test run on or before the day, and a day with no run shows the earlier number and says so. A test compares every day with a hand count.

| Day | Date | Tickets left | Even line | Failing cases | Note |
|---|---|---|---|---|---|
| 1 | 2026-03-02 | 10 ██████████ | 10 | 12 |  |
| 2 | 2026-03-03 | 9 █████████ | 8.9 | 11 |  |
| 3 | 2026-03-04 | 10 ██████████ | 7.8 | 14 | tickets grew (+1); failing cases grew (+3) |
| 4 | 2026-03-05 | 9 █████████ | 6.7 | 14 | no run: shows 2026-03-04 |
| 5 | 2026-03-06 | 8 ████████ | 5.6 | 9 |  |
| 6 | 2026-03-09 | 7 ███████ | 4.4 | 7 |  |
| 7 | 2026-03-10 | 5 █████ | 3.3 | 5 |  |
| 8 | 2026-03-11 | 4 ████ | 2.2 | 5 |  |
| 9 | 2026-03-12 | 3 ███ | 1.1 | 2 |  |
| 10 | 2026-03-13 | 2 ██ | 0 | 1 |  |

At the end of day 10: 2 of 13 tickets still open (they carry over) and 1 failing case.
