# log-signature-grouper

Reads application logs, turns each error message into a **pattern** by replacing the parts that change (IDs, numbers, emails, IP addresses, timestamps), and counts how often each pattern happens. Compare today's log with yesterday's to see which errors are new, which grew, and which went away.

**In plain English:** a log can have hundreds of errors that are really the same problem with a different order number each time. Grouping them shows the five problems worth looking at, and the comparison shows what started after the last release.

---

## Example

```
$ npm run demo

13 entries, 11 at FATAL/ERROR/WARN, 5 pattern(s)

    5  ERROR Timeout calling bank API after <num>ms for order <uuid>  [payments]
    3  ERROR TypeError: Cannot read properties of undefined (reading <str>)  [checkout]
    1  ERROR User not found: <email>  [users]
    1  WARN  Bank API slow: responded in <num>ms for order <uuid>  [payments]
    1  WARN  Connection pool <num>% full (<num>/<num>)  [db]

New since baseline: 1
    3  ERROR TypeError: Cannot read properties of undefined (reading <str>)  [checkout]

At least doubled since baseline: 1
    5 (was 2)  ERROR Timeout calling bank API after <num>ms for order <uuid>  [payments]

Gone since baseline: 1
```

The new `TypeError` appeared in both plain-text and JSON log lines and is still counted as one pattern of 3. Its stack-trace lines stay attached to the error instead of being counted as separate entries.

With `--baseline`, the command exits with code 1 when a **new ERROR or FATAL pattern** appears, so it can fail a post-deploy check.

---

## What Gets Replaced

| Part | Becomes | Example |
|---|---|---|
| Timestamps | `<ts>` | `2026-10-16T08:00:00Z` |
| UUIDs | `<uuid>` | `8f2a91c4-5b1e-4c3a-9e2d-7a6b0c1d2e3f` |
| Emails | `<email>` | `ana.silva@example.com` |
| IP addresses, with port | `<ip>` | `10.0.4.17:5432` |
| Quoted text | `<str>` | `'total'` |
| Long hex IDs | `<hex>` | `a1b2c3d4e5f6` |
| Numbers | `<num>` | `3000` in `3000ms` |

---

## Log Formats

- Plain: `2026-10-16T08:01:12.300Z ERROR [payments] message`, with the `[service]` optional
- JSON lines: `{"time": "...", "level": "error", "service": "checkout", "msg": "..."}` (`message`, `severity`, `timestamp` also work)
- Anything else: the level is found anywhere in the line, or marked `UNKNOWN`
- Indented and `at ...` lines are treated as stack trace and attached to the line above

---

## Usage

```bash
node src/cli.js app.log                             # top patterns at FATAL/ERROR/WARN
node src/cli.js app.log --levels ERROR --top 5
node src/cli.js today.log --baseline yesterday.log  # new, grown and gone patterns
node src/cli.js app.log --format md                 # Markdown table
```

"Grown" means at least doubled **and** up by at least 3, so small day-to-day noise isn't flagged.

---

## Tests

```bash
npm test   # 15 tests, no dependencies
```

Removing the email rule made 4 tests fail, which confirms the tests check each replacement.

**Limit:** quoted-text replacement can over-match a message with an apostrophe in a word (`can't`). Real logs usually quote values, not prose, but it's worth knowing.
