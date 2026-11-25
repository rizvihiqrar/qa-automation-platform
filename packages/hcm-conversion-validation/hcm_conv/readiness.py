"""The go or no-go readiness report: the test plan's exit criteria, checked against the evidence.

    python -m hcm_conv readiness --junit reports/junit.xml --junit reports/junit-faults.xml

Every criterion must hold; there is no tolerance (docs/test-plan.md, Exit criteria). The evidence
is worked out again, not read from earlier reports: the cycles are run, the payroll parallel is
paid again, a masked copy is made and checked, and the test results come from the JUnit files
(through the traceability matrix). The result is also written as JSON in release-gate's check
shape ({name, kind, passed, detail}), so a release gate could read it as it is.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .cycles import Cycle, accepted_for
from .defects import Defect, checkpoint, counts
from .extract import FIXES_DIR
from .parallel import Run
from .trace import Matrix

CRITERIA = (
    "No open exception, and every accepted one signed off",
    "Every reconciliation check passes",
    "The payroll parallel explains every difference",
    "Every masking check passes",
    "Every fault scenario passes",
    "Every requirement has tests, and all of them passed",
    "Every logged defect is closed or accepted",
)


@dataclass
class Criterion:
    name: str
    passed: bool
    detail: str


@dataclass
class Readiness:
    point: str
    criteria: list[Criterion]
    sign_offs: list[str] = field(default_factory=list)

    @property
    def decision(self) -> str:
        return "GO" if all(c.passed for c in self.criteria) else "NO-GO"

    def as_checks(self) -> dict:
        """release-gate's result shape: one check per criterion."""
        return {"decision": self.decision.lower(), "checkpoint": self.point,
                "checks": [{"name": c.name, "kind": "check", "passed": c.passed, "detail": c.detail} for c in self.criteria]}


def failing(checks) -> str:
    bad = [c.name for c in checks if not c.passed]
    return f"{len(checks) - len(bad)} of {len(checks)} pass" + (f"; failing: {', '.join(bad)}" if bad else "")


PARALLEL_CYCLE = 3   # gather() pays the parallel from this cycle's load


def decide(cycles: list[Cycle], runs: list[Run], mask_checks: list, matrix: Matrix | None,
           log: list[Defect], fixes_dir: Path = FIXES_DIR, parallel_skipped: str = "") -> Readiness:
    last = cycles[-1]
    out = []

    open_ = last.errors("Open")
    accepted = accepted_for(last.number, fixes_dir)
    unsigned = [a["key"] for a in accepted if not str(a.get("signed_off_by") or "").strip()]
    detail = f"cycle {last.number}: {len(open_)} open, {len(last.errors('Accepted'))} accepted"
    if open_:
        detail += "; open: " + ", ".join(sorted({f.rule for f in open_}))
    if unsigned:
        detail += "; not signed off: " + ", ".join(unsigned)
    out.append(Criterion(CRITERIA[0], not open_ and not unsigned, detail))

    checks = last.reconciliation.checks
    # No checks at all is not a pass (the same for the parallel's and the masking's checks)
    out.append(Criterion(CRITERIA[1], bool(checks) and all(c.passed for c in checks),
                         f"cycle {last.number}: {failing(checks)}" if checks else f"cycle {last.number}: no checks ran"))

    if runs:
        r = runs[-1]
        detail = f"run {r.number}: {len(r.unexplained())} unexplained, {len(r.explained())} explained; {failing(r.checks)}"
        if last.number < PARALLEL_CYCLE:
            detail += f" (the parallel pays from the cycle {PARALLEL_CYCLE} load, the first that passes every check)"
        out.append(Criterion(CRITERIA[2], bool(r.checks) and r.passed, detail))
    else:
        out.append(Criterion(CRITERIA[2], False, parallel_skipped or "not run yet"))

    out.append(Criterion(CRITERIA[3], bool(mask_checks) and all(c.passed for c in mask_checks),
                         failing(mask_checks) if mask_checks else "not run"))

    if matrix is None:
        out.append(Criterion(CRITERIA[4], False, "no test results given"))
        out.append(Criterion(CRITERIA[5], False, "no test results given"))
    else:
        faults = [r for r in matrix.rows if r.requirement.id.startswith("FS-")]
        bad = [r.requirement.id for r in faults if r.status != "passing"]
        out.append(Criterion(CRITERIA[4], bool(faults) and not bad,
                             f"{len(faults) - len(bad)} of {len(faults)} fault scenarios passing"
                             + (f"; not passing: {', '.join(bad)}" if bad else "")))
        bad = [f"{r.requirement.id} ({r.status})" for r in matrix.rows if r.status != "passing"]
        extra = len(matrix.untraced) + len(matrix.unknown)
        out.append(Criterion(CRITERIA[5], matrix.passed,
                             f"{len(matrix.rows) - len(bad)} of {len(matrix.rows)} requirements passing"
                             + (f"; not passing: {', '.join(bad)}" if bad else "")
                             + (f"; {extra} test results outside the plan" if extra else "")))

    c = counts(log)
    still = [d.id for d in log if d.status == "Open"]
    out.append(Criterion(CRITERIA[6], not still, f"{len(log)} defects: {c['Open']} open, {c['Closed']} closed, "
                                                 f"{c['Accepted']} accepted" + (f"; open: {', '.join(still)}" if still else "")))

    signs = [f"{d.id}: {d.resolution}" for d in log if d.status == "Accepted"]
    return Readiness(checkpoint(cycles, runs), out, signs)


def to_markdown(r: Readiness, with_tests: bool = True) -> str:
    lines = ["# Go or no-go readiness: HR and payroll conversion", "",
             "[← Back to overview](../README.md) · [Test plan](../docs/test-plan.md) · "
             "[Defect log](../docs/defect-log.md) · [Traceability](../docs/traceability.md)", "",
             f"Checkpoint: {r.point}. Built by `python -m hcm_conv readiness`: the exit criteria of the "
             "test plan, each checked against evidence worked out again. Every one must pass.", "",
             f"## Decision: {r.decision}", "",
             "| # | Exit criterion | Result | Evidence |", "|---|---|---|---|"]
    for i, c in enumerate(r.criteria, start=1):
        result = "PASS" if c.passed else "**FAIL**"
        lines.append(f"| {i} | {c.name} | {result} | {c.detail.replace('|', chr(92) + '|')} |")
    blocking = [c for c in r.criteria if not c.passed]
    if blocking:
        lines += ["", "## What blocks go", ""] + [f"- {c.name}: {c.detail}" for c in blocking]
    if r.sign_offs:
        lines += ["", "## Signed off", ""] + [f"- {s}" for s in r.sign_offs]
    if not with_tests:
        lines += ["", "Criteria 5 and 6 here come from every requirement of the test plan passing, as in a green "
                      "CI run. CI checks them for real on every run: the `hcm-conversion-validation-traceability` "
                      "job builds this report from both suites' JUnit files and fails on NO-GO."]
    return "\n".join(lines) + "\n"


def write(r: Readiness, out: Path, name: str = "readiness") -> tuple[Path, Path]:
    out.mkdir(parents=True, exist_ok=True)
    md, js = out / f"{name}.md", out / f"{name}.json"
    md.write_bytes(to_markdown(r).encode("utf-8"))
    js.write_bytes((json.dumps(r.as_checks(), indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    return md, js


@dataclass
class Evidence:
    cycles: list[Cycle]
    runs: list[Run]
    mask_checks: list
    parallel_skipped: str = ""   # why there are no parallel runs, when there are none


def gather(client, key: bytes) -> Evidence:
    """Cycles 1 to 3, then the payroll parallel from cycle 3's target, then a masked copy checked."""
    import tempfile

    from . import cycles as cycles_, extract, legacy, mask, parallel
    done = cycles_.run(client)
    clean = done[PARALLEL_CYCLE - 1].passed
    runs = parallel.run_all(client, extract.load_cycle(PARALLEL_CYCLE)) if clean else []
    with tempfile.TemporaryDirectory() as tmp:
        mask.write(legacy.LEGACY_DIR, Path(tmp), key)
        checks = mask.verify(legacy.LEGACY_DIR, Path(tmp))
    skipped = "" if clean else f"not run: cycle {PARALLEL_CYCLE} did not pass every check, so there is no clean load to pay from"
    return Evidence(done, runs, checks, skipped)


def at(evidence: Evidence, cycle: int, run: int | None) -> tuple[list[Cycle], list[Run]]:
    """The evidence as it stood at a checkpoint: cycles 1 to cycle, parallel runs 1 to run."""
    return evidence.cycles[:cycle], evidence.runs[:run] if run else []


def all_passing(plan) -> Matrix:
    """A matrix with every requirement passing, as in a green CI run (for the committed examples)."""
    from .trace import TestResult, build
    return build(plan, [TestResult("plan", r.id, "passed", (r.id,)) for r in plan])


EXAMPLES = {"readiness-go.md": (3, 2), "readiness-no-go.md": (2, 1)}


def examples(evidence: Evidence, plan) -> dict[str, str]:
    """The committed docs: a GO and a NO-GO checkpoint, and the defect log at the GO one."""
    from . import defects
    out = {}
    for name, (cycle, run) in EXAMPLES.items():
        cs, rs = at(evidence, cycle, run)
        log = defects.log(cs, rs)
        out[name] = to_markdown(decide(cs, rs, evidence.mask_checks, all_passing(plan), log), with_tests=False)
        if name == "readiness-go.md":
            out["defect-log.md"] = defects.to_markdown(log, checkpoint(cs, rs))
    return out
