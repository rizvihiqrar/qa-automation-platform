"""Read the legacy extract, and apply the data team's fixes for a later cycle.

A conversion runs several mock cycles. Between them the data team cleans the old data, and
fixes/cycleN.yaml records what they changed. Cycle N starts from the raw extract and applies
the fixes of cycles 2 to N in order, so a defect can be followed from one cycle to the next.
"""
from __future__ import annotations

import csv
import io
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .legacy import LEGACY_DIR, payroll_db

FIXES_DIR = Path(__file__).resolve().parents[1] / "fixes"
CSV_FILES = ["organizations.csv", "positions.csv", "workers.csv", "compensation.csv"]


@dataclass
class Row:
    file: str
    line: int | None          # line in the original file; None for a row added by a fix
    data: dict


@dataclass
class Source:
    rows: dict[str, list[Row]]
    trailers: dict[str, dict] = field(default_factory=dict)
    payroll: sqlite3.Connection | None = None

    def table(self, name: str) -> list[Row]:
        return self.rows[name]


def parse_csv(name: str, text: str) -> tuple[list[Row], dict | None]:
    rows, trailer = [], None
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    for line, values in enumerate(reader, start=2):
        if values and values[0] == "TRAILER":
            trailer = {"count": int(values[1]), "hash_total": values[2], "line": line}
            continue
        rows.append(Row(name, line, dict(zip(header, values))))
    return rows, trailer


def read(legacy_dir: Path = LEGACY_DIR) -> Source:
    source = Source(rows={})
    for name in CSV_FILES:
        rows, trailer = parse_csv(name, (legacy_dir / name).read_text(encoding="utf-8"))
        source.rows[name] = rows
        if trailer:
            source.trailers[name] = trailer
    source.payroll = payroll_db((legacy_dir / "payroll.sql").read_text(encoding="utf-8"))
    return source


def fixes_for(cycle: int, fixes_dir: Path = FIXES_DIR) -> list[dict]:
    fixes = []
    for n in range(2, cycle + 1):
        fixes += yaml.safe_load((fixes_dir / f"cycle{n}.yaml").read_text(encoding="utf-8"))["fixes"]
    return fixes


def apply(source: Source, fixes: list[dict]) -> Source:
    for fix in fixes:
        if "sql" in fix:
            changed = source.payroll.execute(fix["sql"]).rowcount
            if changed != 1:
                raise ValueError(f"fix for {fix.get('defect')} changed {changed} payroll rows, expected 1")
        elif "trailer" in fix:
            source.trailers[fix["file"]].update(fix["trailer"])
        elif "add" in fix:
            source.rows[fix["file"]].append(Row(fix["file"], None, dict(fix["add"])))
        else:
            rows = source.rows[fix["file"]]
            hits = [r for r in rows if all(r.data.get(k) == v for k, v in fix["match"].items())]
            if len(hits) != 1:
                raise ValueError(f"fix for {fix.get('defect')} matched {len(hits)} rows in {fix['file']}, expected 1")
            if fix.get("delete"):
                rows.remove(hits[0])
            else:
                hits[0].data.update(fix["set"])
    return source


def load_cycle(cycle: int, legacy_dir: Path = LEGACY_DIR, fixes_dir: Path = FIXES_DIR) -> Source:
    return apply(read(legacy_dir), fixes_for(cycle, fixes_dir))
