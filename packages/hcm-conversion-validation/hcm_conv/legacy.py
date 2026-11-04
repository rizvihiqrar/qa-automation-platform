"""Generate the legacy HR and payroll extract that the conversion reads.

Everything is fake. Names come from Faker (fr_CA and en_CA) with a fixed seed, so the same
command always writes the same bytes, and the tests can expect exact counts. National IDs
start with 0, which no real Canadian SIN does.

The extract is what an old HR system typically hands over: flat CSV files for HR (each with
a control trailer: a record count and a hash total), and the payroll history as a database,
committed as a SQL dump (payroll.sql) because a .db file's bytes change with the SQLite
version. Twenty defects are seeded on purpose; defects.json is the answer key.

    python -m hcm_conv.legacy            # rewrite legacy/
"""
from __future__ import annotations

import csv
import io
import json
import random
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from faker import Faker

SEED = 51
PEOPLE = 198          # plus 2 rows entered twice = 200 worker rows
ORGS = 20
VACANT = 32           # positions = 198 filled + 32 vacant = 230
LEGACY_DIR = Path(__file__).resolve().parents[1] / "legacy"

WORKER_COLUMNS = ["employee_id", "first_name", "last_name", "birth_date", "personal_email",
                  "national_id", "hire_date", "termination_date", "status", "position_id",
                  "country", "province"]
COMP_COLUMNS = ["employee_id", "annual_salary", "currency", "pay_frequency", "effective_date"]
POSITION_COLUMNS = ["position_id", "org_id", "title", "status"]
ORG_COLUMNS = ["org_id", "name", "parent_org_id", "cost_centre"]

PERIODS_PER_YEAR = {"W": 52, "B": 26, "S": 24, "M": 12}
# The last three pay runs in the history: (period_id, start, end, pay_date)
PAY_PERIODS = [
    ("P2026-19", "2026-09-05", "2026-09-18", "2026-09-25"),
    ("P2026-20", "2026-09-19", "2026-10-02", "2026-10-09"),
    ("P2026-21", "2026-10-03", "2026-10-16", "2026-10-23"),
]
DEPARTMENTS = ["Head Office", "Finance", "Payroll", "People and Culture", "Information Technology",
               "Quality Assurance", "Customer Care", "Sales East", "Sales West", "Marketing",
               "Legal", "Facilities", "Procurement", "Logistics", "Research", "Training",
               "Internal Audit", "Data and Reporting", "Field Service", "Warehouse"]
TITLES = ["Analyst", "Coordinator", "Specialist", "Associate", "Advisor", "Administrator",
          "Technician", "Team Lead", "Manager", "Officer"]
PROVINCES = ["ON", "QC", "BC", "AB", "MB", "NS"]
STATES = ["NY", "WA", "MA", "IL"]


@dataclass
class Extract:
    organizations: list[dict]
    positions: list[dict]
    workers: list[dict]
    compensation: list[dict]
    pay_results: list[dict]
    pay_lines: list[dict]
    worker_trailer: dict = field(default_factory=dict)
    comp_trailer: dict = field(default_factory=dict)
    defects: list[dict] = field(default_factory=list)


def money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def generate(seed: int = SEED) -> Extract:
    rng = random.Random(seed)
    fakes = {"fr_CA": Faker("fr_CA"), "en_CA": Faker("en_CA")}
    for i, f in enumerate(fakes.values()):
        f.seed_instance(seed + i)

    organizations = [{"org_id": "ORG-01", "name": DEPARTMENTS[0], "parent_org_id": "", "cost_centre": "CC-100"}]
    for n in range(2, ORGS + 1):
        organizations.append({"org_id": f"ORG-{n:02d}", "name": DEPARTMENTS[n - 1],
                              "parent_org_id": "ORG-01", "cost_centre": f"CC-{100 + n}"})

    positions = []
    for n in range(1, PEOPLE + VACANT + 1):
        positions.append({"position_id": f"POS-{n:04d}", "org_id": rng.choice(organizations)["org_id"],
                          "title": rng.choice(TITLES), "status": "Filled" if n <= PEOPLE else "Vacant"})

    ids = sorted(rng.sample(range(1000, 99999), PEOPLE))
    workers, compensation = [], []
    for n, number in enumerate(ids):
        locale = "fr_CA" if rng.random() < 0.4 else "en_CA"
        fake = fakes[locale]
        country = "US" if rng.random() < 0.1 else "CA"
        hire = date(2008, 1, 1) + timedelta(days=rng.randrange(0, 6600))
        terminated = rng.random() < 0.1
        termination = hire + timedelta(days=rng.randrange(60, 900)) if terminated else None
        if termination and termination > date(2026, 8, 31):
            termination = date(2026, 8, 31)
        workers.append({
            "employee_id": f"{number:06d}",
            "first_name": fake.first_name(),
            "last_name": fake.last_name(),
            "birth_date": (date(1960, 1, 1) + timedelta(days=rng.randrange(0, 15000))).isoformat(),
            "personal_email": f"person{number}@example.com",
            "national_id": "0" + "".join(rng.choice("0123456789") for _ in range(8)),
            "hire_date": hire.isoformat(),
            "termination_date": termination.isoformat() if termination else "",
            "status": "T" if terminated else "A",
            "position_id": positions[n]["position_id"],
            "country": country,
            "province": rng.choice(STATES if country == "US" else PROVINCES),
        })
        frequency = rng.choices(["B", "S", "W", "M"], weights=[6, 2, 1, 1])[0]
        compensation.append({
            "employee_id": f"{number:06d}",
            "annual_salary": money(Decimal(rng.randrange(4_200_000, 12_800_000)) / 100),
            "currency": "USD" if country == "US" else "CAD",
            "pay_frequency": frequency,
            "effective_date": max(hire, date(2026, 1, 1)).isoformat(),
        })

    pay_results, pay_lines = [], []
    salary = {c["employee_id"]: (Decimal(c["annual_salary"]), c["pay_frequency"]) for c in compensation}
    for w in workers:
        if w["status"] != "A":
            continue
        annual, frequency = salary[w["employee_id"]]
        for period_id, *_ in PAY_PERIODS:
            earnings = [("REG", (annual / PERIODS_PER_YEAR[frequency]).quantize(Decimal("0.01")))]
            if rng.random() < 0.2:
                earnings.append(("OT", Decimal(rng.randrange(5000, 60000)) / 100))
            gross = sum(a for _, a in earnings)
            deductions = [("TAX", (gross * Decimal("0.22")).quantize(Decimal("0.01"))),
                          ("PEN", (gross * Decimal("0.05")).quantize(Decimal("0.01"))),
                          ("BEN", Decimal("42.50"))]
            total_deductions = sum(a for _, a in deductions)
            for code, amount in earnings:
                pay_lines.append({"employee_id": w["employee_id"], "period_id": period_id,
                                  "code": code, "kind": "earning", "amount": money(amount)})
            for code, amount in deductions:
                pay_lines.append({"employee_id": w["employee_id"], "period_id": period_id,
                                  "code": code, "kind": "deduction", "amount": money(amount)})
            pay_results.append({"employee_id": w["employee_id"], "period_id": period_id,
                                "gross": money(gross), "deductions": money(total_deductions),
                                "net": money(gross - total_deductions)})

    extract = Extract(organizations, positions, workers, compensation, pay_results, pay_lines)
    seed_defects(extract, rng)
    extract.worker_trailer = {"count": len(extract.workers) + 1,  # D-09: one more than the rows
                              "hash_total": sum(int(w["employee_id"]) for w in extract.workers)}
    extract.comp_trailer = {"count": len(extract.compensation),
                            "hash_total": money(sum(Decimal(c["annual_salary"]) for c in extract.compensation))}
    return extract


def seed_defects(x: Extract, rng: random.Random) -> None:
    """Break chosen rows on purpose. Each worker-level defect gets its own worker, and pay or
    compensation defects never land on those workers, so every defect has one cause."""
    used: set[str] = set()

    def pick(predicate=lambda w: True) -> dict:
        choices = [w for w in x.workers if w["employee_id"] not in used and w["status"] == "A" and predicate(w)]
        w = rng.choice(choices)
        used.add(w["employee_id"])
        return w

    def note(defect_id, kind, rule, file, key, field, description, row=None):
        x.defects.append({"id": defect_id, "type": kind, "rule": rule, "file": file, "key": key,
                          "field": field, "description": description, "_row": row})

    def has_accent(text: str) -> bool:
        return any(ord(c) > 127 for c in text)

    w = pick(); w["last_name"] = ""
    note("D-01", "missing required field", "REQUIRED", "workers.csv", w["employee_id"], "last_name", "Last name is blank", w)
    w = pick(); w["last_name"] = ""
    note("D-02", "missing required field", "REQUIRED", "workers.csv", w["employee_id"], "last_name", "Last name is blank", w)
    w = pick(); w["hire_date"] = ""
    note("D-03", "missing required field", "REQUIRED", "workers.csv", w["employee_id"], "hire_date", "Hire date is blank", w)
    w = pick(); w["hire_date"] = "2019-02-31"
    note("D-04", "bad date", "DATE_INVALID", "workers.csv", w["employee_id"], "hire_date", "31 February does not exist", w)
    w = pick(); w["hire_date"] = "15/03/2021"
    note("D-05", "bad date", "DATE_INVALID", "workers.csv", w["employee_id"], "hire_date", "Day-first date, not YYYY-MM-DD", w)
    w = pick(); hire = date.fromisoformat(w["hire_date"])
    w["status"], w["termination_date"] = "T", (hire - timedelta(days=30)).isoformat()
    note("D-06", "bad date", "DATE_ORDER", "workers.csv", w["employee_id"], "termination_date", "Terminated 30 days before the hire date", w)

    # Rehires entered twice: a second row with the same employee ID and a later hire date.
    for defect_id in ("D-07", "D-08"):
        w = pick()
        again = dict(w, hire_date=(date.fromisoformat(w["hire_date"]) + timedelta(days=400)).isoformat())
        x.workers.insert(x.workers.index(w) + 1, again)
        note(defect_id, "duplicate ID", "DUPLICATE_ID", "workers.csv", w["employee_id"], "employee_id",
             "Same employee ID on two rows (a rehire entered twice)", w)

    note("D-09", "mismatched totals", "CONTROL_TOTAL", "workers.csv", "TRAILER", "count",
         "Trailer says 201 records; the file has 200")

    # Pay results whose totals do not match their lines (on workers with no other defect).
    for defect_id, field_name, change, description in (
            ("D-10", "gross", Decimal("0.01"), "Gross is 0.01 more than the sum of its earnings lines"),
            ("D-11", "net", Decimal("-25.00"), "Net is 25.00 less than gross minus deductions")):
        w = pick()
        result = next(r for r in x.pay_results if r["employee_id"] == w["employee_id"] and r["period_id"] == "P2026-20")
        result[field_name] = money(Decimal(result[field_name]) + change)
        if field_name == "gross":   # the old system worked net out from the wrong gross
            result["net"] = money(Decimal(result["net"]) + change)
        note(defect_id, "mismatched totals", "PAY_TOTAL", "payroll.sql", f"{w['employee_id']}/P2026-20", field_name, description)

    vacant = [p for p in x.positions if p["status"] == "Vacant"]
    for defect_id, org in (("D-12", "ORG-99"), ("D-13", "ORG-21")):
        p = rng.choice([p for p in vacant if not p["org_id"].startswith("ORG-9") and p["org_id"] != "ORG-21"])
        p["org_id"] = org
        note(defect_id, "orphaned position", "REF_ORG", "positions.csv", p["position_id"], "org_id",
             f"Organization {org} does not exist", p)
    w = pick(); w["position_id"] = "POS-9999"
    note("D-14", "orphaned position", "REF_POSITION", "workers.csv", w["employee_id"], "position_id",
         "Position POS-9999 does not exist", w)

    # A spreadsheet saved the ID as a number: 001234 became 1234.
    for defect_id in ("D-15", "D-16"):
        w = pick()
        c = next(c for c in x.compensation if c["employee_id"] == w["employee_id"])
        c["employee_id"] = str(int(c["employee_id"]))
        note(defect_id, "lost leading zeros", "ID_FORMAT", "compensation.csv", c["employee_id"], "employee_id",
             f"Employee ID {w['employee_id']} lost its leading zeros", c)

    # UTF-8 read as Windows-1252 once somewhere upstream: é becomes Ã©.
    for defect_id, field_name in (("D-17", "first_name"), ("D-18", "last_name")):
        w = pick(lambda w, f=field_name: has_accent(w[f]))
        w[field_name] = w[field_name].encode("utf-8").decode("cp1252", errors="replace")
        note(defect_id, "garbled accented name", "ENCODING", "workers.csv", w["employee_id"], field_name,
             "Accented name double-encoded (UTF-8 read as Windows-1252)", w)

    w = pick()
    c = next(c for c in x.compensation if c["employee_id"] == w["employee_id"])
    c["pay_frequency"] = "2W"
    note("D-19", "invalid code", "CODE_UNKNOWN", "compensation.csv", w["employee_id"], "pay_frequency",
         "Pay frequency 2W is not in the mapping table", c)
    w = pick(); w["country"] = "CAN"
    note("D-20", "invalid code", "CODE_UNKNOWN", "workers.csv", w["employee_id"], "country",
         "Country CAN is not in the mapping table (CA expected)", w)


def to_csv(columns: list[str], rows: list[dict], trailer: dict | None = None) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    if trailer:
        csv.writer(out, lineterminator="\n").writerow(["TRAILER", trailer["count"], trailer["hash_total"]])
    return out.getvalue()


def to_sql(x: Extract) -> str:
    lines = [
        "-- Legacy payroll history (fake data). Built into SQLite by hcm_conv.extract.",
        "CREATE TABLE pay_periods (period_id TEXT PRIMARY KEY, period_start TEXT, period_end TEXT, pay_date TEXT);",
        "CREATE TABLE pay_results (employee_id TEXT, period_id TEXT, gross TEXT, deductions TEXT, net TEXT);",
        "CREATE TABLE pay_lines (employee_id TEXT, period_id TEXT, code TEXT, kind TEXT, amount TEXT);",
    ]
    for p in PAY_PERIODS:
        lines.append("INSERT INTO pay_periods VALUES (%s);" % ", ".join(f"'{v}'" for v in p))
    for r in x.pay_results:
        lines.append("INSERT INTO pay_results VALUES ('{employee_id}', '{period_id}', '{gross}', '{deductions}', '{net}');".format(**r))
    for r in x.pay_lines:
        lines.append("INSERT INTO pay_lines VALUES ('{employee_id}', '{period_id}', '{code}', '{kind}', '{amount}');".format(**r))
    return "\n".join(lines) + "\n"


def render(x: Extract) -> dict[str, str]:
    """Every file of the extract as text, keyed by file name."""
    row_of = {}
    for name, rows in (("workers.csv", x.workers), ("positions.csv", x.positions), ("compensation.csv", x.compensation)):
        for i, row in enumerate(rows):
            row_of[(name, id(row))] = i + 2   # line 1 is the header
    defects = []
    for d in x.defects:
        d = dict(d)
        row = d.pop("_row")
        d["line"] = row_of.get((d["file"], id(row))) if row is not None else None
        if d["file"] == "workers.csv" and d["key"] == "TRAILER":
            d["line"] = len(x.workers) + 2
        defects.append(d)
    return {
        "organizations.csv": to_csv(ORG_COLUMNS, x.organizations),
        "positions.csv": to_csv(POSITION_COLUMNS, x.positions),
        "workers.csv": to_csv(WORKER_COLUMNS, x.workers, x.worker_trailer),
        "compensation.csv": to_csv(COMP_COLUMNS, x.compensation, x.comp_trailer),
        "payroll.sql": to_sql(x),
        "defects.json": json.dumps(defects, indent=2, ensure_ascii=False) + "\n",
    }


def write(out_dir: Path = LEGACY_DIR, seed: int = SEED) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, text in render(generate(seed)).items():
        (out_dir / name).write_bytes(text.encode("utf-8"))


def payroll_db(sql_text: str) -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(sql_text)
    return db


if __name__ == "__main__":
    write(Path(sys.argv[1]) if len(sys.argv) > 1 else LEGACY_DIR)
