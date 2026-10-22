"""Shared setup for the pytest suite against qa-practice-api.

One command works on a laptop and in CI: a session fixture starts the API on a free
port, signs in as the seeded admin once, and stops the server at the end. Set BASE_URL
to test an API that is already running (it must have the admin account below).
"""
import itertools
import os
import socket
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import pytest
import requests

API_DIR = Path(__file__).resolve().parents[1] / "qa-practice-api"

# Throwaway accounts for a local test server, the same ones the Playwright suite uses.
ADMIN_EMAIL = "admin@qa-practice.test"
ADMIN_PASSWORD = os.environ.get("QA_PRACTICE_ADMIN_PASSWORD", "Admin-only-in-tests-1!")
PASSWORD = os.environ.get("QA_PRACTICE_PASSWORD", "Pass123!")

# requests waits forever by default, so every call gets a timeout: a hung server
# should fail one test, not stall the job until CI gives up.
TIMEOUT_SECONDS = 10


class Api:
    """requests with a base URL and a timeout on every call."""

    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session = requests.Session()

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", TIMEOUT_SECONDS)
        return self.session.request(method, self.base_url + path, **kwargs)

    def get(self, path: str, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs):
        return self.request("POST", path, **kwargs)

    def patch(self, path: str, **kwargs):
        return self.request("PATCH", path, **kwargs)


@dataclass
class Account:
    id: int
    email: str
    headers: dict


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_until_up(base_url: str, server: subprocess.Popen) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError(f"the API exited with code {server.returncode} before it was ready")
        try:
            if requests.get(base_url + "/products", timeout=2).status_code == 200:
                return
        except requests.ConnectionError:
            pass
        time.sleep(0.2)
    raise RuntimeError("the API was not ready after 30 seconds")


@pytest.fixture(scope="session")
def base_url():
    if os.environ.get("BASE_URL"):
        yield os.environ["BASE_URL"].rstrip("/")
        return
    port = _free_port()
    env = {
        **os.environ,
        "NODE_ENV": "test",
        "PORT": str(port),
        "ADMIN_EMAIL": ADMIN_EMAIL,
        "ADMIN_PASSWORD": ADMIN_PASSWORD,
    }
    server = subprocess.Popen(
        ["node", "src/server.ts"], cwd=API_DIR, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        _wait_until_up(url, server)
        yield url
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


@pytest.fixture(scope="session")
def api(base_url) -> Api:
    return Api(base_url)


@pytest.fixture(scope="session")
def admin(api) -> Account:
    # Signed in once: sign-in is rate limited per email, so each test signing in
    # as the admin would trip the limit.
    res = api.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert res.status_code == 200, f"admin sign-in failed: {res.status_code} {res.text}"
    body = res.json()
    return Account(body["user"]["id"], ADMIN_EMAIL, {"Authorization": f"Bearer {body['token']}"})


_counter = itertools.count()


@pytest.fixture
def sign_up(api):
    """Registers a new customer account and returns it."""
    def make() -> Account:
        email = f"pytest.{os.getpid()}.{time.time_ns()}.{next(_counter)}@example.com"
        res = api.post("/auth/register", json={"name": "Pytest Tester", "email": email, "password": PASSWORD})
        assert res.status_code == 201, f"sign-up failed: {res.status_code} {res.text}"
        body = res.json()
        return Account(body["user"]["id"], email, {"Authorization": f"Bearer {body['token']}"})
    return make


@pytest.fixture
def make_product(api, admin):
    """Creates a product as the admin (only admins change the catalogue)."""
    def make(**fields) -> dict:
        data = {"name": "Pytest Widget", "category": "pytest", "price": 10, "stock": 10, **fields}
        res = api.post("/products", headers=admin.headers, json=data)
        assert res.status_code == 201, f"product setup failed: {res.status_code} {res.text}"
        return res.json()
    return make


@pytest.fixture
def stock_of(api):
    def read(product_id: int) -> int:
        return api.get(f"/products/{product_id}").json()["stock"]
    return read
