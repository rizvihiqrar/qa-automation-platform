# Estimates Against Actuals

Sample data, not real hour logs: six invented releases, chosen so the numbers can be worked out by hand.

Made from `data/releases.json` by `npm run planning`. Variance is actual hours minus estimated hours; the percent is that divided by the estimate, so above zero means the release took longer than planned. A release is flagged when it is more than 10% over. A test compares the numbers with a hand calculation.

| Release | Estimate (h) | Actual (h) | Variance (h) | Variance | Flag |
|---|---|---|---|---|---|
| R1 | 40 | 38 | -2 | -5% |  |
| R2 | 50 | 55 | +5 | +10% |  |
| R3 | 30 | 36 | +6 | +20% | Over budget (more than 10% over) |
| R4 | 60 | 75 | +15 | +25% | Over budget (more than 10% over) |
| R5 | 45 | 54 | +9 | +20% | Over budget (more than 10% over) |
| R6 | 80 | 100 | +20 | +25% | Over budget (more than 10% over) |

Over budget: 4 of 6 releases (R3, R4, R5, R6).
All releases together: 305 hours estimated, 358 hours actual (+17.4%).
Trend over the last 5 releases (R2, R3, R4, R5, R6): +3 percentage points per release, so over-runs growing.
