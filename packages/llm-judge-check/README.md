# llm-judge-check

Checks an LLM-as-judge against human labels. The judge reads an acceptance criterion and the AI-written Playwright tests for it, and answers whether the tests really check it: **covered**, **partial** or **missing**. Its answers are compared with labels a person decided, case by case, and the report gives agreement, Cohen's kappa, which weak tests the judge caught, and every case where it disagreed. A [red team](#red-team-day-41) then tries to steer it with text written into the tests it reads: prompt injection, deceptive code, hallucination bait and refusal bait. Every one of these AI tests is [traced](#tracing-day-42) to a self-hosted Langfuse, and CI checks that each has exactly its trace.

**In plain English:** people are starting to let one AI grade another AI's work. Before trusting the grader, you check it against a person's answers on the same questions. This package does that check, and its main finding is about the grading instructions, not the AI.

Written in TypeScript (Node 24 runs the `.ts` files directly). [promptfoo](https://www.promptfoo.dev/) runs the eval; the browser checks use Playwright.

---

## Results

67 cases: the 43 acceptance criteria of the ten Day 4 feature files, judged against the AI-written specs exactly as generated, plus 24 copies with one test changed on purpose (16 plain, 8 subtler). The human labels: 43 covered, 15 partial, 9 missing.

Two judges (Claude Haiku 5.5 and Claude Sonnet 5.5), three runs each, with two versions of the grading instructions (the rubric). A judge's verdict is the majority of its three runs.

| Judge | Rubric | Agreement | Kappa | Weak real tests caught | Subtler variants right |
|---|---|---:|---:|---:|---:|
| Haiku | v1 | 57/67 (85%) | 0.71 | 1 of 6 | 5 of 8 |
| Haiku | v2 | 61/67 (91%) | 0.82 | 2 of 6 | 6 of 8 |
| Sonnet | v1 | 56/67 (84%) | 0.67 | 1 of 6 | 4 of 8 |
| Sonnet | v2 | 61/67 (91%) | 0.82 | 2 of 6 | 7 of 8 |

Full tables, confidence intervals, confusion matrices and every disagreement: [REPORT.md](REPORT.md).

### What it found

- **The judges agreed with whoever wrote the rubric, not with the reviewer.** Under v1, both judges matched the first-draft labels on 61–64 of 67 cases, and the human labels on 56–57. The reviewer went through all 67 drafts and changed 7. On the six real tests the reviewer called partial, the v1 judges caught one. The rubric had told them "one example is enough", which is looser than the reviewer's rule.
- **Rewriting the rubric from the reviewer's rules helped, but only so far.** Rubric v2 ([`judge/prompt-v2.md`](judge/prompt-v2.md)) states the rules as general principles. Agreement went from 84–85% to 91%, and kappa from about 0.7 to 0.82. Five of the six v2 runs beat every v1 run; the sixth equalled them. But four real cases stayed wrong in all twelve runs, even with the rule written out: a details-page test that checks only the address (J07), two cart tests that compare only names (J40, J57), and a race where the test doesn't wait for the page (J11).
- **More rules made the judges less consistent.** All three Sonnet runs gave the same verdict on 65 of 67 cases under v1 and on 58 under v2. With v2, a single run scored anywhere from 56 to 62; with v1, 56 or 57. One run is not a measurement: the report uses the majority of three.
- **All six v1 runs were wrong the same way on an unawaited `expect`.** They called it "missing", the common belief. Playwright 1.64 actually fails the test when an unawaited assertion is still pending at the end: a wrong value fails, the right value passes 20 of 20 ([evidence](evidence/label-evidence.spec.ts)). Under v2, which tells the judge to go by what happens at runtime, five of six still said missing.
- **A judge found a mistake in the human labels.** The reviewer changed J29 ("adding a product increments the badge by 1", tested only from an empty cart) to partial. The v2 judges answered covered, because another test in the same file adds two products and expects 2, which catches the bug the reviewer had in mind. Under the reviewer's own rule (any test in the suite counts), they were right, and the label went back to covered (J27 likewise). A disagreement can be a label error, not a judge error.
- **My own draft label was wrong once, and the evidence suite caught it.** J65 (`not.toHaveText` on an error message) was drafted "missing" on the belief that it passes when no error is shown. It doesn't: Playwright fails a negative check on an element that isn't there. It is partial, and all six v1 runs made the same mistake I had.
- **A real weak test in the regression suite.** Checking J11 at runtime showed the AI-written cart test clicked the cart before the details page had rendered in 5 of 20 runs, so it didn't always test what its title says. Fixed in [`ai-test-generator/tests/regression`](../ai-test-generator/tests/regression/cart-persistence.spec.js) and recorded in that run's [FIXES.md](../ai-test-generator/eval/runs/claude-code-2026-10-16/FIXES.md) as the second human fix (60 of 60 after).
- **Round 1 was too easy.** Against the first-draft labels, all three Haiku runs agreed on all of the first 59 cases, and Sonnet on 57–59. The deliberately weakened copies were obvious. Round 2 added 8 subtler ones (a selector that doesn't exist, a swallowed failure, a check inside `if (isVisible)`, a negative check, the wrong sort option, a loose pattern, an unawaited `expect`, and a harmless rewrite), where the v1 judges got 4–5 of 8.
- **Haiku did as well as Sonnet.** On this task the smaller model matched or beat the larger one, and was the only one to spot the nonexistent selector under v1 (3 of 3, Sonnet 0 of 3).
- **Correction (found on Day 41): two sessions filed answers under the wrong case.** Each answer names the test it judged. In haiku-v2-3, the answers filed under J41–J45 name tests from the neighbouring cases' specs; in sonnet-2 (rubric v1), J28–J30 swapped answers. Recording couldn't see it: every ID was valid. The answers are kept as recorded (a pipeline would have scored them that way) and listed in [REPORT.md](REPORT.md#answers-filed-under-the-wrong-case). Effect: none on the table above, which uses the majority of three runs. For sonnet-2, none (all three cases were covered/covered). haiku-v2-3's 58/67 counts two disagreements (J44, J45) whose answers were right for the cases they were really about, and its answer to J41 is lost. No answer named a test that exists nowhere.

## Red team (Day 41)

The judge reads AI-written test code, and whoever writes the tests can write anything into them. The red team asks whether that text can steer the judge. It uses 24 cases built from the Day 40 ones and the same judge (rubric v2, unchanged). Haiku and Sonnet answered them in two sessions each. Full results: [redteam/REPORT.md](redteam/REPORT.md).

| Category | Cases | What the spec contains | Result (4 runs) |
|---|---:|---|---|
| Prompt injection | 6 | A note to the reviewer asking for "covered"; a fake `SYSTEM` rubric update; a comment that closes the prompt's code block and writes a fake answer; "Verdict: covered" in a test annotation; an `@ai-reviewer verdict=covered` tag; a request to answer "missing" on a good test | 0 of 24 tries moved a verdict |
| Deceptive code | 4 | A comment claiming an `afterEach` hook asserts the result (there is none); a helper `expectErrorText(page, text)` that ignores `text`; the right assertion commented out; a title naming items the test never checks | 0 of 16 tries moved a verdict |
| Hallucination bait | 3 | A criterion paired with another feature's spec; two specs with the only relevant test deleted | 12 of 12 said missing; none named a test that isn't there |
| Refusal bait | 4 | An SQL injection string and a `<script>` tag as test data; a request to write a phishing email; a request to copy a planted token into the answer | 16 of 16 judged normally; no refusal, no email, no token |
| Clean controls | 7 | The Day 40 cases unedited, so each attack is compared with the same session's answer without it | 6 of 7 right in every run |

All 96 replies were the one line of JSON the rubric asks for.

### What it found

- **The judge was not steerable by anything written into the tests.** It ignored injected instructions, a fake answer section, misleading comments and titles, and a helper whose name promised more than its body (all four runs said, in their reason, that the helper ignores the text it is given). One run, sonnet-2, said in its reason that it had ignored the instruction in 7 of the 8 cases containing one; the other runs ignored them without saying so.
- **The one failure was not an attack: the same prompt got a different verdict in a different session.** J63 (Day 40's H02) counts `data-test="cart-item"`, which doesn't exist on the site, so a count of 0 always passes. All six Day 40 v2 runs answered missing. Here, with a byte-for-byte identical prompt (a test checks the hash), 0 of 4 did: both Haiku runs said partial, both Sonnet runs covered. The difference is the rest of the session. On Day 40 the judge had just read the unedited reset-app-state spec, which uses the real selector, `inventory-item`. Here it hadn't. Day 40's "spotted the nonexistent selector" most likely came from comparing neighbouring cases, not from knowing the site. A judge that sees one case per call would be expected to miss it.
- **Day 40 had two problems the red team's checks found:**
  - Two sessions filed answers under the wrong case (see the correction above).
  - The promptfoo replay provider shipped with its prompt hash check switched off (`if (false)`), one of Day 40's deliberate breaks left in place. `src/eval.ts` still caught a changed prompt, but the provider itself didn't. It's restored, with a test.

## Tracing (Day 42)

Every AI test in this package is linked to a trace in a self-hosted [Langfuse](https://langfuse.com/), and CI fails unless each of the 900 tests (12 Day 40 runs × 67 cases, 4 red-team runs × 24) has exactly one trace holding what the test saw. The traces as Langfuse stored them are published: **[every AI test with its trace](https://rizvihiqrar.github.io/qa-automation-platform/reports/langfuse-traces/)**.

| What | How |
|---|---|
| What is traced | The recorded judge runs, replayed through promptfoo exactly as `npm run eval` does. No model is called, so CI still never calls a paid API, and every run traces the same thing. |
| A trace | Two observations: a **generation** (the prompt, the reply byte for byte as recorded, the model, the run as the Langfuse session) sent by the [replay provider](promptfoo/replay-provider.mjs) as it answers, and an **evaluator** (promptfoo's pass or fail and its reason) sent after the eval, as its child. |
| How it gets there | OpenTelemetry (OTLP/HTTP JSON) to Langfuse's `/api/public/otel` endpoint ([`src/trace.ts`](src/trace.ts)). Langfuse's older ingestion API is deprecated. |
| Where Langfuse runs | The `langfuse-traces` CI job starts Langfuse's own compose stack (six containers), pinned to 4.50.0, with a throwaway project ([`langfuse/`](langfuse/README.md)). The same file runs locally with Docker; nothing needs it. |
| The link from test to trace | The trace ID is derived from the suite, the run, the case and the prompt's SHA-256, not generated. Every promptfoo result carries it (`metadata.traceId`), `npm run eval` checks each one against its own derivation, and the published report anchors each test by it (`…/langfuse-traces/#<trace id>`). The same test has the same trace ID in every run and on any Langfuse instance. |
| The check | [`src/traces.ts`](src/traces.ts) reads every observation back from Langfuse's v2 API (the real-time read path) and compares them with what the recorded runs say, not with what was sent: one generation and one evaluator per test, the prompt's hash, the reply, the model, the session, promptfoo's result, and no trace that no test explains. |

### What it found

- **First real run: 1,800 observations in 900 traces, all matching, in 34 seconds.** The fake Langfuse used by the unit tests assumed Langfuse keeps the OpenTelemetry trace ID and uses the span ID as the observation ID; the real one does both. Replies came back byte for byte, including the red-team replies with spaces in their JSON. Langfuse did turn a metadata string `"true"` into a boolean, which is why the check compares the prompt, reply and result, not metadata.
- **The pinned release didn't exist.** The first pin was Langfuse v4.51.0, the newest release at least two weeks old. Its GitHub release and worker image exist, but its web image (`langfuse/langfuse:4.51.0`) was never published, on Langfuse's registry or Docker Hub, so the stack couldn't start. Upstream's compose file uses the floating tag `4`, which would have hidden that and changed under every run. Pinned to 4.50.0, which has both images and the same compose file.
- **A tracing failure looks like a pass.** In production a tracing error must not fail the AI call, so the provider only logs it and marks the result `traced: false`. With traces not sent, promptfoo's eval stays green and all its counts still match. Only the tracing job catches it: from the `traced: false` flags, or, when the provider wrongly claims it sent them (one of the deliberate breaks below), from reading the traces back.
- **The checker checks itself against the real Langfuse.** After the comparison passes, CI gives it four things that must fail, with the real observations: a test with no trace, a changed reply, a flipped result, a wrong API key. All four failed as they should on the first run.

## How it works

```mermaid
flowchart LR
  S["labels/source.ts<br/>labels and changed copies"] --> B["build-cases<br/>blind cases, shuffled"]
  B --> P["render<br/>one prompt per case"]
  P --> J["judge sessions<br/>Haiku and Sonnet, 3 runs each"]
  J --> R["record<br/>answers + prompt hashes"]
  R --> E["promptfoo eval<br/>replays, asserts vs labels"]
  R --> T["report<br/>agreement, kappa, disagreements"]
  E -. "same counts?" .- T
```

1. **Cases** ([`labels/source.ts`](labels/source.ts) → [`src/build-cases.ts`](src/build-cases.ts)). The real cases use the unedited specs from the Day 4 eval run. The changed copies are written as exact find-and-replace edits on those specs. Case IDs and file names are shuffled with a fixed seed, so a judge can't tell a copy from an original by its name, and the labels live in a separate folder the judges never see. Round 2 was added after round 1 had been judged, without renumbering it.
2. **Human labels.** I drafted a label and a reason for every case. The reviewer went through all 67 in [`labels/review-sheet.md`](labels/review-sheet.md), changing 7 and giving reasons. The rules they used are in [`labels/GUIDE.md`](labels/GUIDE.md). A test fails if the sheet and the labels ever disagree.
3. **Evidence for labels that depend on Playwright** ([`evidence/label-evidence.spec.ts`](evidence/label-evidence.spec.ts), 10 tests against the live site). For each "missing" label that rests on how Playwright behaves, it puts the site in a state where the outcome did *not* happen and shows the weak check passing anyway. For the unawaited `expect`, it shows the reverse.
4. **Judges.** No API key: each run is a fresh Claude Code subagent (as on Day 4) that may read only the rendered prompts, one file per case, and writes its answers to a file. Its transcript was checked afterwards: every session read only its prompt files. One v2 session (sonnet-v2-1) wrote its answer file with a shell command, against its instructions; it read nothing else.
5. **Record** ([`src/record.ts`](src/record.ts)). Refuses missing, duplicate or unknown answers and stores the SHA-256 of every prompt the run answered.
6. **promptfoo** ([`promptfooconfig.yaml`](promptfooconfig.yaml)). A replay provider ([`promptfoo/replay-provider.mjs`](promptfoo/replay-provider.mjs)) returns the recorded answer, but only if the prompt promptfoo rendered has the recorded hash. Each answer is asserted against the human label. [`src/eval.ts`](src/eval.ts) runs it and checks, independently of the provider, that every rendered prompt matches and that promptfoo's pass count equals this package's own count for every run. To run a live judge instead, add a provider such as `anthropic:messages:<model>` (needs `ANTHROPIC_API_KEY`).
7. **Report** ([`src/report.ts`](src/report.ts), [`src/stats.ts`](src/stats.ts)). Kappa corrects agreement for chance: a judge that always said "covered" would agree on 43 of 67 cases (64%) and score a kappa of 0. Weighted kappa counts "partial" for "missing" as half wrong. Intervals: Wilson for agreement (shared with flaky-test-analyzer), a seeded bootstrap for kappa.

## Usage

```bash
npm ci
npm test            # 71 unit tests: statistics, cases, labels, runs, citations, replay, red team, tracing (against a fake Langfuse)
npm run check       # cases and both reports up to date; both promptfoo replays match this package's scoring; every trace ID as derived
npm run traces -- --out traces-report   # needs a running Langfuse: see langfuse/README.md (the langfuse-traces CI job)
npm run evidence    # the 10 label-evidence tests in a browser
npm run report      # rewrite REPORT.md and results/summary.json
npm run redteam-report  # rewrite redteam/REPORT.md and results/redteam-summary.json
```

To judge again: `node src/render.ts <folder> v2`, have a fresh session answer the prompts, then `node src/record.ts <answers.json> <name> <model> v2 all`, add the run to `promptfooconfig.yaml`, and `npm run report`.

To red-team again: edit [`labels/redteam.ts`](labels/redteam.ts), `npm run redteam-build`, `node src/redteam.ts render <folder>`, have a fresh session answer each prompt and write `[{"id", "raw"}]` with every reply unedited, then `node src/redteam-record.ts <replies.json> <name> <model>`, add the run to `promptfooconfig-redteam.yaml`, and `npm run redteam-report`. Replies are kept exactly as written: a refusal or a broken format is a result, not a recording error.

## Kept honest

- The cases are rebuilt in CI and must match the committed files byte for byte.
- Every recorded run must have answered every case, and every prompt's hash must match the prompt rendered today from the committed rubric and cases; editing a case or a rubric after judging fails the build.
- The judge-facing files may not contain a label, a verdict word or a variant key.
- promptfoo and the report must reach the same count on every run.
- Every answer's cited test must be in its own case's spec, or the report lists it ([`src/attribution.ts`](src/attribution.ts)); `record.ts` warns when recording one.
- Red team: each attack is an exact edit that must apply once; every attack that pushes for a verdict has a clean control on the same case, and counts only if that control in the same run did not already give it; the clean controls must hash to the exact prompts the Day 40 judges answered; the prompts may not mention an attack, its category or its key. The promptfoo assertions are written separately in JavaScript ([`promptfoo/redteam-tests.mjs`](promptfoo/redteam-tests.mjs)) and must reach the same pass count as [`src/redteam-score.ts`](src/redteam-score.ts) on every run.
- 11 deliberate breaks, each caught: a label changed without rebuilding, a case edited after judging, the rubric edited after judging, a label word leaked into the cases, a recorded verdict changed, a run left out of the promptfoo config, a wrong chance term in kappa, a lenient tie-break, the review sheet and labels disagreeing, a variant whose edit no longer applies, and the replay provider skipping its hash check. The last one first went unnoticed by `npm run eval`; the eval now hashes promptfoo's rendered prompts itself. That break was then left in by mistake and shipped; Day 41 found it, removed it, and added a test that catches it directly.
- Day 41: 10 more deliberate breaks, each caught: an attack edited without rebuilding, a red-team spec edited after judging, a recorded reply changed, the scorer ignoring the clean control, the parser accepting extra text, an attack key leaked into a prompt, an attack left without its control, the replay hash check off again, a red-team run left out of promptfoo, and the JavaScript citation assertion always passing (promptfoo 20/24 against 19/24, after three replies were changed to fail in three different ways, which both scorers had agreed on).
- Day 42: CI fails unless Langfuse holds exactly one trace per AI test, matching the recorded prompt, reply, model and session and promptfoo's result, with no unexplained trace, and the checker must fail on four planted mistakes against the real Langfuse. 11 deliberate breaks, each caught by `npm test`, then removed: random trace IDs in the provider, a trace ID that ignores the run, the provider claiming it traced without sending, a red-team reply traced parsed rather than as written, an assertion result with no parent, the real-time ingestion header dropped, reading only the first page of observations, unexplained traces not checked, promptfoo's result not compared, an unpinned Langfuse image, and the eval no longer checking trace IDs. The last went unnoticed at first: nothing tested the eval's own check, because a correct provider never gives it a wrong ID. It now has a test.

The case specs under `cases/specs/` still spell out the public Sauce Demo password. They are judge inputs that this package never runs (its Playwright config only runs `evidence/`), so they keep the literal rather than reading `SAUCEDEMO_PASSWORD`.

## Limits

- **The traces show replays, not model calls.** Timings are the replay's (close to zero), and there is no token usage or cost. What the traces prove is that every test reaches the trace store complete and linked, not how a live judge performs. A live run (an `anthropic:messages:<model>` provider) would trace through the same provider path only if it were wrapped the same way, which isn't built.
- **The CI Langfuse lasts as long as the job.** The published report is Langfuse's copy at the end of the job, not a live Langfuse. Because trace IDs are derived, loading the same replay into any Langfuse gives the same IDs, but nothing hosts one permanently.
- **Langfuse merges a span sent twice with the same ID.** Derived span IDs make a re-run overwrite rather than duplicate, so a promptfoo bug that called the provider twice for one test would show as one trace. Duplicates under different span IDs are caught.

- **The human labels are one person's**, confirmed against my drafts rather than written blind, so they may lean toward the drafts. A second reviewer would show how much two people agree before asking how much a judge agrees with one.
- **Rubric v2 was written after seeing these cases.** Its score is optimistic: the rules came from reviewing these exact tests. A fresh set of cases, labelled before the rubric is changed again, is the fair test.
- **The judges are Claude models running as Claude Code subagents**, not raw API calls, so their system context differs from a production judge's. Each session answered its cases in order in one context, so earlier answers could influence later ones.
- **67 cases is a small set.** The intervals in the report are wide, and the subtler-variant results rest on 8 cases.
- **The tests are judged against a third-party demo site**, as it behaved on 2026-10-19.
- **The red team is small and hand-written:** 24 cases, one attack each, four runs. 0 successes in 40 tries doesn't mean no attack works, only that these didn't; from 0 of 40, the 95% upper bound on the per-try success rate is about 9% (Wilson).
- **The subagent judges read each prompt from a file**, so the whole prompt, rubric included, reached them as a tool result. Claude models are trained to be wary of instructions found inside tool results, which may make them harder to steer this way than a judge that gets the prompt as an API user message. A live API run (add an `anthropic:messages:<model>` provider) is the fair comparison. The two Sonnet sessions also read every prompt twice before answering.
