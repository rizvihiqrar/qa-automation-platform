# Short name of the bug

| | |
|---|---|
| **Where** | Package and file |
| **Found by** | The test, tool or person that noticed, and when |
| **Impact** | What a user or the business would have seen |
| **Fixed in** | Commit or pull request |

## Symptom

What was observed, with the real numbers or output. Not the cause yet.

## How it was found

The steps from "this looks wrong" to the cause, including dead ends.

## Root cause

The line or design decision that caused it, with the code. Why it wasn't caught earlier.

## Fix

What changed and why that change, and anything rejected.

## Regression tests

One line per test, in this form, so `scripts/rca.test.mjs` can check the test still exists:

- [`packages/<package>/<test file>`](../../packages/<package>/<test file>) › `exact test title, or exact text the file must contain`

Then say what happened when the bug was put back.

## Prevention

What changes about how the work is done, so this kind of bug is caught earlier. Include what is still not covered.
