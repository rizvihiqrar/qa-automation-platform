"""Integration faults: mock cycle 3 loads through a bad line, and must still end reconciled.

Each test switches one fault on just before one chosen call, and off when the loader retries
it, so each run has exactly one retry, on the call it was aimed at. Then the whole cycle must
pass every check with no open exception: nothing lost, nothing loaded twice.

  slow reply      latency 3 s, against a 1.5 s timeout            on a load's error report
                  (a small reply: Toxiproxy can't remove a latency toxic that holds a large one)
  reset mid-load  the connection reset as the upload arrives      on the bulk load
  silent line     nothing gets through, nobody hangs up           on a report read
  lost reply      the API saves the load, the reply is cut        on the bulk load
"""
from __future__ import annotations

import time

import pytest

from hcm_conv import cycles
from hcm_conv.client import LoadError, Retry, RetryingClient


def loads(app) -> list[tuple[str, str]]:
    """Every bulk load the API has taken since the last reset: (mode, status)."""
    return [(load["mode"], load["status"]) for load in app.state.tenant.loads.values()]


def cycle_through(line_url, toxiproxy, fault, aimed_at):
    """Run cycle 3 through the line, with the fault switched on before the first matching call."""
    armed = {"done": False}

    def before(method, path, data):
        if not armed["done"] and aimed_at(method, path, data or {}):
            armed["done"] = True
            fault()

    with RetryingClient(line_url, timeout=1.5, backoff=0.1, before=before,
                        on_retry=lambda r: toxiproxy.clear()) as client:
        cycle = cycles.run(client, (3,))[0]
    assert armed["done"], "the fault was never switched on"
    return cycle, client.retries


def passed(cycle):
    return cycle.passed and not cycle.errors("Open")


def is_load(method, path, data):
    return method == "POST" and path == "/bulk-loads" and data.get("mode") == "load"


@pytest.mark.req("FS-01")
def test_the_line_works_with_no_fault(api, clean_line):
    app, _ = api
    toxiproxy, url = clean_line
    with RetryingClient(url, timeout=5) as client:
        cycle = cycles.run(client, (3,))[0]
    assert passed(cycle) and not client.retries
    # validate_only once, load once, and the reconciliation's own rerun of the same file
    assert loads(app) == [("validate_only", "Completed"), ("load", "Completed"), ("load", "Completed")]


@pytest.mark.req("FS-02")
def test_a_slow_reply_times_out_and_the_retry_reads_it_again(api, clean_line):
    toxiproxy, url = clean_line
    cycle, retries = cycle_through(url, toxiproxy,
                                   lambda: toxiproxy.add("slow", "latency", "downstream", latency=3000),
                                   lambda m, p, d: m == "GET" and p.endswith("/errors"))
    assert passed(cycle)
    # the error report of the first load of the cycle (validate_only)
    assert retries == [Retry("GET /bulk-loads/BL-0001/errors", 1, "ReadTimeout")]


@pytest.mark.req("FS-03")
def test_a_reset_in_the_middle_of_the_upload_is_sent_again_and_loads_once(api, clean_line):
    app, _ = api
    toxiproxy, url = clean_line
    cycle, retries = cycle_through(url, toxiproxy,
                                   lambda: toxiproxy.add("reset", "reset_peer", "upstream", timeout=0),
                                   is_load)
    assert passed(cycle)
    assert [(r.call, r.attempt) for r in retries] == [("POST /bulk-loads", 1)]
    # The reset came before the API had the whole file: it never saw the first try
    assert loads(app) == [("validate_only", "Completed"), ("load", "Completed"), ("load", "Completed")]


@pytest.mark.req("FS-04")
def test_a_silent_line_ends_in_a_timeout_not_a_hang(api, clean_line):
    toxiproxy, url = clean_line
    started = time.monotonic()
    cycle, retries = cycle_through(url, toxiproxy,
                                   lambda: toxiproxy.add("silent", "timeout", "upstream", timeout=0),
                                   lambda m, p, d: m == "GET" and p == "/reports/pay_results")
    assert passed(cycle)
    assert retries == [Retry("GET /reports/pay_results", 1, "ReadTimeout")]
    assert time.monotonic() - started < 30


@pytest.mark.req("FS-05")
def test_a_reply_lost_after_the_save_is_loaded_again_with_no_duplicates(api, clean_line):
    app, _ = api
    toxiproxy, url = clean_line
    cycle, retries = cycle_through(url, toxiproxy,
                                   lambda: toxiproxy.add("lost", "limit_data", "downstream", bytes=1),
                                   is_load)
    assert [(r.call, r.attempt) for r in retries] == [("POST /bulk-loads", 1)]
    # The API did the work on the first try; only its reply was lost. So the file was loaded
    # three times in all, and the counts, hash totals, row hashes and rerun still all pass.
    assert loads(app) == [("validate_only", "Completed")] + [("load", "Completed")] * 3
    assert passed(cycle)
    names = [c.name for c in cycle.reconciliation.checks]
    assert "Row counts balance" in names and "Rerun adds and changes nothing" in names


@pytest.mark.req("FS-06")
def test_a_fault_that_never_clears_fails_loudly_after_three_tries(clean_line):
    toxiproxy, url = clean_line
    toxiproxy.add("silent", "timeout", "upstream", timeout=0)
    started = time.monotonic()
    with RetryingClient(url, timeout=1.0, backoff=0.1) as client, pytest.raises(LoadError) as error:
        client.get("/reports/workers")
    assert [e.split(" (")[0] for e in error.value.errors] == ["try 1: ReadTimeout", "try 2: ReadTimeout", "try 3: ReadTimeout"]
    assert time.monotonic() - started < 3 * 1.0 + 0.3 + 2
