# exploratory-session-tracker

A light tool for **session-based exploratory testing**: write a charter, test for a fixed amount of time, take timestamped notes tagged BUG, QUESTION, ISSUE and so on, then turn the sessions into a debrief for the team.

**In plain English:** exploratory testing is a skilled tester investigating the product without a script. Without some structure it's hard to show what was covered or what was found. Charters, timeboxes and tagged notes give it that structure, and the debrief makes it reportable.

> The sample sessions in `sessions/` are **made up** to show the format and the debrief. They don't describe a real application.

---

## Example Debrief

```
$ npm run debrief

# Exploratory testing debrief

3 session(s), 129 min, 3 bug(s), 1.4 bugs/hour
Areas covered: Checkout, Inventory

| Session | Area | Time | Pace | Bugs | Questions | First bug after |
|---|---|---|---|---:|---:|---|
| Explore checkout discount codes with invalid, expired and oddly formatted codes to find pricing errors | Checkout | 58 / 60 min | on time | 2 | 1 | 11 min |
| Explore inventory sorting and filtering with many products to find ordering errors | Inventory | 57 / 45 min | over | 1 | 1 | 28 min |
| Explore login | — | 14 / 30 min | short | 0 | 0 | — |

## Open questions for the team
- Should codes be case-insensitive? "save10" is rejected while "Save10" works.
- Should sort choice persist after reload? It currently resets to A to Z.

## Blockers
- Staging product data was reset mid-session; lost 10 minutes re-creating test products.

## Session hygiene
- 2026-10-16-inventory-sorting.md: ran 12 min over the 45 min timebox
- 2026-10-16-login.md: charter is vague: say what to explore, how, and what risk you're looking for; no area; 1 note(s) without a time
```

(The bug list is shortened here.)

---

## Session File Format

```markdown
# Charter: Explore checkout discount codes with invalid and expired codes to find pricing errors

**Tester:** QA
**Area:** Checkout
**Timebox:** 60
**Started:** 2026-10-16T09:00

## Notes
[09:11] BUG: A code with a leading space is accepted but gives no discount.
[09:19] QUESTION: Should codes be case-insensitive?
[09:36] IDEA: Add a regression test for an expired code.
```

| Tag | Use it for |
|---|---|
| `BUG` | Something wrong |
| `ISSUE` | Something that blocked or slowed testing (shows up as a blocker) |
| `QUESTION` | Something to ask the team |
| `IDEA` | A test worth writing later |
| `RISK` | A concern that isn't a bug yet |
| `NOTE` | Anything else; untagged lines count as notes |

Start a new session file:

```bash
node src/cli.js new --charter "Explore refunds with partial amounts to find rounding errors" --area Payments --timebox 45 > sessions/refunds.md
```

---

## What It Measures

- **Time used vs timebox:** *on time*, *over* (more than 10% over), or *short* (under half)
- **Bugs per hour** and **time to first bug**, per session and overall
- **Open questions** and **blockers** collected across sessions
- **Session hygiene:** missing or vague charter, no area, no timebox, notes without times

---

## Tests

```bash
npm test   # 10 tests
```

A round-trip test (create a session from the template, then parse it) caught a bug: the help comment in the template was being read as a note. HTML comments are now skipped. Switching off overrun detection made 3 tests fail.
