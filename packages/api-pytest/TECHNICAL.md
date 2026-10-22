# api-pytest: technical guide

[← Back to overview](README.md)

**Contents:** [Features](#features) · [Configuration](#configuration) · [CI integration](#ci-integration) · [Results](#results) · [FAQ](#faq) · [Troubleshooting](#troubleshooting) · [Development](#development)

## Features

### The 40 cases and where they come from

Each case keeps its ID from the [test plan](../../docs/test-strategy/test-plan.md). The Playwright versions are in [qa-practice-api/tests/design](../qa-practice-api/tests/design).

| File | Technique | IDs | Cases |
|---|---|---|---:|
| [test_equivalence.py](tests/test_equivalence.py) | Equivalence partitioning | TC-EP-01 to TC-EP-20 | 20 |
| [test_boundaries.py](tests/test_boundaries.py) | Boundary values (price, stock, quantity, summed lines) | TC-BVA-01 to TC-BVA-12 | 12 |
| [test_orders_and_states.py](tests/test_orders_and_states.py) | Decision table for `POST /orders` | TC-DT-09 to TC-DT-12 | 4 |
| [test_orders_and_states.py](tests/test_orders_and_states.py) | State transitions of an order | TC-ST-01, 02, 05, 08 | 4 |

Left out on purpose: the other 45 designed cases (the access-control matrix, the sign-in rate limit, pagination boundaries, the rest of the status moves). Those stay in Playwright, so this suite is a second opinion on the core rules and not a copy of everything.

### One command, no hand-started server

[conftest.py](conftest.py) has three session fixtures.

```python
@pytest.fixture(scope="session")
def base_url():
    port = _free_port()
    server = subprocess.Popen(["node", "src/server.ts"], cwd=API_DIR, env={...})
    _wait_until_up(url, server)      # polls GET /products, fails if the server exits first
    yield url
    server.terminate()
```

- `base_url` starts the API on a free port with the admin account seeded, waits until it answers, and stops it at the end. Set `BASE_URL` to skip this and use a running API.
- `api` is `requests` with a base URL and a 10-second timeout on every call. `requests` has no timeout by default, so without one a hung server stalls the whole job until CI gives up.
- `admin` signs in once for the session. Sign-in is rate limited per email, so each test signing in as the admin would trip the limit.

Function fixtures `sign_up`, `make_product` and `stock_of` make each test's data, with a unique email each time, so tests don't depend on each other or on order.

### Case IDs in the test names

`pytest.param(..., id="TC-BVA-01 price -0.01")` puts the ID in the report, so a failure names the case in the test plan, and the JUnit file carries it too.

```text
FAILED tests/test_boundaries.py::test_price_is_at_least_zero[TC-BVA-01 price -0.01]
```

### Malformed JSON

`requests.post(json=...)` always sends valid JSON. TC-EP-17 needs a broken body, so it sends raw bytes (`data=b'{"name": "Widget",'`) with the JSON content type, and checks that the answer is a JSON `400` and not an HTML error page.

## Configuration

| Setting | Default | What it does |
|---|---|---|
| `BASE_URL` | not set | Test this API instead of starting one. It must have the admin account below |
| `QA_PRACTICE_ADMIN_PASSWORD` | a throwaway test-only value | The seeded admin's password, on a server this suite starts |
| `QA_PRACTICE_PASSWORD` | a throwaway test-only value | The password of the customer accounts the tests register |
| `pytest.ini` | `--junitxml=reports/junit.xml` | Writes JUnit XML; `--strict-markers` makes a mistyped marker an error |

## CI integration

The `api-pytest` job in [ci.yml](../../.github/workflows/ci.yml) sets up Node 24 (the API) and Python 3.12, installs both sets of dependencies, audits the Python ones, runs pytest and keeps `reports/` for 7 days.

```yaml
- uses: actions/setup-python@v5
  with: { python-version: '3.12', cache: pip, cache-dependency-path: packages/api-pytest/requirements.txt }
- run: npm ci --prefix ../qa-practice-api
- run: pip install -r requirements.txt pip-audit
- run: pip-audit -r requirements.txt
- run: pytest
```

The dashboard lists the job by name like every other job, so its pass rate and flaky count appear with the rest. It does not read the JUnit file: the dashboard reads CI job results from the Actions API, and the JUnit XML is kept as a downloadable report.

## Results

Each of these bugs was put back into the API, one at a time, and the suite run:

| Put back | Failed |
|---|---|
| `price < 0` check removed | TC-BVA-01 (1 of 40) |
| Order lines for one product not added together | TC-BVA-11, TC-BVA-12 (2 of 40) |
| The order lifecycle check turned off | TC-ST-01 (1 of 40) |

Stability: 10 runs in a row passed, then 3 more after the dependency bump, no retries, 40 of 40 each time (1.6 to 2.1 seconds a run).

**The first dependency audit failed.** `pip-audit` reported advisories in `pytest 8.3.5` and `requests 2.32.3`, the versions first chosen. They are now `pytest 9.0.3` and `requests 2.33.0`, and the audit is a CI step, so a new advisory fails the job.

## FAQ

### Why a second suite for the same API?

Same design, different language and runner. It shows that the case design does not depend on a tool, and that two independent implementations agree about the API. It also covers a common job requirement.

### Why not run the Python tests with the Playwright suite?

Each runs in its own CI job, so a failure in one does not hide the other, and the Python job needs no browser.

### Why pytest and requests?

They are the usual pair for API tests in Python: plain functions, fixtures and parametrization, and a small HTTP client.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `the API exited with code 1 before it was ready` | `qa-practice-api` dependencies not installed, or Node older than 24 | `npm ci --prefix ../qa-practice-api`, and check `node --version` |
| `the API was not ready after 30 seconds` | The server is very slow to start | Start it yourself and set `BASE_URL` |
| `admin sign-in failed` with `BASE_URL` | That server wasn't seeded with the admin account | Start it with `ADMIN_EMAIL` and `ADMIN_PASSWORD` as in [conftest.py](conftest.py) |
| `python` not found on Windows | The Microsoft Store shortcut is first on the path | Install Python 3.12 and use `.venv\Scripts\python` |

## Development

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt pip-audit
.venv/bin/python -m pytest                  # 40 cases
.venv/bin/python -m pip_audit -r requirements.txt
```
