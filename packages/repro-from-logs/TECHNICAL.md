[← Back to overview](README.md)

# repro-from-logs: technical guide

1. [How a case runs](#how-a-case-runs)
2. [The log format](#the-log-format)
3. [The cases file](#the-cases-file)
4. [When a replay counts as the same failure](#when-a-replay-counts-as-the-same-failure)
5. [Checking a fix](#checking-a-fix)
6. [CI integration](#ci-integration)
7. [Tests](#tests)
8. [FAQ](#faq)
9. [Troubleshooting](#troubleshooting)
10. [Development](#development)

## How a case runs

| Step | What happens | Code |
|---|---|---|
| 1 | Read the log; skip lines that are not requests; sort by time | [`repro/logs.py`](repro/logs.py) |
| 2 | Start the API build the log came from (once per set of feature flags) and sign in as the admin | [`repro/server.py`](repro/server.py) |
| 3 | Set up what the customer's system already had: products, accounts, discount codes | `World.build` in [`repro/replay.py`](repro/replay.py) |
| 4 | For a fix check: apply the fix (a different build, or steps run as the admin) | `World.apply_steps` |
| 5 | Replay every logged request as the same kind of user | `replay` |
| 6 | Compare each answer with the logged one | `matches` |

`send` (method, path, token, body) is the only thing that touches the network, so the matching rules are tested against a fake API in [`tests/test_replay.py`](tests/test_replay.py) with no server.

### Names that cannot clash

Logs name things the replay must create (an email, a discount code, a product ID). Each replay maps them to names nobody used before: the email `pat@example.com` becomes `pat.<run>@example.com`, the code `WELCOME5` becomes `WELCOME5-<run>` (cut to fit the 20 characters a code may have), and a logged product ID becomes the ID the server gave the new product. Paths and bodies are rewritten with the same map, so `/discounts/WELCOME5` and `"product_id": 3` still point at the right things. Because of this, the same server can run every case in any order.

Each distinct `user` in a log is a separate customer account, created the first time that user appears. `admin` uses the admin token and `anonymous` sends no token.

## The log format

One JSON object per line:

| Field | Needed | Meaning |
|---|---|---|
| `time` | yes | When the request happened. Replays go in time order; equal times keep the file order |
| `method`, `path` | yes | The request |
| `status` | yes | The answer's status, a number |
| `user` | no | Who made it. Default `anonymous` |
| `body` | no | The JSON body. Passwords are `[masked]`, as a real log would have them |
| `error` | no | The `error` text of the answer |

```json
{"time": "2026-11-17T14:02:11Z", "method": "POST", "path": "/orders", "user": "sam", "body": {"items": [{"product_id": 3, "quantity": 5}]}, "status": 400, "error": "Insufficient stock for product 3 (available: 2)"}
```

Lines that are not requests are skipped and listed with their line number and reason: not JSON (a start-up message, a line cut off when the file was copied), not an object, a missing field, or a status that is not a number. Blank lines are ignored without a mention.

## The cases file

[`cases/cases.json`](cases/cases.json) is a list. Each case:

| Key | Needed | What it is |
|---|---|---|
| `id`, `title` | yes | `RFL-01` and a short name |
| `report` | yes | What the customer said, in their words |
| `log` | yes | The log file, under `cases/` |
| `expect` | yes | `reproduces` or `does-not-reproduce` |
| `why` | yes | The cause, or why it does not reproduce |
| `flags` | no | `FEATURE_FLAGS` of the build the log came from (default none) |
| `setup` | no | `products` (with the `logged_id` the log uses), `accounts`, `discounts` |
| `fix` | no | `flags` for a different build, `steps` run as the admin before the replay, or both |

| Case | Failure | Reproduces | Fix |
|---|---|---|---|
| RFL-01 | 400, not enough stock | yes (by design) | none |
| RFL-02 | 400, discount codes switched off | yes | build with `discount-codes:on` |
| RFL-03 | 429 after five wrong sign-ins | yes (by design) | none |
| RFL-04 | 422, code reached its usage limit | yes | `PATCH /discounts/<code>` raises `max_uses` |
| RFL-05 | 409, email already in use | yes (by design) | none |
| RFL-06 | 500 on sign-up | no: the cause is in the server's own log | none |

## When a replay counts as the same failure

[`matches`](repro/replay.py) is true when the status is equal and, if the log kept an error, the error text is equal after every number is replaced by `N`. The words must still match: `Product 3 not found` and `Order 3 not found` are different failures. A log line with no `error` is compared on status alone.

Every request in the log is compared, not just the failed one, so a case whose set-up steps behave differently (a sign-up that now fails) is not called a reproduction. The report lists every mismatch with its log line.

A log with no failed request raises an error: there is nothing to reproduce. `python -m repro` reports that case as CANNOT RUN, counts it as a problem and carries on with the rest.

Times are compared as points in time (`14:02:11Z`, `14:02:11.500Z` and `09:02:11-05:00` sort the way they happened). A password a log masks is replayed as the account's real password when the request succeeded in the log, and left masked (so wrong) when it was refused.

## Checking a fix

With the fix applied the question changes. The case is verified when every request that failed in the log now returns a status below 400 and every request that worked still does. The report names each one that does not.

- A build fix (`flags`) starts a second API with those flags and replays against it
- A data fix (`steps`) runs after the set-up and before the replay, as the admin. A step that is refused raises an error naming the step

Example from RFL-04: the code was set to one use in total, so a second customer was refused. The fix raises `max_uses` to 100, and both orders succeed on the replay.

## CI integration

The `repro-from-logs` job in [ci.yml](../../.github/workflows/ci.yml) installs the API's dependencies, audits the Python dependencies with `pip-audit`, runs `pytest`, then runs `python -m repro` so the printed result is in the job log. Reports go to `reports/` and are uploaded like every other package's.

```yaml
- run: npm ci --prefix ../qa-practice-api
- run: pip install -r requirements.txt pip-audit
- run: pip-audit -r requirements.txt
- run: pytest
- run: python -m repro
```

`python -m repro` exits with 1 when a case does something other than its `expect` says, or a fix is not verified.

## Tests

48 tests, no retries.

| File | Tests | Needs the API |
|---|---|---|
| [`test_logs.py`](tests/test_logs.py) | Reading a log: fields, skipped lines with numbers, time order, number-free error text | no |
| [`test_replay.py`](tests/test_replay.py) | The matching rules, user accounts, name mapping and the fix check, against a fake API | no |
| [`test_cases.py`](tests/test_cases.py) | Each real case does what it says; the log set reproduces five of six; both fixes are verified; one case that cannot be replayed is reported and the rest still run | yes |
| [`test_breaks.py`](tests/test_breaks.py) | Deliberate breaks: the flag case on the wrong build, a fix that changes nothing, a data fix that does nothing, a log with changed error words or status, and the 500 that cannot be rebuilt | yes |

### Breaks put back by hand

| Put back | Result |
|---|---|
| Error text not compared | 3 failed |
| Numbers kept in the error text | 4 failed |
| Log not sorted by time | 1 failed |
| Status not compared | 3 failed |
| Fix check always passes | 3 failed |
| Fix steps skipped | 2 failed |
| Same email every run | 8 failed |
| Email mapped from the first name only | 2 failed |
| Log times compared as text | 2 failed |
| Fix check ignores a request that used to work | 2 failed |
| Masked password never replaced | 2 failed |
| One case that cannot run stops the whole run | 1 failed |

Each was restored and the suite passed again.

## FAQ

### Why only status and error words, not the whole response?
A log keeps the status and the error. Matching on more than the log holds would make every case fail for reasons the customer never saw.

### Why is one case marked `does-not-reproduce`?
A tool that can only say "reproduced" proves nothing. RFL-06 is a 500 whose cause (a database error) is not in a request log. The honest answer is "not reproduced, get the server log".

### Can it replay against a server that is already running?
Yes. Set `BASE_URL`. Every case then runs on that server, whatever its `flags`, so a flag case will not reproduce there.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `could not create the account for 'sam'` | The API refused the sign-up | Run the API's own tests; check the password rule in the API |
| `setup: discount ... was refused` | A discount field in `cases.json` does not pass the API's rules | Compare it with `POST /discounts` in qa-practice-api |
| A case says NOT reproduced after an API change | The error wording or status changed | Compare the line named in the report, then update the log or the API on purpose |
| `the API was not ready after 30 seconds` | Node dependencies are missing | `npm ci --prefix ../qa-practice-api` |

## Development

```bash
cd packages/repro-from-logs
python -m venv .venv
.venv/bin/pip install -r requirements.txt
npm ci --prefix ../qa-practice-api
.venv/bin/python -m pytest      # 48 tests
.venv/bin/python -m repro       # replay the log set
```
