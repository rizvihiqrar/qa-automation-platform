"""Command line.

    python -m hcm_conv run                    # cycles 1 to 3 against an in-process mock API
    python -m hcm_conv run --cycle 2          # one cycle (its deltas still compare with cycle 1)
    python -m hcm_conv run --api-url http://127.0.0.1:8051    # a mock API already running
    python -m hcm_conv exceptions --cycle 1   # print a cycle's exceptions (no Excel needed)
    python -m hcm_conv parallel               # cycles 1 to 3, then payroll parallel runs 1 and 2
    python -m hcm_conv mask --out DIR         # a masked copy of legacy/ (key in HCM_MASK_KEY)
    python -m hcm_conv trace --junit reports/junit.xml --junit reports/junit-faults.xml   # with results
    python -m hcm_conv trace                  # docs/traceability.md: the tests of each requirement
    python -m hcm_conv readiness --junit reports/junit.xml --junit reports/junit-faults.xml   # go or no-go
    python -m hcm_conv serve --port 8051      # start the mock API
    python -m hcm_conv generate               # rewrite legacy/ from the seed

Exit code 1 when a check fails or an exception is still open, so a pipeline can stop on it
(for parallel, when the last run has an unexplained difference; for mask, when a check fails;
for trace with --junit, when a requirement is not passing; for readiness, on NO-GO).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from . import cycles, extract, legacy, parallel, report, trace

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")   # accented names on a Windows console
    parser = argparse.ArgumentParser(prog="python -m hcm_conv")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run mock conversion cycles and write the exception reports")
    run.add_argument("--cycle", type=int, choices=[1, 2, 3], help="only this cycle (default: 1 to 3)")
    run.add_argument("--api-url", help="a mock API that is already running (default: in-process)")
    run.add_argument("--out", type=Path, default=ROOT / "reports", help="where the workbooks go")
    show = sub.add_parser("exceptions", help="print a cycle's exceptions as a table")
    show.add_argument("--cycle", type=int, choices=[1, 2, 3], default=1)
    show.add_argument("--all", action="store_true", help="include info rows (held because of another row)")
    par = sub.add_parser("parallel", help="load cycles 1 to 3, then run the payroll parallel twice")
    par.add_argument("--api-url", help="a mock API that is already running (default: in-process)")
    par.add_argument("--out", type=Path, default=ROOT / "reports", help="where the workbooks go")
    msk = sub.add_parser("mask", help="write a masked copy of the legacy extract and check it")
    msk.add_argument("--out", type=Path, default=ROOT / "reports" / "masked")
    tr = sub.add_parser("trace", help="the traceability matrix: with --junit, each requirement's latest result")
    tr.add_argument("--junit", type=Path, action="append", help="a JUnit XML file, once per suite (none: the tests only)")
    tr.add_argument("--out", type=Path, help="with --junit: where traceability.md and .xlsx go (default reports/)")
    tr.add_argument("--md", type=Path, help="without --junit: where the matrix goes (default docs/traceability.md)")
    rd = sub.add_parser("readiness", help="the go or no-go readiness report and the defect log")
    rd.add_argument("--junit", type=Path, action="append", help="a JUnit XML file, once per suite")
    rd.add_argument("--out", type=Path, help="where the files go (default reports/, or docs/ with --examples)")
    rd.add_argument("--examples", action="store_true", help="rebuild the committed GO and NO-GO examples and the defect log")
    serve = sub.add_parser("serve", help="start the mock API")
    serve.add_argument("--port", type=int, default=8051)
    sub.add_parser("generate", help="rewrite legacy/ from the seed")
    args = parser.parse_args(argv)

    if args.command == "generate":
        legacy.write()
        return 0
    if args.command == "mask":
        return run_mask(args.out)
    if args.command == "trace":
        return run_trace(args)
    if args.command == "readiness":
        return run_readiness(args)
    if args.command == "serve":
        import uvicorn
        from .mock_api import create_app
        uvicorn.run(create_app(), host="127.0.0.1", port=args.port)
        return 0

    numbers = tuple(range(1, (getattr(args, "cycle", None) or 3) + 1))
    if args.command == "exceptions":
        from fastapi.testclient import TestClient
        from .mock_api import create_app
        with TestClient(create_app()) as client:
            cycle = cycles.run(client, (args.cycle,))[0]   # no deltas needed, so only this cycle
        print_exceptions(cycle, args.all)
        return 0
    if args.api_url:
        from .client import RetryingClient
        client = RetryingClient(args.api_url, timeout=30,
                                on_retry=lambda r: print(f"  retry: {r.call} try {r.attempt} failed ({r.error})"))
    else:
        from fastapi.testclient import TestClient
        from .mock_api import create_app
        client = TestClient(create_app())
    if args.command == "parallel":
        with client:
            if not cycles.run(client)[-1].passed:
                print("Cycle 3 did not pass, so there is nothing clean to pay from.")
                return 1
            runs = parallel.run_all(client, extract.load_cycle(3))
        for r in runs:
            print_run(r, parallel.write(r, args.out / f"parallel_run{r.number}.xlsx"))
        return 0 if runs[-1].passed else 1
    with client:
        results = cycles.run(client, numbers)
    shown = [c for c in results if args.cycle is None or c.number == args.cycle]
    for c in shown:
        print_cycle(c, report.write(c, args.out / f"exceptions_cycle{c.number}.xlsx"))
    last = shown[-1]
    return 0 if last.passed and not last.errors("Open") else 1


def print_cycle(c: cycles.Cycle, path: Path) -> None:
    print(f"\nCycle {c.number}")
    for check in c.reconciliation.checks:
        print(f"  {'PASS' if check.passed else 'FAIL'}  {check.name}: {check.detail}")
    print(f"  {'Record type':<14}{'Source':>8}{'Held':>7}{'Loaded':>8}{'Rejected':>10}{'Target':>8}")
    for n in c.reconciliation.counts:
        print(f"  {n.sheet:<14}{n.source:>8}{n.held:>7}{n.loaded:>8}{n.rejected:>10}{n.target:>8}")
    line = f"  Exceptions: {len(c.errors('Open'))} open, {len(c.errors('Accepted'))} accepted"
    if c.deltas:
        line += f"; against cycle {c.number - 1}: {c.deltas.summary()}"
    print(line)
    print(f"  Report: {path}")


def print_run(r: parallel.Run, path: Path) -> None:
    print(f"\nPayroll parallel run {r.number}: {r.payslips} payslips, {r.lines} pay lines")
    for change in r.changes:
        print(f"  setup change {change['issue']}: {change['setting']} = {change['value']}")
    for check in r.checks:
        print(f"  {'PASS' if check.passed else 'FAIL'}  {check.name}: {check.detail}")
    for period, (old, new) in r.totals.items():
        print(f"  {period}: legacy net {old:,}, new net {new:,}, difference {new - old:,}")
    print(f"  Report: {path}")


def run_mask(out: Path) -> int:
    key = os.environ.get("HCM_MASK_KEY", "")
    if not key:
        print("Set HCM_MASK_KEY to a secret key first (the same key gives the same masked data).")
        return 2
    from . import mask   # builds its fake-name pools on import; only this command needs them
    mask.write(legacy.LEGACY_DIR, out, key.encode("utf-8"))
    checks = mask.verify(legacy.LEGACY_DIR, out)
    print(f"Masked extract: {out}")
    for check in checks:
        print(f"  {'PASS' if check.passed else 'FAIL'}  {check.name}: {check.detail}")
    return 0 if all(c.passed for c in checks) else 1


def shown_path(path: Path) -> str:
    """reports/junit.xml when the file is in this package, so the matrix reads the same on every machine."""
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.name


def run_readiness(args) -> int:
    import secrets

    from fastapi.testclient import TestClient

    from . import defects, readiness
    from .mock_api import create_app
    if bool(args.junit) == args.examples:
        print("Give --junit (once per suite) for the decision, or --examples to rebuild the committed examples")
        return 2
    missing = [str(p) for p in args.junit or [] if not p.is_file()]
    if missing:
        print(f"No JUnit file at {', '.join(missing)}: run the suite first")
        return 2
    # The masking checks must pass whatever the key is, so any key will do here
    key = os.environ.get("HCM_MASK_KEY", "").encode("utf-8") or secrets.token_bytes(16)
    with TestClient(create_app()) as client:
        evidence = readiness.gather(client, key)
    plan = trace.load_plan()
    if args.examples:
        out = args.out or ROOT / "docs"
        out.mkdir(parents=True, exist_ok=True)
        for name, text in readiness.examples(evidence, plan).items():
            (out / name).write_bytes(text.encode("utf-8"))
            print(f"  {out / name}")
        return 0
    matrix = trace.build(plan, trace.read_junit(args.junit), [shown_path(p) for p in args.junit])
    cs, rs = evidence.cycles, evidence.runs
    log = defects.log(cs, rs)
    result = readiness.decide(cs, rs, evidence.mask_checks, matrix, log, parallel_skipped=evidence.parallel_skipped)
    out = args.out or ROOT / "reports"
    md, js = readiness.write(result, out)
    # This run's log links to this run's report, not the committed GO example
    (out / "defect-log.md").write_bytes(defects.to_markdown(log, result.point, "readiness.md").encode("utf-8"))
    defects.write_workbook(log, result.point, out / "defect-log.xlsx")
    print(f"Readiness at {result.point}: {result.decision}")
    for i, c in enumerate(result.criteria, start=1):
        print(f"  {'PASS' if c.passed else 'FAIL'}  {i}. {c.name}: {c.detail}")
    print(f"  Report: {md}, {js}, {out / 'defect-log.xlsx'}")
    return 0 if result.decision == "GO" else 1


def run_trace(args) -> int:
    if args.junit and args.md:
        print("--md is for the committed matrix (no --junit); with --junit, use --out")
        return 2
    if args.out and not args.junit:
        print("--out needs --junit; without it, use --md")
        return 2
    if not args.junit:   # the committed matrix: what the suites collect, no results
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tests = trace.collect(Path(tmp) / "map.json")
        text = trace.to_markdown(trace.build(trace.load_plan(), tests), results=False)
        (args.md or ROOT / "docs" / "traceability.md").write_bytes(text.encode("utf-8"))   # LF on every machine
        print(text.splitlines()[6].strip("*"))
        return 0
    missing = [str(p) for p in args.junit if not p.is_file()]
    if missing:
        print(f"No JUnit file at {', '.join(missing)}: run the suite first")
        return 2
    matrix = trace.build(trace.load_plan(), trace.read_junit(args.junit), [shown_path(p) for p in args.junit])
    print(f"Traceability: {matrix.summary()}")
    for row in matrix.rows:
        if row.status != "passing":
            print(f"  {row.status.upper()}  {row.requirement.id} {row.requirement.text}")
    out = args.out or ROOT / "reports"
    out.mkdir(parents=True, exist_ok=True)
    (out / "traceability.md").write_bytes(trace.to_markdown(matrix).encode("utf-8"))
    print(f"  Matrix: {trace.write_workbook(matrix, out / 'traceability.xlsx')}")
    return 0 if matrix.passed else 1


def print_exceptions(c: cycles.Cycle, everything: bool) -> None:
    rows = [f for f in c.findings if everything or f.severity == "error"]
    rows.sort(key=lambda f: (f.severity != "error", f.rule, f.file, f.key))
    header = ("Rule", "Status", "File", "Line", "Key", "Field", "Value", "Message")
    table = [header] + [(f.rule, f.status, f.file, str(f.line or ""), f.key, f.field, f.value, f.message) for f in rows]
    widths = [max(len(r[i]) for r in table) for i in range(len(header) - 1)]
    print(f"Cycle {c.number}: {len(c.errors('Open'))} open, {len(c.errors('Accepted'))} accepted")
    for r in table:
        print("  " + "  ".join(v.ljust(w) for v, w in zip(r, widths)) + "  " + r[-1])


if __name__ == "__main__":
    sys.exit(main())
