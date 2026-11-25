"""For both suites (tests and tests_faults): every test names the test plan requirements it checks.

    @pytest.mark.req("MR-01", "MR-02")

The run stops before any test starts when a test has no req marker or names an ID that is not
in docs/test-plan.md, so the traceability matrix can't miss a test. Each ID is written into the
JUnit XML as a property of its test case, which is all the matrix needs (hcm_conv/trace.py).
`--req-map FILE` also writes {test node ID: [requirement IDs]} for every collected test.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from hcm_conv import trace


def pytest_addoption(parser):
    parser.addoption("--req-map", type=Path, help="write the requirements of every collected test to this JSON file")


def pytest_configure(config):
    config.addinivalue_line("markers", "req(*ids): the docs/test-plan.md requirements this test checks")


def requirements_of(item) -> list[str]:
    return list(dict.fromkeys(i for m in item.iter_markers("req") for i in m.args))


def pytest_collection_modifyitems(session, config, items):
    known = {r.id for r in trace.load_plan()}
    problems = []
    for item in items:
        ids = requirements_of(item)
        if not ids:
            problems.append(f"{item.nodeid}: no @pytest.mark.req(...) marker")
        problems += [f"{item.nodeid}: {i} is not a requirement in docs/test-plan.md" for i in ids if i not in known]
        item.user_properties.extend(("req", i) for i in ids)
    if problems:
        raise pytest.UsageError("Every test must name its test plan requirements:\n  " + "\n  ".join(problems))
    out = config.getoption("--req-map")
    if out:
        out.write_text(json.dumps({item.nodeid: requirements_of(item) for item in items}, indent=1), encoding="utf-8")
