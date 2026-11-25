"""The traceability matrix: test plan requirement -> the tests that check it -> their latest result.

The requirements come from docs/test-plan.md, where each one has an ID (MR-01). Each test names
the requirements it checks with a marker, @pytest.mark.req("MR-01"); conftest.py refuses a test
with no marker or an ID the plan does not have, and writes the IDs into the JUnit XML as
properties. So the matrix is built from the JUnit files alone:

    python -m hcm_conv trace --junit reports/junit.xml --junit reports/junit-faults.xml --out reports
    python -m hcm_conv trace --md docs/traceability.md     # no --junit: the tests only, no results

A requirement is passing only when it has tests and every one of them passed.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .report import BOLD, table, widen

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs" / "test-plan.md"
REQ_ID = re.compile(r"^[A-Z]{2}-\d{2}$")
STATUSES = ("failing", "no tests", "incomplete", "passing")   # worst first
STATUS_FILL = {"passing": "D9EAD3", "failing": "F4CCCC", "no tests": "F4CCCC", "incomplete": "FFF2CC"}


@dataclass(frozen=True)
class Requirement:
    id: str
    group: str
    text: str
    check: str | None   # the rule or check name the code reports, when there is one


def cells(line: str) -> list[str]:
    """A Markdown table row's cells; an escaped pipe (\\|) stays inside its cell."""
    inner = line.strip().removeprefix("|").removesuffix("|")
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", inner)]


def load_plan(path: Path = PLAN) -> list[Requirement]:
    """Every requirement row under "## Requirements", in plan order."""
    out: list[Requirement] = []
    section = group = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            section, group = line[3:].strip(), None
        elif line.startswith("### "):
            group = line[4:].strip()
        elif section == "Requirements" and line.startswith("|"):
            row = cells(line)
            if not REQ_ID.match(row[0]):
                continue
            if group is None or len(row) != 3:
                raise ValueError(f"{path.name}: requirement row {row[0]} needs a ### group and 3 columns")
            check = re.findall(r"`([^`]+)`", row[2])
            out.append(Requirement(row[0], group, row[1], check[0] if check else None))
    ids = [r.id for r in out]
    twice = sorted({i for i in ids if ids.count(i) > 1})
    if twice:
        raise ValueError(f"{path.name}: requirement IDs used twice: {', '.join(twice)}")
    if not out:
        raise ValueError(f"{path.name}: no requirements found under ## Requirements")
    return out


def requirement_for(check: str, path: Path = PLAN) -> str:
    """The ID of the requirement whose rule or check is this name (for tests built from data)."""
    found = [r.id for r in load_plan(path) if r.check == check]
    if len(found) != 1:
        raise KeyError(f"{len(found)} requirements name {check!r} in {path.name}")
    return found[0]


@dataclass(frozen=True)
class TestResult:
    file: str          # tests/test_convert.py
    name: str          # test_each_transform[spec0-  Tremblay -expected0]
    outcome: str       # passed, failed or skipped
    requirements: tuple[str, ...]

    @property
    def label(self) -> str:
        return f"{Path(self.file).stem}: {self.name}"


def read_junit(paths: list[Path]) -> list[TestResult]:
    out = []
    for path in paths:
        for case in ET.parse(path).getroot().iter("testcase"):
            if case.find("failure") is not None or case.find("error") is not None:
                outcome = "failed"
            elif case.find("skipped") is not None:
                outcome = "skipped"
            else:
                outcome = "passed"
            reqs = tuple(p.get("value") for p in case.iter("property") if p.get("name") == "req")
            # tests.test_x.TestRetries: the module is the lower-case part, the class goes with the name
            parts = case.get("classname", "").split(".")
            split = next((i for i, part in enumerate(parts) if part[:1].isupper()), len(parts))
            name = "::".join(parts[split:] + [case.get("name", "")])
            out.append(TestResult("/".join(parts[:split]) + ".py", name, outcome, reqs))
    return out


@dataclass
class Row:
    requirement: Requirement
    tests: list[TestResult]

    @property
    def status(self) -> str:
        outcomes = {t.outcome for t in self.tests}
        if not self.tests:
            return "no tests"
        if "failed" in outcomes:
            return "failing"
        if outcomes != {"passed"}:
            return "incomplete"
        return "passing"

    def count(self, outcome: str) -> int:
        return sum(t.outcome == outcome for t in self.tests)


@dataclass
class Matrix:
    rows: list[Row]
    untraced: list[TestResult] = field(default_factory=list)            # a result with no requirement
    unknown: list[tuple[TestResult, str]] = field(default_factory=list)  # a requirement not in the plan
    sources: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(r.status == "passing" for r in self.rows) and not self.untraced and not self.unknown

    def by_status(self) -> dict[str, int]:
        return {s: sum(r.status == s for r in self.rows) for s in STATUSES}

    def summary(self) -> str:
        counts = self.by_status()
        text = f"{len(self.rows)} requirements: " + ", ".join(f"{n} {s}" for s, n in counts.items() if n)
        tests = len({(t.file, t.name) for r in self.rows for t in r.tests} | {(t.file, t.name) for t in self.untraced})
        text += f"; {tests} test results"
        if self.untraced:
            text += f"; {len(self.untraced)} with no requirement"
        if self.unknown:
            text += f"; {len(self.unknown)} naming a requirement the plan does not have"
        return text


def build(requirements: list[Requirement], results: list[TestResult], sources: list[str] = ()) -> Matrix:
    known = {r.id for r in requirements}
    matrix = Matrix([Row(r, []) for r in requirements], sources=list(sources))
    rows = {row.requirement.id: row for row in matrix.rows}
    for t in results:
        if not t.requirements:
            matrix.untraced.append(t)
        for req in dict.fromkeys(t.requirements):
            if req in known:
                rows[req].tests.append(t)
            else:
                matrix.unknown.append((t, req))
    return matrix


def to_markdown(m: Matrix, results: bool = True) -> str:
    """With results: each requirement's latest result (the CI report). Without: the committed
    docs/traceability.md, the requirements and their tests only, which a test keeps current."""
    if results:
        intro = ("Each requirement of the [test plan](../docs/test-plan.md), the tests that name it with a `req` "
                 "marker, and their latest result, from " + " and ".join(f"`{s}`" for s in m.sources) + ".")
        summary = m.summary()
    else:
        intro = ("Each requirement of the [test plan](../docs/test-plan.md) and the tests that name it with a `req` "
                 "marker, from a collect-only run of both suites (`python -m hcm_conv trace --md docs/traceability.md`). "
                 "A test fails when this file is not what the suites collect. Results are not kept here: CI builds "
                 "the same matrix with each test's latest result and keeps it as a report "
                 "(`reports/traceability.md` and `.xlsx`).")
        tests = {(t.file, t.name) for r in m.rows for t in r.tests} | {(t.file, t.name) for t in m.untraced}
        summary = f"{len(m.rows)} requirements, {len(tests)} tests"
    lines = ["# Traceability matrix: HR and payroll conversion", "",
             "[← Back to overview](../README.md) · [Test plan](../docs/test-plan.md)", "", intro, "",
             f"**{summary}.**", ""]
    header = "| ID | Requirement | Rule or check | Tests |" + (" Result |" if results else "")
    group = None
    for row in m.rows:
        r = row.requirement
        if r.group != group:
            group = r.group
            lines += ["", f"## {group}", "", header, "|---" * header.count(" |") + "|"]
        check = f"`{r.check}`" if r.check else ""
        tests = "<br>".join(t.label.replace("|", "\\|") + ("" if t.outcome == "passed" or not results else f" ({t.outcome})")
                            for t in row.tests) or "none"
        text = r.text.replace("|", "\\|")
        line = f"| {r.id} | {text} | {check} | {tests} |"
        if results:
            line += f" {row.status} ({row.count('passed')} of {len(row.tests)}) |" if row.tests else f" {row.status} |"
        lines.append(line)
    if m.untraced or m.unknown:
        lines += ["", "## Problems", ""]
        lines += [f"- {t.label}: no requirement" for t in m.untraced]
        lines += [f"- {t.label}: names {req}, which is not in the plan" for t, req in m.unknown]
    return "\n".join(lines).replace("\n\n\n", "\n\n") + "\n"


def collect(out_file: Path) -> list[TestResult]:
    """Both suites, collected but not run (no Docker needed): one TestResult per test, outcome "collected"."""
    done = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider",
                           "-o", "addopts=", "tests", "tests_faults", "--req-map", str(out_file)],
                          cwd=ROOT, capture_output=True, text=True,
                          env={k: v for k, v in os.environ.items() if k != "PYTEST_ADDOPTS"})   # -k would shrink it
    if done.returncode != 0:
        raise RuntimeError("collecting the suites failed:\n" + done.stdout[-2000:] + done.stderr[-2000:])
    found = json.loads(out_file.read_text(encoding="utf-8"))
    return [TestResult(node.split("::", 1)[0], node.split("::", 1)[1], "collected", tuple(reqs)) for node, reqs in found.items()]


def write_workbook(m: Matrix, path: Path) -> Path:
    book = Workbook()
    ws = book.active
    ws.title = "Summary"
    ws.append(["Traceability matrix: HR and payroll conversion (fake data; not affiliated with any HR vendor)"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([m.summary()])
    ws.append([f"Built from {', '.join(m.sources)}"])
    ws.append([])
    table(ws, ["Result", "Requirements"], [[s, n] for s, n in m.by_status().items()])
    widen(ws)
    ws.column_dimensions["A"].width = 24

    mx = book.create_sheet("Matrix")
    table(mx, ["ID", "Group", "Requirement", "Rule or check", "Tests", "Passed", "Failed", "Skipped", "Result", "Test names"],
          [[row.requirement.id, row.requirement.group, row.requirement.text, row.requirement.check or "",
            len(row.tests), row.count("passed"), row.count("failed"), row.count("skipped"), row.status,
            "\n".join(t.label for t in row.tests)] for row in m.rows])
    for cells_ in mx.iter_rows(min_row=2):
        cells_[8].fill = PatternFill("solid", fgColor=STATUS_FILL[cells_[8].value])
    mx.freeze_panes = "B2"
    mx.auto_filter.ref = mx.dimensions
    widen(mx)
    mx.column_dimensions["J"].width = 60

    ts = book.create_sheet("Tests")
    everything = {(t.file, t.name): t for row in m.rows for t in row.tests}
    everything.update({(t.file, t.name): t for t in m.untraced})
    everything.update({(t.file, t.name): t for t, _ in m.unknown})
    table(ts, ["File", "Test", "Outcome", "Requirements"],
          [[t.file, t.name, t.outcome, ", ".join(t.requirements) or "NONE"] for t in everything.values()])
    ts.freeze_panes = "A2"
    ts.auto_filter.ref = ts.dimensions
    widen(ts)
    for c in ts[1]:
        c.font = BOLD
    path.parent.mkdir(parents=True, exist_ok=True)
    book.save(path)
    return path
