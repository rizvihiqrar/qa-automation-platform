"""The defect log: every conversion defect, where it was found, what closed it, and its status.

Nothing in it is typed by hand. It is worked out from the cycles and the payroll parallel runs:

  D-01 to D-20  the seeded defects (legacy/defects.json), found by their rules in cycle 1
  N-01          a defect that arrives later (the late new hire of cycle 2): a new exception that
                is not in the answer key, named by the fix that closes it
  PP-01, PP-02  the payroll setup mistakes, found by parallel run 1, closed by a setup change
  EX-01         the difference the payroll manager signed off (rounding), proven by a replay

A defect is Open, Closed or Accepted as of a checkpoint: the last cycle and the last parallel run
given. So the same code gives the log after cycle 2 (with open defects) and after cycle 3.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import yaml
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .cycles import Cycle, accepted_for
from .extract import FIXES_DIR, LEGACY_DIR
from .parallel import Run
from .report import table, widen

STATUSES = ("Open", "Closed", "Accepted")
STATUS_FILL = {"Open": "F4CCCC", "Closed": "D9EAD3", "Accepted": "FFF2CC"}


@dataclass
class Defect:
    id: str
    kind: str
    description: str
    where: str
    found_by: str      # the rule or check that found it
    found_in: str      # Cycle 1, Parallel run 1
    owner: str
    status: str        # Open, Closed or Accepted
    resolution: str = ""
    closed_in: str = ""


def cycle_files(fixes_dir: Path) -> list[int]:
    """The cycles that have a fixes file (cycle2.yaml, cycle3.yaml, ...), in order."""
    return sorted(int(f.stem[5:]) for f in fixes_dir.glob("cycle*.yaml") if f.stem[5:].isdigit())


def fixes_by_defect(fixes_dir: Path, last_cycle: int | None = None) -> dict[str, tuple[int, list[dict]]]:
    """{defect: (cycle, its fixes)} for the fixes made before cycles 2 to last_cycle (default: all of them)."""
    out: dict[str, tuple[int, list[dict]]] = {}
    for n in cycle_files(fixes_dir):
        if last_cycle is not None and n > last_cycle:
            break
        for fix in yaml.safe_load((fixes_dir / f"cycle{n}.yaml").read_text(encoding="utf-8"))["fixes"]:
            if fix.get("defect"):
                out.setdefault(fix["defect"], (n, []))[1].append(fix)
    return out


def shown(value) -> str:
    return ", ".join(map(str, value)) if isinstance(value, list) else str(value)


def matches(f, rule: str, file: str, key: str, field: str) -> bool:
    """A finding is the defect when rule, file, key and field agree. A duplicate is reported on
    every column of both rows, so for DUPLICATE_ID the field is not compared."""
    return (f.rule, f.file, f.key) == (rule, file, key) and (f.field == field or rule == "DUPLICATE_ID")


def conversion_defects(cycles: list[Cycle], fixes_dir: Path, legacy_dir: Path) -> list[Defect]:
    key = json.loads((legacy_dir / "defects.json").read_text(encoding="utf-8"))
    last = cycles[-1]
    later = fixes_by_defect(fixes_dir)                    # names of the fixes to come, for new defects
    fixed = fixes_by_defect(fixes_dir, last.number)      # the fixes made by this checkpoint
    accepted = accepted_for(last.number, fixes_dir)

    def entry(defect_id, kind, description, spot, found_by):
        rule, file, key_, field_ = spot
        found = [[f for f in c.errors() if matches(f, *spot)] for c in cycles]
        seen = [c.number for c, hits in zip(cycles, found) if hits]
        where = f"{file} {key_} {field_}"
        if not seen:
            return Defect(defect_id, kind, description, where, found_by, "not found", "HR data owner", "Open",
                          "the rule never reported it")
        now = {f.status for f in found[-1]}
        status = "Open" if "Open" in now else "Accepted" if now else "Closed"
        d = Defect(defect_id, kind, description, where, found_by, f"Cycle {seen[0]}", "HR data owner", status)
        if status == "Accepted":
            a = next((a for a in accepted if (a["rule"], a["file"], a["key"]) == (rule, file, key_)), {})
            d.resolution = (f"Accepted from cycle {a.get('from_cycle', '?')}: {a.get('reason', 'no reason given')} "
                            f"(signed off by {a.get('signed_off_by') or 'nobody'})")
        elif status == "Closed":
            d.closed_in = f"Cycle {next(c.number for c, hits in zip(cycles, found) if c.number > seen[0] and not hits)}"
            if defect_id in fixed:
                n = fixed[defect_id][0]
                d.resolution = f"Fixed in the legacy data before cycle {n} (fixes/cycle{n}.yaml)"
            else:
                d.resolution = "Gone without a fix that names it"
        return d

    out = [entry(d["id"], d["type"], d["description"], (d["rule"], d["file"], d["key"], d["field"]), d["rule"])
           for d in key]
    known = {(d["rule"], d["file"], d["key"], d["field"]) for d in key}
    used = {d.id for d in out}
    for c in cycles[1:]:
        for f in c.deltas.new:
            spot = (f.rule, f.file, f.key, f.field)
            if spot in known or any(matches(f, *k) for k in known):
                continue
            known.add(spot)
            # Named by the later fix on the same file whose match holds this key, if no other defect has the name
            names = [i for i, (_, fs) in later.items() if i not in used and not i.startswith("D-")
                     and any(fx.get("file") == f.file and f.key in (fx.get("match") or {}).values() for fx in fs)]
            defect_id = names[0] if names else f"NEW-{f.rule}-{f.key}-{f.field}"
            used.add(defect_id)
            out.append(entry(defect_id, "late change", f"{f.field} {f.message} (a row that arrived after cycle {c.number - 1})",
                             spot, f.rule))
    return out


def payroll_defects(runs: list[Run], fixes_dir: Path) -> list[Defect]:
    if not runs:
        return []
    plan = yaml.safe_load((fixes_dir / "parallel.yaml").read_text(encoding="utf-8"))
    last = runs[-1]

    def passed(r: Run, name: str) -> bool:
        return any(c.name == name for c in r.checks) and all(c.passed for c in r.checks if c.name == name)

    out = []
    for n, changes in sorted((plan.get("runs") or {}).items()):
        # Found by the last run before the change that still had unexplained differences
        before = [r for r in runs if r.number < n and r.unexplained()]
        for c in changes:
            # A setup mistake is closed only by a later run that made the change and explains everything
            closing = next((r for r in runs if r.number >= n and passed(r, "Every difference is explained")), None)
            d = Defect(c["issue"], "payroll setup", c["reason"], c["setting"], "Every difference is explained",
                       f"Parallel run {before[0].number}" if before else "not found", "Payroll manager",
                       "Closed" if closing else "Open")
            if closing:
                d.resolution = f"Setup change before run {n}: {c['setting']} = {shown(c['value'])}"
                d.closed_in = f"Parallel run {closing.number}"
            out.append(d)
    for e in plan.get("explained") or []:
        uses = [r.number for r in runs if any(d.explained_by == e["id"] for d in r.differences)]
        count = sum(1 for d in last.differences if d.explained_by == e["id"])
        # Signed off, but it stays accepted only while the guard says each explained gap is rounding sized
        ok = passed(last, "Explained differences are rounding sized")
        out.append(Defect(e["id"], "known difference", e["reason"], e["setting"], "Explained differences are rounding sized",
                          f"Parallel run {uses[0]}" if uses else "not found", "Payroll manager",
                          "Accepted" if ok else "Open",
                          f"Proven by a replay with {e['setting']} = {shown(e['value'])}: {count} differences in run {last.number} "
                          f"(signed off by {e['signed_off_by']})" if ok else ""))
    return out


def log(cycles: list[Cycle], runs: list[Run], fixes_dir: Path = FIXES_DIR, legacy_dir: Path = LEGACY_DIR) -> list[Defect]:
    return conversion_defects(cycles, fixes_dir, legacy_dir) + payroll_defects(runs, fixes_dir)


def counts(defects: list[Defect]) -> dict[str, int]:
    return {s: sum(d.status == s for d in defects) for s in STATUSES}


def checkpoint(cycles: list[Cycle], runs: list[Run]) -> str:
    text = f"mock cycle {cycles[-1].number}"
    return text + (f" and payroll parallel run {runs[-1].number}" if runs else ", before the payroll parallel")


def to_markdown(defects: list[Defect], point: str, readiness_link: str = "../docs/readiness-go.md") -> str:
    c = counts(defects)
    lines = ["# Defect log: HR and payroll conversion", "",
             "[← Back to overview](../README.md) · [Test plan](../docs/test-plan.md) · "
             f"[Readiness]({readiness_link})", "",
             f"As of {point}. Built by `python -m hcm_conv readiness` from the cycles and the payroll parallel runs, "
             "not typed by hand; a test fails when this file is not what the code builds.", "",
             f"**{len(defects)} defects: {c['Open']} open, {c['Closed']} closed, {c['Accepted']} accepted.**", "",
             "| ID | Kind | Description | Where | Found by | Found in | Owner | Status | Resolution | Closed in |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for d in defects:
        cells = [d.id, d.kind, d.description, f"`{d.where}`", f"`{d.found_by}`", d.found_in, d.owner,
                 f"**{d.status}**" if d.status == "Open" else d.status, d.resolution, d.closed_in]
        lines.append("| " + " | ".join(str(x).replace("|", "\\|") for x in cells) + " |")
    return "\n".join(lines) + "\n"


def write_workbook(defects: list[Defect], point: str, path: Path) -> Path:
    book = Workbook()
    ws = book.active
    ws.title = "Defects"
    ws.append([f"Defect log as of {point} (fake data; not affiliated with any HR vendor)"])
    ws["A1"].font = Font(bold=True, size=13)
    c = counts(defects)
    ws.append([f"{len(defects)} defects: {c['Open']} open, {c['Closed']} closed, {c['Accepted']} accepted"])
    ws.append([])
    table(ws, ["ID", "Kind", "Description", "Where", "Found by", "Found in", "Owner", "Status", "Resolution", "Closed in"],
          [[d.id, d.kind, d.description, d.where, d.found_by, d.found_in, d.owner, d.status, d.resolution, d.closed_in]
           for d in defects])
    for row in ws.iter_rows(min_row=5):
        row[7].fill = PatternFill("solid", fgColor=STATUS_FILL[row[7].value])
    ws.freeze_panes = "B5"
    ws.auto_filter.ref = f"A4:J{ws.max_row}"
    widen(ws)
    path.parent.mkdir(parents=True, exist_ok=True)
    book.save(path)
    return path
