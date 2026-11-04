"""Map the legacy rows to target records, and find every row that must not be loaded yet.

Each problem is a Finding. An error holds its row back from the load; a row that needs a held
row (a pay result whose worker is held) is held too, with an info finding that says why, so
the load never fails on a row the checks already knew about.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

import yaml

from .extract import Source

ROOT = Path(__file__).resolve().parents[1]
MAPPING = yaml.safe_load((ROOT / "mapping.yaml").read_text(encoding="utf-8"))
SQL_DIR = ROOT / "sql"
# UTF-8 read as Windows-1252 turns é into Ã© and î into Ã®: Ã or Â, then a non-ASCII character.
MOJIBAKE = re.compile(r"[ÃÂ][^\x00-\x7f]|\ufffd")


@dataclass
class Finding:
    rule: str
    file: str
    line: int | None
    key: str
    field: str
    value: str
    message: str
    severity: str = "error"     # error: the row is held back; info: held because of another row
    status: str = "Open"        # Open, or Accepted when signed off in accepted.yaml

    def ident(self) -> tuple:
        """The same problem in the next cycle has the same ident, even if its line moved."""
        return (self.rule, self.file, self.key, self.field)


@dataclass
class Record:
    sheet: str
    file: str
    line: int | None
    spreadsheet_key: str
    key: str
    source: dict
    data: dict = field(default_factory=dict)
    held: bool = False
    broken: set = field(default_factory=set)   # source columns that already broke a rule


@dataclass
class Conversion:
    records: dict[str, list[Record]]
    findings: list[Finding]

    def sent(self, sheet: str) -> list[Record]:
        return [r for r in self.records[sheet] if not r.held]


def transform(spec: dict, raw: str) -> tuple[str, str | None, str | None]:
    """(target value, rule broken, message) for one field."""
    value = (raw or "").strip()
    if value == "":
        return ("", "REQUIRED", "is blank") if spec.get("required") else ("", None, None)
    if spec.get("id") and not re.fullmatch(r"\d{6}", value):
        return value, "ID_FORMAT", "is not 6 digits (leading zeros lost?)"
    if spec.get("date"):
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError
            date.fromisoformat(value)
        except ValueError:
            return value, "DATE_INVALID", "is not a real date written YYYY-MM-DD"
    if spec.get("money"):
        try:
            amount = Decimal(value)
            if amount != amount.quantize(Decimal("0.01")):
                raise InvalidOperation
        except InvalidOperation:
            return value, "MONEY_INVALID", "is not an amount with at most 2 decimals"
    if spec.get("code"):
        mapped = MAPPING["codes"][spec["code"]].get(value)
        if mapped is None:
            return value, "CODE_UNKNOWN", f"is not in the {spec['code']} code table"
        value = mapped
    if spec.get("name") and MOJIBAKE.search(value):
        return value, "ENCODING", "has double-encoded characters (UTF-8 read as Windows-1252)"
    return value, None, None


def source_rows(source: Source, sheet: str, file: str) -> list[tuple[int | None, dict]]:
    if file == "payroll.sql":
        cur = source.payroll.execute("SELECT * FROM pay_results ORDER BY employee_id, period_id")
        names = [c[0] for c in cur.description]
        return [(None, dict(zip(names, row))) for row in cur]
    return [(r.line, r.data) for r in source.table(file)]


def convert(source: Source) -> Conversion:
    records: dict[str, list[Record]] = {}
    findings: list[Finding] = []

    def flag(rec: Record, rule: str, field_name: str, value: str, message: str, severity="error"):
        findings.append(Finding(rule, rec.file, rec.line, rec.key, field_name, value, message, severity))
        rec.held = True
        rec.broken.add(field_name)

    for sheet, spec in MAPPING["sheets"].items():
        file = spec["source"]
        records[sheet] = []
        added = 0
        for line, raw in source_rows(source, sheet, file):
            key = "/".join((raw.get(k) or "").strip() for k in spec["key"])
            if file == "payroll.sql":
                ss_key = f"payroll:{key}"
            elif line is None:
                added += 1
                ss_key = f"{file}:added-{added}"
            else:
                ss_key = f"{file}:{line}"
            rec = Record(sheet, file, line, ss_key, key, raw)
            for target_field, fspec in spec["fields"].items():
                value, rule, message = transform(fspec, raw.get(fspec["from"]))
                rec.data[target_field] = value
                if rule:
                    flag(rec, rule, fspec["from"], (raw.get(fspec["from"]) or ""), message)
            records[sheet].append(rec)

        counts = Counter(r.key for r in records[sheet])
        for rec in records[sheet]:
            if counts[rec.key] > 1:
                flag(rec, "DUPLICATE_ID", "/".join(spec["key"]), rec.key, f"is on {counts[rec.key]} rows")

    for rec in records["Workers"]:
        hire, term = rec.data["hire_date"], rec.data["termination_date"]
        if term and hire and not rec.broken & {"hire_date", "termination_date"} and term < hire:
            flag(rec, "DATE_ORDER", "termination_date", term, f"is before the hire date {hire}")

    keys = {sheet: {r.key for r in recs} for sheet, recs in records.items()}
    refs = [("Organizations", "parent_org_id", "Organizations", "REF_ORG"),
            ("Positions", "org_id", "Organizations", "REF_ORG"),
            ("Workers", "position_id", "Positions", "REF_POSITION"),
            ("Compensation", "employee_id", "Workers", "REF_WORKER"),
            ("Pay Results", "employee_id", "Workers", "REF_WORKER")]
    for sheet, column, other, rule in refs:
        for rec in records[sheet]:
            value = (rec.source.get(column) or "").strip()
            if value and column not in rec.broken and value not in keys[other]:
                flag(rec, rule, column, value, f"is not in {MAPPING['sheets'][other]['source']}")

    findings += control_totals(source)
    for rec, finding in pay_totals(source, records["Pay Results"]):
        findings.append(finding)
        rec.held = True

    hold_dependants(records, findings)
    return Conversion(records, findings)


def amount(text: str) -> Decimal:
    """A salary for the hash total; one that is blank or not a number is already an exception, so it adds 0."""
    try:
        return Decimal(text)
    except InvalidOperation:
        return Decimal(0)


def control_totals(source: Source) -> list[Finding]:
    """CONTROL_TOTAL: the trailer's record count and hash total against the rows themselves."""
    out = []
    for file, total_of in (("workers.csv", lambda rows: str(sum(int(r.data["employee_id"]) for r in rows
                                                                if r.data["employee_id"].isdigit()))),
                           ("compensation.csv", lambda rows: str(sum(amount(r.data["annual_salary"]) for r in rows)))):
        trailer = source.trailers.get(file)
        rows = source.table(file)
        if trailer is None:
            out.append(Finding("CONTROL_TOTAL", file, None, "TRAILER", "trailer", "", "the file has no trailer"))
            continue
        if trailer["count"] != len(rows):
            out.append(Finding("CONTROL_TOTAL", file, trailer["line"], "TRAILER", "count", str(trailer["count"]),
                               f"says {trailer['count']} records; the file has {len(rows)}"))
        if str(trailer["hash_total"]) != total_of(rows):
            out.append(Finding("CONTROL_TOTAL", file, trailer["line"], "TRAILER", "hash_total", str(trailer["hash_total"]),
                               f"hash total is {total_of(rows)} from the rows"))
    return out


def pay_totals(source: Source, pay_records: list[Record]) -> list[tuple[Record, Finding]]:
    by_key = {r.key: r for r in pay_records}
    out = []
    for employee, period, field_name, value, expected, message in \
            source.payroll.execute((SQL_DIR / "pay_totals.sql").read_text(encoding="utf-8")):
        rec = by_key[f"{employee}/{period}"]
        text = f"{message} ({expected})" if expected else message
        out.append((rec, Finding("PAY_TOTAL", "payroll.sql", None, rec.key, field_name, value, text)))
    return out


def hold_dependants(records: dict[str, list[Record]], findings: list[Finding]) -> None:
    """HELD_PARENT: a row that needs a held row is held too (info, not a defect of its own)."""
    def hold(sheet: str, column: str, parent: str) -> int:
        held = {r.key for r in records[parent] if r.held}
        newly = 0
        for rec in records[sheet]:
            value = (rec.source.get(column) or "").strip()
            if not rec.held and value in held:
                rec.held = True
                newly += 1
                findings.append(Finding("HELD_PARENT", rec.file, rec.line, rec.key, column, value,
                                        f"not loaded: {parent[:-1].lower()} {value} is held back", "info"))
        return newly

    # An organization under a held organization is held too, as deep as the tree goes.
    while hold("Organizations", "parent_org_id", "Organizations"):
        pass
    chain = [("Positions", "org_id", "Organizations"), ("Workers", "position_id", "Positions"),
             ("Compensation", "employee_id", "Workers"), ("Pay Results", "employee_id", "Workers")]
    for sheet, column, parent in chain:
        hold(sheet, column, parent)


def accept(findings: list[Finding], accepted: list[dict]) -> None:
    """Mark the exceptions the business signed off as known (they stay held, but are not open)."""
    for a in accepted:
        hits = [f for f in findings if (f.rule, f.file, f.key) == (a["rule"], a["file"], a["key"])]
        if not hits:
            raise ValueError(f"accepted exception {a} matches nothing")
        for f in hits:
            f.status = "Accepted"
