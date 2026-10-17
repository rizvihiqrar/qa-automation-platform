# Retrospective: v1.0

The 30-day plan in [ROADMAP.md](ROADMAP.md) is done. This page looks back on what was built, what worked, what didn't, and what the project still doesn't prove.

## How it was done

The plan was written as 30 "days", each one module or one improvement. Days 1–3 consolidated earlier projects into this repo; from Day 4 on, each day was one branch and one pull request, merged only when CI was green: 29 pull requests in total. The work was done in AI-assisted sessions with Claude Code. Every change went through review and CI like any other, and the bugs on this page were found by running the code, not by reading about it.

## What v1.0 contains

| | |
|---|---|
| Packages | 24 (9 in strict TypeScript, the rest type-checked as JavaScript) |
| Automated checks | about 650 |
| CI jobs per run on main | 30, plus nightly runs |
| Workflows | CI, dashboard and reports, flaky-test tracking, release gate, AI generator eval |
| Real defects found and fixed | 18 ([list](README.md#bugs-found-and-fixed-while-building-this)) |
| Public pages | [CI dashboard](https://rizvihiqrar.github.io/qa-automation-platform/), [test reports](https://rizvihiqrar.github.io/qa-automation-platform/reports/) |

## The lesson that kept coming back: green is not proof

The most useful findings were checks that passed while checking nothing:

- A generated test with **no assertion passed** its Playwright run, because it clicked a button that happened to exist. Only the review step caught it.
- The first **performance threshold (250 ms) passed a real bug** (67–84 ms p95 from blocking password hashing). Thresholds are now set from measurements.
- A **lost or doubled test shard** still merged into a green report (29 or 58 "passed" instead of 43). A shard check now proves every test ran exactly once.
- **Cucumber exits 0** when a tag matches no scenarios, so a mistyped smoke tag would have tested nothing.
- A logout check, `toHaveURL(/$/)`, **matched every URL**, so it could never fail.

Because of this, most checks here are proven to fail when they should: the SQL rules each have an injected defect, the mutation demo has a measured score (89.1%), the accessibility audit runs against a deliberately broken "before" store as well as the fixed one, and four deliberate mutations of the flaky tracker's rules were each caught by a test.

## What worked

- **One pull request per change, merged on green.** Small diffs made failures easy to trace, and CI caught things local runs didn't (a `.gitignore` rule that hid log fixtures, a type-check that needed each package's own dependencies).
- **Measuring before claiming.** Sharding saved 12 seconds of waiting but doubled runner time, so only one suite is sharded. Smoke tests on pull requests cut live-site test runs by 75% but didn't shorten the wait, because k6 is the slowest job. Both numbers are in the READMEs as measured, not as hoped.
- **Moving to TypeScript found bugs, not just types:** an update route that skipped validation, an order that could oversell stock, and a Windows-only line-ending bug that made a tool reject every input.
- **Scanning before publishing.** The first scan of the test reports found live demo-API tokens in the Postman report, before they reached a public page.

## What didn't, and what v1.0 doesn't prove

- **The AI generator eval ran once**, on 10 features. That's enough to show the method, not enough to say how much results vary between runs. A repeated eval with variance is the next step for that package.
- **The flaky-test tracker hasn't met a real flaky test yet.** It has checked every full run on main since it was added and found none; opening and closing issues is proven by unit tests, not live.
- **Deploys are simulated.** The release gate's GO/NO-GO decision is real; there is no environment behind it.
- **Some suites test public demo sites** (Sauce Demo, DummyJSON). If those change, tests break for reasons outside this repo; the package READMEs say how to handle that.
- **14 packages are still JavaScript** under the type-checker rather than strict TypeScript.
- **The test-scope rule is conservative:** a README-only change inside a browser package still runs that suite in full.

## Next

New modules after v1.0 will follow the same rules: one pull request each, merged on green CI, with tests and a README that states real numbers. Candidates include a repeated AI eval with an LLM-as-judge and variance reporting, and moving the remaining tools to strict TypeScript.
