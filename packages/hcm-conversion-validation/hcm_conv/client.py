"""The loader's HTTP client: a timeout on every call, and a retry when the line fails.

A conversion load crosses a network, and a network has bad moments: a reply arrives late,
the connection is reset in the middle of an upload, the line goes quiet with no reply and
no hang-up, or the reply is lost after the server has already done the work. This client:

  - gives every call a timeout, so a silent line ends in a timeout instead of a hang
  - tries a call up to 3 times, with a short backoff, when the request never got an answer
    (a connect error, a reset, a timeout, a cut reply). An answer with an error status is an
    answer: it is raised at once, never retried
  - retries only calls that are safe to send twice: every read (GET), the bulk load (rows
    update by key, so the same file again adds and changes nothing) and the tenant reset.
    Any other call fails at the first error
  - records each retry (call, attempt, error), so a run log shows what the line did

When the last try fails, LoadError says which call failed and every error on the way.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx2

# No answer because of the line: connect, read and write errors, timeouts, a cut reply. Errors
# that would fail the same way again (a URL with no scheme, a bad proxy, a malformed request) are
# raised at once.
RETRYABLE = (httpx2.ConnectError, httpx2.ReadError, httpx2.WriteError, httpx2.RemoteProtocolError,
             httpx2.TimeoutException)
SAFE_POSTS = {"/bulk-loads", "/tenant/reset"}


class LoadError(RuntimeError):
    def __init__(self, call: str, errors: list[str]):
        tries = f"{len(errors)} {'try' if len(errors) == 1 else 'tries'}"
        super().__init__(f"{call} failed after {tries}: " + "; ".join(errors))
        self.call = call
        self.errors = errors


@dataclass
class Retry:
    call: str
    attempt: int
    error: str


@dataclass
class RetryingClient:
    base_url: str
    timeout: float = 5.0
    tries: int = 3
    backoff: float = 0.2                 # seconds before try 2; doubled before each later try
    on_retry: object = None              # called with each Retry before the next try (tests use it)
    before: object = None                # called with (method, path, data) before each try
    transport: object = None             # an httpx2 transport (tests use a MockTransport)
    retries: list[Retry] = field(default_factory=list)

    def __post_init__(self):
        self._http = httpx2.Client(base_url=self.base_url, timeout=self.timeout, transport=self.transport)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self._http.close()

    def safe_to_repeat(self, method: str, path: str) -> bool:
        bare = httpx2.URL(path).path.rstrip("/") or "/"   # no query string, no trailing slash
        return method == "GET" or (method == "POST" and bare in SAFE_POSTS)

    def request(self, method: str, path: str, **kwargs) -> httpx2.Response:
        call = f"{method} {path}"
        tries = self.tries if self.safe_to_repeat(method, path) else 1
        errors: list[str] = []
        for attempt in range(1, tries + 1):
            if self.before:
                self.before(method, path, kwargs.get("data"))
            try:
                return self._http.request(method, path, **kwargs)
            except RETRYABLE as e:
                errors.append(f"try {attempt}: {type(e).__name__}" + (f" ({e})" if str(e) else ""))
                if attempt == tries:
                    break
                retry = Retry(call, attempt, type(e).__name__)
                self.retries.append(retry)
                if self.on_retry:
                    self.on_retry(retry)
                time.sleep(self.backoff * 2 ** (attempt - 1))
        raise LoadError(call, errors)

    def get(self, path: str, **kwargs) -> httpx2.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> httpx2.Response:
        return self.request("POST", path, **kwargs)
