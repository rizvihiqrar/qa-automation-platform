"""Start qa-practice-api builds for a replay, one per set of feature flags.

A case says which build its log came from (for example discount codes switched off), so
the replay has to run against that build. A pool starts each build once, signs in as the
admin once, and stops them all at the end. Set BASE_URL to replay against a server that is
already running (then every case runs against it, whatever its flags).
"""
import os
import socket
import subprocess
import time
import warnings
from pathlib import Path

import requests

API_DIR = Path(__file__).resolve().parents[2] / "qa-practice-api"
ADMIN_EMAIL = "admin@qa-practice.test"
ADMIN_PASSWORD = os.environ.get("QA_PRACTICE_ADMIN_PASSWORD", "Admin-only-in-tests-1!")
TIMEOUT_SECONDS = 10  # requests waits forever by default: a hung server must fail one call


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


class Build:
    """One running API: how to send it a request, and the admin's token."""

    def __init__(self, base_url: str):
        self.base_url = base_url
        res = requests.post(base_url + "/auth/login", timeout=TIMEOUT_SECONDS,
                            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        if res.status_code != 200:
            raise RuntimeError(f"admin sign-in failed: {res.status_code} {res.text}")
        self.admin_token = res.json()["token"]

    def send(self, method: str, path: str, token, body):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        res = requests.request(method, self.base_url + path, headers=headers,
                               json=body if body is not None else None, timeout=TIMEOUT_SECONDS)
        try:
            payload = res.json()
        except ValueError:
            payload = None
        return res.status_code, payload


class Pool:
    def __init__(self):
        self._servers = {}   # flags -> (process or None, Build)

    def build(self, flags: str = "") -> Build:
        if os.environ.get("BASE_URL"):
            if flags:
                warnings.warn(f"BASE_URL is set, so the flags {flags!r} are ignored: this case runs on whatever that server has", stacklevel=2)
            flags = ""  # one server for everything
        if flags not in self._servers:
            self._servers[flags] = self._start(flags)
        return self._servers[flags][1]

    def _start(self, flags: str):
        if os.environ.get("BASE_URL"):
            return None, Build(os.environ["BASE_URL"].rstrip("/"))
        port = _free_port()
        env = {**os.environ, "NODE_ENV": "test", "PORT": str(port), "ADMIN_EMAIL": ADMIN_EMAIL,
               "ADMIN_PASSWORD": ADMIN_PASSWORD, "FEATURE_FLAGS": flags}
        server = subprocess.Popen(["node", "src/server.ts"], cwd=API_DIR, env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f"http://127.0.0.1:{port}"
        try:
            _wait_until_up(url, server)
            return server, Build(url)
        except BaseException:
            server.kill()
            raise

    def close(self) -> None:
        for server, _ in self._servers.values():
            if server is None:
                continue
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        self._servers.clear()
