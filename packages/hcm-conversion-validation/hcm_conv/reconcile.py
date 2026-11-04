"""Load one cycle into the target and prove that what arrived is what was sent.

  1 validate_only, then load, through the bulk load endpoint (one template, five sheets)
  2 read every record type back through the report export (CSV, the file a team would get)
  3 row counts:   source = held back + loaded + rejected, and the target holds what loaded
  4 hash totals:  counts and sums (IDs, salaries, gross and net per pay period) on both sides
  5 row hashes:   each record's mapped fields against the same record in the target
  6 rerun:        the same file loaded again changes nothing and adds no rows
"""
from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import dataclass, field
from decimal import Decimal

from . import template
from .convert import SQL_DIR, Conversion, Finding
from .extract import Source
from .target import SHEETS


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


@dataclass
class Counts:
    sheet: str
    source: int
    held: int
    sent: int
    loaded: int
    rejected: int
    target: int


@dataclass
class Reconciliation:
    checks: list[Check] = field(default_factory=list)
    counts: list[Counts] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    load: dict = field(default_factory=dict)


def bulk_load(client, content: bytes, mode: str) -> tuple[dict, list[dict]]:
    response = client.post("/bulk-loads", files={"file": ("conversion.xlsx", content)}, data={"mode": mode})
    response.raise_for_status()
    load = response.json()
    errors = client.get(load["errors_url"]).raise_for_status().json()
    return load, errors


def read_target(client) -> dict[str, list[dict]]:
    out = {}
    for sheet in SHEETS:
        response = client.get(f"/reports/{sheet.report}", params={"format": "csv", "bom": "true"})
        text = response.raise_for_status().content.decode("utf-8-sig")
        out[sheet.name] = list(csv.DictReader(io.StringIO(text)))
    return out


def row_hash(sheet, record: dict) -> str:
    return hashlib.sha256("\x1f".join(str(record.get(f, "")) for f in sheet.fields()).encode("utf-8")).hexdigest()


def key_of(sheet, record: dict) -> str:
    return "/".join(record[f] for f in sheet.key)


def reconcile(client, conversion: Conversion, source: Source) -> Reconciliation:
    result = Reconciliation()
    client.post("/tenant/reset").raise_for_status()
    content = template.build({s.name: [(r.spreadsheet_key, r.data) for r in conversion.sent(s.name)] for s in SHEETS})
    by_ss_key = {r.spreadsheet_key: r for recs in conversion.records.values() for r in recs}

    dry, dry_errors = bulk_load(client, content, "validate_only")
    load, errors = bulk_load(client, content, "load")
    result.load = {"validate_only": dry["status"], "load": load["status"], "rows": load["rows_total"],
                   "loaded": load["rows_loaded"], "rejected": load["rows_failed"]}
    for e in errors:
        rec = by_ss_key[e["spreadsheet_key"]]
        result.findings.append(Finding("TARGET_REJECTED", rec.file, rec.line, rec.key, e["field"],
                                       str(rec.data.get(e["field"], "")), f"{e['sheet']}: {e['message']}"))
    result.checks.append(Check("Target accepts every row sent", not errors and not dry_errors,
                               f"validate_only {len(dry_errors)} errors, load {len(errors)} errors"))

    target = read_target(client)
    rejected_keys = {e["spreadsheet_key"] for e in errors}

    count_problems = []
    for sheet in SHEETS:
        recs = conversion.records[sheet.name]
        sent = conversion.sent(sheet.name)
        rejected = sum(r.spreadsheet_key in rejected_keys for r in sent)
        c = Counts(sheet.name, len(recs), len(recs) - len(sent), len(sent), len(sent) - rejected, rejected,
                   len(target[sheet.name]))
        result.counts.append(c)
        if c.source != c.held + c.loaded + c.rejected or c.target != c.loaded:
            count_problems.append(f"{sheet.name}: source {c.source}, held {c.held}, loaded {c.loaded}, "
                                  f"rejected {c.rejected}, in target {c.target}")
    result.checks.append(Check("Row counts balance", not count_problems,
                               "; ".join(count_problems) or "source = held + loaded + rejected, target = loaded, for all 5 record types"))

    result.checks += hash_totals(conversion, source, target, rejected_keys)

    # A worker can load while its compensation row is held back: it would arrive with no pay.
    paid = {r["worker_id"] for r in target["Compensation"]}
    unpaid = sorted(r["id"] for r in target["Workers"] if r["id"] not in paid)
    result.checks.append(Check("Every loaded worker has compensation", not unpaid,
                               f"{len(unpaid)} without: {', '.join(unpaid)}" if unpaid else
                               f"all {len(target['Workers'])} workers"))

    mismatches = row_hashes(conversion, target, rejected_keys)
    result.findings += mismatches
    result.checks.append(Check("Row hashes match", not mismatches,
                               f"{len(mismatches)} records differ" if mismatches else
                               f"{sum(c.loaded for c in result.counts)} records identical field by field"))

    before = {s.name: sorted(row_hash(s, r) for r in target[s.name]) for s in SHEETS}
    again, _ = bulk_load(client, content, "load")
    after_target = read_target(client)
    after = {s.name: sorted(row_hash(s, r) for r in after_target[s.name]) for s in SHEETS}
    duplicates = {s.name: len(after_target[s.name]) - len({key_of(s, r) for r in after_target[s.name]}) for s in SHEETS}
    same = before == after and not any(duplicates.values())
    result.checks.append(Check("Rerun adds and changes nothing", same,
                               "the same file loaded twice: counts and row hashes unchanged, 0 duplicate keys" if same
                               else f"after the rerun: duplicate keys {duplicates}, "
                                    f"counts {[len(v) for v in before.values()]} -> {[len(v) for v in after.values()]}"))
    return result


def hash_totals(conversion: Conversion, source: Source, target: dict, rejected_keys: set) -> list[Check]:
    def loaded(sheet):
        return [r for r in conversion.sent(sheet) if r.spreadsheet_key not in rejected_keys]

    checks = []
    workers = loaded("Workers")
    src = (len(workers), sum(int(r.data["id"]) for r in workers))
    tgt = (len(target["Workers"]), sum(int(r["id"]) for r in target["Workers"]))
    checks.append(Check("Hash total: worker IDs", src == tgt, f"source {src[0]} workers, ID sum {src[1]}; target {tgt[0]}, {tgt[1]}"))

    comp = loaded("Compensation")
    src_pay = sum(Decimal(r.data["annual_amount"]) for r in comp)
    tgt_pay = sum(Decimal(r["annual_amount"]) for r in target["Compensation"])
    checks.append(Check("Hash total: annual salaries", src_pay == tgt_pay, f"source {src_pay:,}; target {tgt_pay:,}"))

    # The source side comes straight from the legacy payroll database, in SQL.
    db = source.payroll
    db.execute("DROP TABLE IF EXISTS temp.sent")
    db.execute("CREATE TEMP TABLE sent (key TEXT PRIMARY KEY)")
    db.executemany("INSERT INTO sent VALUES (?)", [(r.key,) for r in loaded("Pay Results")])
    src_periods = {p: (n, g, net) for p, n, g, net in db.execute((SQL_DIR / "pay_hash_totals.sql").read_text(encoding="utf-8"))}
    tgt_periods: dict[str, tuple] = {}
    for r in target["Pay Results"]:
        n, g, net = tgt_periods.get(r["period_id"], (0, 0, 0))
        tgt_periods[r["period_id"]] = (n + 1, g + int(Decimal(r["gross"]) * 100), net + int(Decimal(r["net"]) * 100))
    detail = ", ".join(f"{p}: {n} results, gross {g / 100:,.2f}, net {net / 100:,.2f}" for p, (n, g, net) in sorted(src_periods.items()))
    checks.append(Check("Hash totals: pay per period", src_periods == tgt_periods,
                        detail if src_periods == tgt_periods else f"source {src_periods}; target {tgt_periods}"))
    return checks


def row_hashes(conversion: Conversion, target: dict, rejected_keys: set) -> list[Finding]:
    out = []
    for sheet in SHEETS:
        in_target = {key_of(sheet, r): r for r in target[sheet.name]}
        for rec in conversion.sent(sheet.name):
            if rec.spreadsheet_key in rejected_keys:
                continue
            arrived = in_target.get(key_of(sheet, rec.data))
            if arrived is None:
                out.append(Finding("RECON_MISSING", rec.file, rec.line, rec.key, "", "", f"{sheet.name}: loaded but not in the target report"))
            elif row_hash(sheet, arrived) != row_hash(sheet, rec.data):
                fields = [f for f in sheet.fields() if str(arrived.get(f, "")) != str(rec.data.get(f, ""))]
                for f in fields:
                    out.append(Finding("RECON_MISMATCH", rec.file, rec.line, rec.key, f, str(arrived.get(f, "")),
                                       f"{sheet.name}: sent '{rec.data.get(f, '')}', the target holds '{arrived.get(f, '')}'"))
    return out
