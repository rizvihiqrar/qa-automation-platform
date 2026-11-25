"""The loader's retrying client, against a fake line (no network, no Docker)."""
import re
from pathlib import Path

import httpx2
import pytest

from hcm_conv import client as client_module
from hcm_conv.client import LoadError, Retry, RetryingClient

ROOT = Path(__file__).resolve().parents[1]


def line(*outcomes):
    """A fake line: each request takes the next outcome (an exception to raise, or a status)."""
    seen = []

    def handle(request):
        seen.append(f"{request.method} {request.url.path}")
        outcome = outcomes[min(len(seen), len(outcomes)) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return httpx2.Response(outcome, json={"ok": True})
    return httpx2.MockTransport(handle), seen


def make(transport, **kwargs):
    return RetryingClient("http://hcm.test", backoff=0, transport=transport, **kwargs)


@pytest.mark.req("LD-01")
def test_a_read_that_fails_twice_succeeds_on_the_third_try():
    transport, seen = line(httpx2.ConnectError("refused"), httpx2.ReadTimeout("slow"), 200)
    with make(transport) as c:
        assert c.get("/workers").status_code == 200
    assert seen == ["GET /workers"] * 3
    assert c.retries == [Retry("GET /workers", 1, "ConnectError"), Retry("GET /workers", 2, "ReadTimeout")]


@pytest.mark.req("LD-01")
def test_three_failures_raise_a_load_error_that_names_the_call_and_each_error():
    transport, seen = line(httpx2.ReadTimeout("slow"))
    with make(transport) as c, pytest.raises(LoadError) as error:
        c.get("/reports/workers")
    assert len(seen) == 3
    assert str(error.value) == ("GET /reports/workers failed after 3 tries: "
                                "try 1: ReadTimeout (slow); try 2: ReadTimeout (slow); try 3: ReadTimeout (slow)")


@pytest.mark.parametrize("path", ["/bulk-loads", "/tenant/reset"])
@pytest.mark.req("LD-02")
def test_the_bulk_load_and_the_reset_are_retried_because_sending_them_twice_is_safe(path):
    transport, seen = line(httpx2.RemoteProtocolError("reply cut"), 201)
    with make(transport) as c:
        assert c.post(path, data={"mode": "load"}).status_code == 201
    assert len(seen) == 2


@pytest.mark.req("LD-02")
def test_any_other_post_fails_at_the_first_error():
    transport, seen = line(httpx2.ReadError("reset"), 201)
    with make(transport) as c, pytest.raises(LoadError, match=r"POST /workers failed after 1 try: try 1: ReadError \(reset\)$"):
        c.post("/workers", json={})
    assert len(seen) == 1 and not c.retries


@pytest.mark.parametrize("path", ["/bulk-loads/", "/bulk-loads?note=1", "/tenant/reset/"])
@pytest.mark.req("LD-02")
def test_a_safe_call_keeps_its_retries_with_a_trailing_slash_or_a_query(path):
    transport, seen = line(httpx2.ReadError("reset"), 201)
    with make(transport) as c:
        assert c.post(path).status_code == 201
    assert len(seen) == 2


@pytest.mark.req("LD-02")
def test_an_error_that_would_fail_again_is_raised_at_once():
    transport, seen = line(httpx2.UnsupportedProtocol("no scheme"), 200)
    with make(transport) as c, pytest.raises(httpx2.UnsupportedProtocol):
        c.get("/workers")
    assert len(seen) == 1 and not c.retries


@pytest.mark.req("LD-02")
def test_an_error_status_is_an_answer_and_is_never_retried():
    transport, seen = line(500, 200)
    with make(transport) as c:
        assert c.get("/workers").status_code == 500
    assert len(seen) == 1 and not c.retries


@pytest.mark.req("LD-01")
def test_the_backoff_doubles_before_each_try(monkeypatch):
    waits = []
    monkeypatch.setattr(client_module.time, "sleep", waits.append)
    transport, _ = line(httpx2.ConnectError("refused"))
    with RetryingClient("http://hcm.test", backoff=0.2, tries=4, transport=transport) as c, pytest.raises(LoadError):
        c.get("/workers")
    assert waits == [0.2, 0.4, 0.8]


@pytest.mark.req("LD-03")
def test_the_hooks_see_every_try_and_every_retry():
    transport, _ = line(httpx2.ConnectError("refused"), 200)
    tries, retries = [], []
    with make(transport, before=lambda m, p, d: tries.append((m, p, d)), on_retry=retries.append) as c:
        c.post("/bulk-loads", data={"mode": "load"})
    assert tries == [("POST", "/bulk-loads", {"mode": "load"})] * 2
    assert retries == [Retry("POST /bulk-loads", 1, "ConnectError")]


@pytest.mark.req("FS-01")
def test_ci_pulls_the_same_toxiproxy_image_the_fault_tests_start():
    from tests_faults.toxiproxy import TOXIPROXY_IMAGE
    ci = (ROOT.parents[1] / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    job = ci[ci.index("  hcm-conversion-validation-faults:"):]
    job = job[:job.index("\n  # ", 1)] if "\n  # " in job[1:] else job
    assert re.search(rf"docker pull --quiet {re.escape(TOXIPROXY_IMAGE)}\n", job)
    assert "pytest tests_faults" in job
    # Ryuk would be one more image pulled with no retry (code review, 2026-11-24)
    assert "TESTCONTAINERS_RYUK_DISABLED: 'true'" in job
