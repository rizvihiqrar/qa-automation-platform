"""Toxiproxy between the loader and the mock API: a line whose faults the tests switch on and off.

Toxiproxy (https://github.com/Shopify/toxiproxy) is a TCP proxy with a control API. Each fault
is a "toxic" on the line, in one direction: upstream (loader to API) or downstream (API to
loader). The same pinned image as qa-practice-api (scripts/with-postgres.ts), checked against
the CI pull step by tests/test_client.py.
"""
from __future__ import annotations

import time

import httpx2

TOXIPROXY_IMAGE = "ghcr.io/shopify/toxiproxy:2.12.0"
CONTROL_PORT = 8474
LINE_PORT = 8666


class Line:
    def __init__(self, control_url: str, name: str = "hcm-api"):
        self.http = httpx2.Client(base_url=control_url, timeout=10)
        self.name = name
        self.active: set[str] = set()

    def create(self, upstream: str) -> None:
        self.http.post("/reset").raise_for_status()
        self.http.delete(f"/proxies/{self.name}")   # 404 when there is none yet
        self.http.post("/proxies", json={"name": self.name, "listen": f"0.0.0.0:{LINE_PORT}",
                                         "upstream": upstream, "enabled": True}).raise_for_status()

    def add(self, toxic: str, kind: str, stream: str, **attributes) -> None:
        self.http.post(f"/proxies/{self.name}/toxics", json={
            "name": toxic, "type": kind, "stream": stream, "toxicity": 1.0, "attributes": attributes,
        }).raise_for_status()
        self.active.add(toxic)

    def remove(self, toxic: str, tries: int = 5) -> None:
        """Toxiproxy answers 503 when it can't change a line while data is queued in a toxic
        (a latency toxic holding a large reply, found 2026-11-24). Try a few times, then say so."""
        if toxic not in self.active:
            return
        for attempt in range(1, tries + 1):
            response = self.http.delete(f"/proxies/{self.name}/toxics/{toxic}")
            if response.status_code != 503:
                response.raise_for_status()
                self.active.discard(toxic)
                return
            time.sleep(0.5 * attempt)
        raise RuntimeError(f"Toxiproxy kept answering 503 to removing '{toxic}': data is still queued in it. "
                           "Aim a latency fault at a call with a small reply.")

    def close(self) -> None:
        self.http.close()

    def clear(self) -> None:
        for toxic in list(self.active):
            self.remove(toxic)
