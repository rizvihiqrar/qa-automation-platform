# Windows line endings rejected every SQL check

| | |
|---|---|
| **Where** | [sql-data-integrity](../../packages/sql-data-integrity), the check-file parser |
| **Found by** | Running the tests on Windows while moving the package to TypeScript (Day 21) |
| **Impact** | On Windows the tool refused to start: every one of the 15 check files was rejected. CI, on Linux, had been green since Day 5 |
| **Fixed in** | Commit `37fee2d` (Day 21) |

## Symptom

On a Windows checkout the tool stopped at the first check file (files load in name order) with:

```
Check 01-orphan-order-items.sql needs id, severity and description headers
```

The headers were plainly there in the file. The same commit passed all 33 tests in CI.

## How it was found

The CI job runs on `ubuntu-latest`, so the package had never been run on Windows. Moving it to TypeScript was the first time its tests ran on a Windows machine. An error that is wrong on every file at once, on one OS only, points at something about how files are stored rather than at any one check, and the line endings were the obvious difference.

## Root cause

Git on Windows (`core.autocrlf=true`, the installer default) checks text files out with CRLF line endings. Each check file starts with header lines like `-- id: orphan_order_items`. The parser split on `\n` only, so every line kept a trailing `\r`:

```js
// before
for (const line of text.split('\n')) {
  const m = line.match(/^--\s*(id|severity|description):\s*(.+)$/);
```

`.` doesn't match `\r`, and without the `m` flag `$` only matches at the very end of the string, so `(.+)$` could not match `orphan_order_items\r`. No header line matched, and the file was rejected as missing all three.

**Why it wasn't caught earlier:** CI runs on Linux only, and every test fixture was written with `\n`. A whole class of input (files edited or checked out on Windows) had no test.

## Fix

Split on `\r?\n`, so the header lines never carry the `\r`:

```ts
for (const line of text.split(/\r?\n/)) {
```

Rejected: a `.gitattributes` rule forcing LF. It fixes this repo's checkout but not a user's own check files saved by a Windows editor, which is the real case for a tool that loads `.sql` files from disk.

## Regression tests

- [`packages/sql-data-integrity/test/cli.test.ts`](../../packages/sql-data-integrity/test/cli.test.ts) › `parseCheck reads files with Windows line endings`

The test builds the CRLF input explicitly (`'-- id: a\r\n-- severity: error\r\n...'`), so it fails on any OS, including the Linux CI runner. Put back on Day 31: splitting on `\n` only failed 6 tests on Windows (the CRLF test plus every CLI test that loads the real check files), and the CRLF test alone fails on Linux.

## Prevention

- **Test the input formats users will have, not only the ones in the repo.** Text parsers now get a CRLF case.
- **Make OS-specific input explicit in the test,** so a Linux-only CI still covers it.
- **Not covered:** CI still runs only on Linux. A Windows job in the matrix would catch the next difference (path separators, case-insensitive file names) without anyone thinking of it first. Left out for now because only this package reads files users edit, and the explicit test covers it.
