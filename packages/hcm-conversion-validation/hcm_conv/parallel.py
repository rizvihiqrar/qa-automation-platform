"""The payroll parallel: the new system pays the last three legacy pay periods again.

The new engine reads the converted compensation from the target (the compensation report) and
the overtime that was entered for each period (the time entries both systems got), works out
every pay line with its own setup (payroll.yaml), and each line is compared with the line the
legacy system paid:

  earnings     REG (annual amount / pay periods in the year), OT
  deductions   TAX, PEN, BEN
  totals       gross, deductions, net

Every difference must be explained, to the cent. An explanation is a setting the payroll
manager signed off (fixes/parallel.yaml); it explains a difference only if the engine, run
again with that setting, gives exactly the legacy amount. So an explanation is proven on every
line it covers, never assumed. A difference nothing explains fails the run.

Run 1 uses the setup as it was built. Run 2 adds the setup changes made after run 1.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal
from pathlib import Path

import yaml
from openpyxl import Workbook
from openpyxl.styles import Font

from . import reconcile
from .extract import FIXES_DIR, Source
from .report import FILL, table, widen

ROOT = Path(__file__).resolve().parents[1]
RULES = yaml.safe_load((ROOT / "payroll.yaml").read_text(encoding="utf-8"))
CENT = Decimal("0.01")
ROUNDING = {"half_up": ROUND_HALF_UP, "half_even": ROUND_HALF_EVEN}
EARNINGS = ("REG", "OT")
DEDUCTIONS = ("TAX", "PEN", "BEN")
TOTALS = ("gross", "deductions", "net")
ITEMS = EARNINGS + DEDUCTIONS + TOTALS
# Rounding moves a line by at most a cent, so an item can move by a cent per rounded line in it:
# gross holds REG, deductions hold TAX and PEN, net holds all three. OT and BEN are not rounded.
ROUNDING_LIMIT = {"REG": CENT, "TAX": CENT, "PEN": CENT, "gross": CENT, "deductions": 2 * CENT,
                  "net": 3 * CENT, "OT": Decimal(0), "BEN": Decimal(0)}


def with_setting(rules: dict, setting: str, value) -> dict:
    """A copy of the setup with one setting changed; the setting must already exist."""
    out = copy.deepcopy(rules)
    *path, last = setting.split(".")
    node = out
    for part in path:
        node = node[part]
    if last not in node:
        raise KeyError(f"payroll.yaml has no setting {setting}")
    node[last] = value
    return out


def pay(rules: dict, comp: dict, overtime: Decimal | None) -> dict[str, Decimal]:
    """One payslip: every line and total, keyed by item. A line that is not paid is left out."""
    group = rules["pay_groups"][comp["frequency"]]
    rounding = ROUNDING[rules["rounding"]]

    def cents(value: Decimal) -> Decimal:
        return value.quantize(CENT, rounding=rounding)

    slip = {"REG": cents(Decimal(comp["annual_amount"]) / group["periods_per_year"])}
    if overtime is not None and "OT" in group["earnings"]:
        slip["OT"] = overtime
    gross = sum(slip[c] for c in EARNINGS if c in slip)
    for code, rule in rules["deductions"].items():
        slip[code] = cents(gross * Decimal(rule["rate"])) if "rate" in rule else Decimal(rule["amount"])
    deductions = sum(slip[c] for c in DEDUCTIONS)
    slip.update(gross=gross, deductions=deductions, net=gross - deductions)
    return slip


@dataclass
class Difference:
    worker: str
    period: str
    item: str
    legacy: Decimal | None
    new: Decimal | None
    explained_by: str | None = None

    @property
    def gap(self) -> Decimal:
        return (self.new or Decimal(0)) - (self.legacy or Decimal(0))


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


@dataclass
class Run:
    number: int
    changes: list[dict]
    payslips: int
    lines: int
    differences: list[Difference] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    totals: dict[str, tuple[Decimal, Decimal]] = field(default_factory=dict)   # period: (legacy net, new net)

    def unexplained(self) -> list[Difference]:
        return [d for d in self.differences if d.explained_by is None]

    def explained(self) -> list[Difference]:
        return [d for d in self.differences if d.explained_by]

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)


def legacy_pay(source: Source) -> dict[tuple[str, str], dict[str, Decimal]]:
    """What the legacy system paid: its pay lines, and its totals from the pay results."""
    paid: dict[tuple[str, str], dict[str, Decimal]] = {}
    for worker, period, code, amount in source.payroll.execute(
            "SELECT employee_id, period_id, code, amount FROM pay_lines"):
        paid.setdefault((worker, period), {})[code] = Decimal(amount)
    for worker, period, gross, deductions, net in source.payroll.execute(
            "SELECT employee_id, period_id, gross, deductions, net FROM pay_results"):
        paid.setdefault((worker, period), {}).update(
            gross=Decimal(gross), deductions=Decimal(deductions), net=Decimal(net))
    return paid


def compare(worker: str, period: str, legacy: dict, new: dict) -> list[Difference]:
    return [Difference(worker, period, item, legacy.get(item), new.get(item))
            for item in ITEMS if legacy.get(item) != new.get(item)]


def run(target: dict[str, list[dict]], source: Source, number: int,
        fixes_dir: Path = FIXES_DIR, rules: dict = RULES) -> Run:
    """One parallel run against a target that holds the converted records."""
    plan = yaml.safe_load((fixes_dir / "parallel.yaml").read_text(encoding="utf-8"))
    changes = [c for n, items in sorted((plan.get("runs") or {}).items()) if n <= number for c in items or []]
    for change in changes:
        rules = with_setting(rules, change["setting"], change["value"])
    explanations = [(e, with_setting(rules, e["setting"], e["value"])) for e in plan["explained"]]

    comp = {r["worker_id"]: r for r in target["Compensation"]}
    paid = legacy_pay(source)
    population = sorted((r["worker_id"], r["period_id"]) for r in target["Pay Results"])
    result = Run(number, changes, len(population), 0)
    missing = [f"{w}/{p}" for w, p in population if w not in comp]
    unpaid = [f"{w}/{p}" for w, p in population if "net" not in paid.get((w, p), {})]
    nets: dict[str, list[Decimal]] = {}

    for worker, period in population:
        if worker not in comp or "net" not in paid.get((worker, period), {}):
            continue
        overtime = paid[(worker, period)].get("OT")
        slip = pay(rules, comp[worker], overtime)
        legacy = paid[(worker, period)]
        result.lines += len(set(slip) | set(legacy))
        for d in compare(worker, period, legacy, slip):
            for e, alternative in explanations:
                if pay(alternative, comp[worker], overtime).get(d.item) == d.legacy:
                    d.explained_by = e["id"]
                    break
            result.differences.append(d)
        legacy_net, new_net = nets.setdefault(period, [Decimal(0), Decimal(0)])
        nets[period] = [legacy_net + legacy["net"], new_net + slip["net"]]
    result.totals = {p: tuple(v) for p, v in sorted(nets.items())}

    result.checks.append(Check("Every pay result has compensation in the target", not missing,
                               f"{len(missing)} without: {', '.join(missing)}" if missing else
                               f"all {len(population)} pay results"))
    result.checks.append(Check("Every pay result was paid by the legacy system", not unpaid,
                               f"{len(unpaid)} with no legacy pay result: {', '.join(unpaid)}" if unpaid else
                               f"all {len(population)} pay results"))
    unexplained = result.unexplained()
    workers = sorted({d.worker for d in unexplained})
    result.checks.append(Check("Every difference is explained", not unexplained,
                               f"{len(unexplained)} unexplained, on {len(workers)} workers" if unexplained else
                               f"{len(result.explained())} differences, each one proven by its explanation"))
    # A guard: an explanation must never cover a real gap, even if a setting happens to replay it.
    big = [d for d in result.explained() if abs(d.gap) > ROUNDING_LIMIT[d.item]]
    result.checks.append(Check("Explained differences are rounding sized", not big,
                               f"{len(big)} explained differences are larger than a cent per rounded line" if big else
                               "at most a cent per rounded line: REG, TAX, PEN and gross 0.01, deductions 0.02, net 0.03"))
    return result


def run_all(client, source: Source, fixes_dir: Path = FIXES_DIR) -> list[Run]:
    """Parallel runs 1 and 2, against the target the client is connected to."""
    target = reconcile.read_target(client)
    plan = yaml.safe_load((fixes_dir / "parallel.yaml").read_text(encoding="utf-8"))
    return [run(target, source, n, fixes_dir) for n in sorted({1, *(plan.get("runs") or {})})]


def write(r: Run, path: Path) -> Path:
    """The parallel workbook: Summary (checks, net pay per period, changes) and Differences."""
    book = Workbook()
    ws = book.active
    ws.title = "Summary"
    ws.append([f"Payroll parallel run {r.number} (fake data; not affiliated with any HR vendor)"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([f"{r.payslips} payslips, {r.lines} pay lines compared. Differences: "
               f"{len(r.unexplained())} unexplained, {len(r.explained())} explained."])
    ws.append([])
    table(ws, ["Check", "Result", "Detail"], [[c.name, "PASS" if c.passed else "FAIL", c.detail] for c in r.checks])
    for row in ws.iter_rows(min_row=5, max_row=ws.max_row):
        row[1].fill = FILL[row[1].value]
    ws.append([])
    table(ws, ["Period", "Legacy net", "New net", "Difference"],
          [[p, float(old), float(new), float(new - old)] for p, (old, new) in r.totals.items()])
    ws.append([])
    table(ws, ["Setup change", "Setting", "Value", "Reason"],
          [[c["issue"], c["setting"], str(c["value"]), c["reason"]] for c in r.changes] or [["(none: the setup as built)"]])
    widen(ws)
    ws.column_dimensions["A"].width = 44

    ds = book.create_sheet("Differences")
    rows = sorted(r.differences, key=lambda d: (d.explained_by is not None, d.worker, d.period, ITEMS.index(d.item)))
    table(ds, ["Worker", "Period", "Item", "Legacy", "New", "Gap", "Explained by"],
          [[d.worker, d.period, d.item, None if d.legacy is None else float(d.legacy),
            None if d.new is None else float(d.new), float(d.gap), d.explained_by or "UNEXPLAINED"] for d in rows])
    ds.freeze_panes = "A2"
    ds.auto_filter.ref = ds.dimensions
    widen(ds)
    path.parent.mkdir(parents=True, exist_ok=True)
    book.save(path)
    return path
