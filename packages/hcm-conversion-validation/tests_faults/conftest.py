"""The fault tests need Docker: the mock API runs on a real port, and Toxiproxy runs in a container
in front of it. The loader talks to the API only through Toxiproxy.

    .venv/bin/python -m pytest tests_faults       # Docker must be running

The container reaches the API on the host through host.docker.internal (Docker Desktop has it;
on Linux, extra_hosts maps it to the host gateway). The API listens on all interfaces for that,
on a free port, for the length of the run only: on Windows the first run may ask to let Python
through the firewall, and the fake tenant can be reached from the local network while it runs.
"""
from __future__ import annotations

import socket
import threading
import time

import httpx2
import pytest
import uvicorn
from testcontainers.core.container import DockerContainer

from hcm_conv.mock_api import create_app

from .toxiproxy import CONTROL_PORT, LINE_PORT, TOXIPROXY_IMAGE, Line


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def wait_for(url: str, seconds: float = 30, alive=lambda: True) -> None:
    end = time.monotonic() + seconds
    while True:
        try:
            httpx2.get(url, timeout=2).raise_for_status()
            return
        except httpx2.HTTPError:
            if not alive():
                raise RuntimeError(f"the server for {url} stopped before it answered (port taken?)")
            if time.monotonic() > end:
                raise
            time.sleep(0.2)


@pytest.fixture(scope="session")
def api():
    """The mock API on a real port. The test can read its tenant directly (same process)."""
    app = create_app()
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    wait_for(f"http://127.0.0.1:{port}/workers", alive=thread.is_alive)
    yield app, port
    server.should_exit = True
    thread.join(timeout=10)


@pytest.fixture(scope="session")
def line(api):
    _, port = api
    container = (DockerContainer(TOXIPROXY_IMAGE)
                 .with_exposed_ports(CONTROL_PORT, LINE_PORT)
                 .with_kwargs(extra_hosts={"host.docker.internal": "host-gateway"}))
    with container:
        host = container.get_container_host_ip()
        control = f"http://{host}:{container.get_exposed_port(CONTROL_PORT)}"
        wait_for(f"{control}/version")
        toxiproxy = Line(control)
        toxiproxy.create(f"host.docker.internal:{port}")
        url = f"http://{host}:{container.get_exposed_port(LINE_PORT)}"
        wait_for(f"{url}/workers")   # the whole path works before any test starts
        yield toxiproxy, url
        toxiproxy.close()


@pytest.fixture
def clean_line(line):
    toxiproxy, url = line
    toxiproxy.clear()
    yield toxiproxy, url
    toxiproxy.clear()
