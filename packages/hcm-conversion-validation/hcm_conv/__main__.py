"""Command line.

    python -m hcm_conv run                    # cycles 1 to 3 against an in-process mock API
    python -m hcm_conv run --cycle 2          # one cycle (its deltas still compare with cycle 1)
    python -m hcm_conv run --api-url http://127.0.0.1:8051    # a mock API already running
    python -m hcm_conv exceptions --cycle 1   # print a cycle's exceptions (no Excel needed)
    python -m hcm_conv serve --port 8051      # start the mock API
    python -m hcm_conv generate               # rewrite legacy/ from the seed

Exit code 1 when a check fails or an exception is still open, so a pipeline can stop on it.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import cycles, legacy, report

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
    serve = sub.add_parser("serve", help="start the mock API")
    serve.add_argument("--port", type=int, default=8051)
    sub.add_parser("generate", help="rewrite legacy/ from the seed")
    args = parser.parse_args(argv)

    if args.command == "generate":
        legacy.write()
        return 0
    if args.command == "serve":
        import uvicorn
        from .mock_api import create_app
        uvicorn.run(create_app(), host="127.0.0.1", port=args.port)
        return 0

    numbers = tuple(range(1, (args.cycle or 3) + 1))
    if args.command == "exceptions":
        from fastapi.testclient import TestClient
        from .mock_api import create_app
        with TestClient(create_app()) as client:
            cycle = cycles.run(client, (args.cycle,))[0]   # no deltas needed, so only this cycle
        print_exceptions(cycle, args.all)
        return 0
    if args.api_url:
        import httpx2
        client = httpx2.Client(base_url=args.api_url, timeout=30)
    else:
        from fastapi.testclient import TestClient
        from .mock_api import create_app
        client = TestClient(create_app())
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
