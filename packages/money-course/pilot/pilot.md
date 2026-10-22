# Pilot plan and record

The course is run as a **pilot**: the author and two or three other people go through it once, and what they find is used to fix the course. It is not an evaluation. Three or four people cannot show that a course works, and nothing here says it does. The first run is **not done yet**: it takes place after the session that built the course, and the tables below stay empty until it has.

## Who and how they are recorded

- The author and two or three other people.
- Each person has a code: P1, P2, P3, P4. Names are never recorded. The person running the pilot keeps the list of who is which code, privately, and not in this repository.
- People send lines back, and the person running the pilot pastes them into the table below. Nothing is collected by the quiz page: it stores and sends nothing.

## The steps, in order

| Step | What | About | What the person sends back |
|---|---|---|---|
| 1 | Quiz in **before** mode (`/course/?mode=before`) | 10 min | The line it gives: `P1 \| before \| 11/18 \| missed: O3, O4` |
| 2 | The three modules in [content/](../content/), with their labs | 60 min | Nothing |
| 3 | Quiz in **after** mode (`?mode=after`) | 10 min | The line, as in step 1 |
| 4 | The [practical](../practical/brief.md), self-checked against the model answer | 45 min | `P1 \| practical \| 4/6 \| 50 min`: bugs found of 6, and minutes taken |
| 5 | The survey below | 5 min | `P1 \| survey \| 4,5,4,3,5 \| confusing: ... \| change: ...` |
| 6 | Quiz in **retention** mode (`?mode=retention`), **14 days after step 3** | 5 min | The line: `P1 \| retention \| 5/6 \| missed: O4` |

The quiz page is at https://rizvihiqrar.github.io/qa-automation-platform/course/ once the dashboard has been rebuilt after the course merged. Offline: `npm run quiz` in this package, then http://127.0.0.1:4300/.

## The retention check, and when it is due

Retention is checked **two weeks after the "after" quiz**, with six new questions (one for each objective, in `quiz/questions.json` under `retention`), so a good score cannot be memory of the quiz itself. For each person, **the due date is the date of their "after" quiz plus 14 days**, written in the record table. If the first person finishes step 3 on **Fri 2026-10-23** (the earliest the pilot can start), the first retention check is due **Fri 2026-11-06**.

## Survey (step 5)

Rate 1 (no) to 5 (yes):

1. The objectives were clear, and I could tell when I had met each one.
2. The difficulty was about right.
3. The practical felt like testing a real system.
4. The time it took was reasonable.
5. I would use what I learned in my own testing.

And two short answers: **the most confusing thing** (a question, a lab step or a sentence), and **one change** you would make.

## Record

Filled in by the person running the pilot, from the lines people send. Counts, not percentages: with this few people a percentage means nothing.

| Code | Before (of 18) | After (of 18) | Practical (bugs of 6) | Minutes | Survey (1 to 5, five answers) | After quiz on | Retention due | Retention (of 6) |
|---|---|---|---|---|---|---|---|---|
| P1 | | | | | | | | |
| P2 | | | | | | | | |
| P3 | | | | | | | | |
| P4 | | | | | | | | |

Questions two or more people answered wrongly in the "after" quiz, and every confusing thing and requested change, go in the findings list below, with what was done about each.

## Findings and changes

_Not yet run._

## How the pilot is reported

When the table is full, one short report goes at the top of this file and in the package README, in this form:

- **What it was:** a pilot of N people, run on a date, with the steps above. Not an evaluation.
- **Before and after:** each person's score, and the objectives most often missed, before and after.
- **Practical:** bugs found of six for each person, which bug was found least often, and the time taken.
- **Survey:** the five ratings as a list of numbers, and the confusing things and changes asked for.
- **Retention:** each person's score two weeks later, and the dates.
- **What was changed because of it:** each question, lab step or sentence that was fixed.
- **What it does not show:** that the course changes how anyone tests. That is Kirkpatrick level 3, a person's own test code improving at work, and it was not measured.
