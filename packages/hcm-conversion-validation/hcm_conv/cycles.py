"""Run mock conversion cycles 1 to 3, each into an empty tenant, and compare each with the last."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import convert, extract, reconcile
from .convert import Conversion, Finding
from .extract import FIXES_DIR, LEGACY_DIR


@dataclass
class Deltas:
    new: list[Finding] = field(default_factory=list)
    fixed: list[Finding] = field(default_factory=list)
    still_open: list[Finding] = field(default_factory=list)
    accepted: list[Finding] = field(default_factory=list)   # still there, but signed off

    def summary(self) -> str:
        return (f"{len(self.new)} new, {len(self.fixed)} fixed, {len(self.still_open)} still open"
                + (f", {len(self.accepted)} accepted" if self.accepted else ""))


@dataclass
class Cycle:
    number: int
    conversion: Conversion
    reconciliation: reconcile.Reconciliation
    deltas: Deltas | None

    @property
    def findings(self) -> list[Finding]:
        return self.conversion.findings + self.reconciliation.findings

    def errors(self, status: str | None = None) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error" and (status is None or f.status == status)]

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.reconciliation.checks)


def accepted_for(cycle: int, fixes_dir: Path = FIXES_DIR) -> list[dict]:
    items = yaml.safe_load((fixes_dir / "accepted.yaml").read_text(encoding="utf-8"))["accepted"]
    return [a for a in items if a["from_cycle"] <= cycle]


def deltas(previous: list[Finding], current: list[Finding]) -> Deltas:
    """By ident (rule, file, key, field), so a duplicate pair counts once and a moved line still matches."""
    def first_by_ident(findings):
        out = {}
        for f in findings:
            out.setdefault(f.ident(), f)
        return out
    before, now = first_by_ident(previous), first_by_ident(current)
    still = [f for i, f in now.items() if i in before]
    return Deltas(new=[f for i, f in now.items() if i not in before],
                  fixed=[f for i, f in before.items() if i not in now],
                  still_open=[f for f in still if f.status == "Open"],
                  accepted=[f for f in still if f.status == "Accepted"])


def run(client, cycles=(1, 2, 3), legacy_dir: Path = LEGACY_DIR, fixes_dir: Path = FIXES_DIR) -> list[Cycle]:
    results: list[Cycle] = []
    for n in cycles:
        source = extract.load_cycle(n, legacy_dir, fixes_dir)
        conversion = convert.convert(source)
        convert.accept(conversion.findings, accepted_for(n, fixes_dir))
        rec = reconcile.reconcile(client, conversion, source)
        cycle = Cycle(n, conversion, rec, None)
        if results:
            cycle.deltas = deltas(results[-1].errors(), cycle.errors())
        results.append(cycle)
    return results
