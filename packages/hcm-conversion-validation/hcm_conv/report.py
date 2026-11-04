"""The exception report: one workbook per cycle, the file a conversion lead reads and sends on.

  Summary     the checks (pass or fail), the row counts and the exceptions by rule
  Exceptions  one row per problem: rule, severity, status, file, line, key, field, value, message
  Deltas      against the cycle before: new, fixed and still open
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from .cycles import Cycle

BOLD = Font(bold=True)
FILL = {"PASS": PatternFill("solid", fgColor="D9EAD3"), "FAIL": PatternFill("solid", fgColor="F4CCCC")}


def table(ws, header: list[str], rows: list[list]) -> None:
    ws.append(header)
    for cell in ws[ws.max_row]:
        cell.font = BOLD
    for row in rows:
        ws.append(row)


def widen(ws) -> None:
    for i, column in enumerate(ws.columns, start=1):
        width = max(len(str(c.value)) if c.value is not None else 0 for c in column)
        ws.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 8), 80)


def write(cycle: Cycle, path: Path) -> Path:
    book = Workbook()
    ws = book.active
    ws.title = "Summary"
    open_errors, accepted = cycle.errors("Open"), cycle.errors("Accepted")
    ws.append([f"Mock conversion cycle {cycle.number} (fake data; Workday-style mock API, not affiliated with any HR vendor)"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([f"Checks: {'all passed' if cycle.passed else 'some failed'}. "
               f"Open exceptions: {len(open_errors)}. Accepted: {len(accepted)}."])
    ws.append([])
    table(ws, ["Check", "Result", "Detail"],
          [[c.name, "PASS" if c.passed else "FAIL", c.detail] for c in cycle.reconciliation.checks])
    for row in ws.iter_rows(min_row=5, max_row=ws.max_row):
        row[1].fill = FILL[row[1].value]
    ws.append([])
    table(ws, ["Record type", "Source", "Held back", "Sent", "Loaded", "Rejected", "In target"],
          [[c.sheet, c.source, c.held, c.sent, c.loaded, c.rejected, c.target] for c in cycle.reconciliation.counts])
    ws.append([])
    by_rule = Counter((f.rule, f.severity, f.status) for f in cycle.findings)
    table(ws, ["Rule", "Severity", "Status", "Count"],
          [[r, s, st, n] for (r, s, st), n in sorted(by_rule.items())])
    widen(ws)
    ws.column_dimensions["A"].width = 38

    ex = book.create_sheet("Exceptions")
    order = {"error": 0, "info": 1}
    findings = sorted(cycle.findings, key=lambda f: (order[f.severity], f.rule, f.file, f.key))
    table(ex, ["Rule", "Severity", "Status", "File", "Line", "Key", "Field", "Value", "Message"],
          [[f.rule, f.severity, f.status, f.file, f.line, f.key, f.field, f.value, f.message] for f in findings])
    ex.freeze_panes = "A2"
    ex.auto_filter.ref = ex.dimensions
    widen(ex)

    de = book.create_sheet("Deltas")
    if cycle.deltas is None:
        de.append(["Cycle 1 is the baseline: there is no earlier cycle to compare with."])
    else:
        d = cycle.deltas
        de.append([f"Against cycle {cycle.number - 1}: {d.summary()}"])
        de.append([])
        rows = [[change, f.rule, f.status if change != "Fixed" else "", f.file, f.key, f.field, f.message]
                for change, items in (("New", d.new), ("Fixed", d.fixed), ("Still open", d.still_open), ("Accepted", d.accepted))
                for f in sorted(items, key=lambda f: (f.rule, f.key))]
        table(de, ["Change", "Rule", "Status", "File", "Key", "Field", "Message"], rows)
    widen(de)

    path.parent.mkdir(parents=True, exist_ok=True)
    book.save(path)
    return path
