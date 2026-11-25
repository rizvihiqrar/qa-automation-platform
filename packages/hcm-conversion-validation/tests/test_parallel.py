"""The payroll parallel: the engine, runs 1 and 2, and the rule that every gap is proven."""
import shutil
from decimal import Decimal

import pytest
import yaml
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from hcm_conv import __main__ as cli
from hcm_conv import cycles, extract, parallel, reconcile
from hcm_conv.extract import FIXES_DIR
from hcm_conv.mock_api import create_app

D = Decimal


@pytest.fixture(scope="module")
def loaded():
    """The target after cycle 3, and the cycle 3 source the legacy pay comes from."""
    with TestClient(create_app()) as client:
        assert cycles.run(client)[-1].passed
        return reconcile.read_target(client), extract.load_cycle(3)


@pytest.fixture(scope="module")
def runs(loaded):
    target, source = loaded
    return [parallel.run(target, source, n) for n in (1, 2)]


def check(r, name):
    return next(c for c in r.checks if c.name == name)


def comp(annual, frequency="Biweekly"):
    return {"worker_id": "001234", "annual_amount": annual, "frequency": frequency}


def fixed_rules():
    rules = parallel.RULES
    for change in yaml.safe_load((FIXES_DIR / "parallel.yaml").read_text(encoding="utf-8"))["runs"][2]:
        rules = parallel.with_setting(rules, change["setting"], change["value"])
    return rules


@pytest.mark.req("PA-01")
def test_one_payslip_worked_out_by_hand():
    slip = parallel.pay(parallel.RULES, comp("65000.00"), None)
    assert slip == {"REG": D("2500.00"), "TAX": D("550.00"), "PEN": D("125.00"), "BEN": D("42.50"),
                    "gross": D("2500.00"), "deductions": D("717.50"), "net": D("1782.50")}


@pytest.mark.req("PA-01")
def test_overtime_is_paid_only_where_the_pay_group_has_it():
    assert "OT" not in parallel.pay(parallel.RULES, comp("52000.00", "Weekly"), D("120.00"))   # as built
    slip = parallel.pay(fixed_rules(), comp("52000.00", "Weekly"), D("120.00"))
    assert slip["OT"] == D("120.00") and slip["gross"] == D("1120.00")


@pytest.mark.req("PA-01")
def test_half_a_cent_rounds_up_in_the_new_engine_and_to_even_in_the_legacy_one():
    monthly = comp("12001.20", "Monthly")   # 1000.10 a month; pension 5% = 50.005
    assert parallel.pay(parallel.RULES, monthly, None)["PEN"] == D("50.01")
    assert parallel.pay(parallel.with_setting(parallel.RULES, "rounding", "half_even"), monthly, None)["PEN"] == D("50.00")


@pytest.mark.req("PA-01")
def test_a_setting_change_is_a_copy_and_must_name_a_real_setting():
    changed = parallel.with_setting(parallel.RULES, "pay_groups.Semimonthly.periods_per_year", 24)
    assert changed["pay_groups"]["Semimonthly"]["periods_per_year"] == 24
    assert parallel.RULES["pay_groups"]["Semimonthly"]["periods_per_year"] == 26
    with pytest.raises(KeyError):
        parallel.with_setting(parallel.RULES, "pay_groups.Semimonthly.periods", 24)


@pytest.mark.req("PA-02")
def test_every_loaded_pay_result_is_paid_again(loaded, runs):
    target, _ = loaded
    assert all(r.payslips == len(target["Pay Results"]) == 537 for r in runs)
    assert check(runs[0], "Every pay result has compensation in the target").passed


@pytest.mark.req("PA-04", "PA-06")
def test_run_1_finds_exactly_the_two_setup_mistakes(loaded, runs):
    target, source = loaded
    frequency = {c["worker_id"]: c["frequency"] for c in target["Compensation"]}
    paid = {r["worker_id"] for r in target["Pay Results"]}
    overtime = {w for (w,) in source.payroll.execute("SELECT DISTINCT employee_id FROM pay_lines WHERE code = 'OT'")}
    semimonthly = {w for w in paid if frequency[w] == "Semimonthly"}
    weekly_ot = {w for w in paid & overtime if frequency[w] == "Weekly"}
    assert semimonthly and weekly_ot

    unexplained = runs[0].unexplained()
    assert {d.worker for d in unexplained} == semimonthly | weekly_ot
    # PP-01: every semimonthly payslip pays 24/26 of the regular pay
    assert {(d.worker, d.period) for d in unexplained if d.item == "REG"} == \
        {(r["worker_id"], r["period_id"]) for r in target["Pay Results"] if r["worker_id"] in semimonthly}
    # PP-02: each weekly overtime line is missing in the new system
    ot = [d for d in unexplained if d.item == "OT"]
    assert {d.worker for d in ot} == weekly_ot and all(d.legacy and d.new is None for d in ot)
    assert not runs[0].passed and not check(runs[0], "Every difference is explained").passed


@pytest.mark.req("PA-04", "PA-05", "PA-06")
def test_run_2_explains_every_difference_with_rounding(runs):
    r = runs[1]
    assert r.passed and not r.unexplained()
    assert len(r.explained()) == 118 and {d.explained_by for d in r.explained()} == {"EX-01"}
    assert all(abs(d.gap) <= parallel.ROUNDING_LIMIT[d.item] for d in r.differences)
    assert {d.item for d in r.differences} == {"REG", "TAX", "PEN", "gross", "deductions", "net"}


@pytest.mark.req("PA-06")
def test_net_pay_per_period_differs_by_exactly_the_explained_cents(runs):
    r = runs[1]
    for period, (old, new) in r.totals.items():
        assert new - old == sum(d.gap for d in r.differences if d.period == period and d.item == "net")
    assert r.totals["P2026-19"][0] == D("485825.51")


def copy_fixes(tmp_path, edit):
    for path in FIXES_DIR.iterdir():
        shutil.copy(path, tmp_path / path.name)
    plan = yaml.safe_load((tmp_path / "parallel.yaml").read_text(encoding="utf-8"))
    edit(plan)
    (tmp_path / "parallel.yaml").write_text(yaml.safe_dump(plan), encoding="utf-8")
    return tmp_path


@pytest.mark.req("PA-04")
def test_an_explanation_that_does_not_replay_explains_nothing(loaded, tmp_path):
    def nothing(plan):
        plan["explained"][0]["value"] = "half_up"   # the engine's own rounding: changes no amount
    r = parallel.run(*loaded, 2, copy_fixes(tmp_path, nothing))
    assert len(r.unexplained()) == 118 and not r.explained() and not r.passed


@pytest.mark.req("PA-05")
def test_a_real_gap_is_never_signed_off_as_rounding(loaded, tmp_path):
    def cover(plan):   # sign off the semimonthly mistake as an "explanation"
        plan["explained"].append({"id": "EX-99", "setting": "pay_groups.Semimonthly.periods_per_year", "value": 24})
    r = parallel.run(*loaded, 1, copy_fixes(tmp_path, cover))
    assert any(d.explained_by == "EX-99" for d in r.differences)
    guard = check(r, "Explained differences are rounding sized")
    assert not guard.passed and "larger than a cent" in guard.detail


@pytest.mark.req("PA-02")
def test_a_pay_result_without_compensation_fails_the_run(loaded):
    target, source = loaded
    missing = target["Pay Results"][0]["worker_id"]
    trimmed = dict(target, Compensation=[c for c in target["Compensation"] if c["worker_id"] != missing])
    r = parallel.run(trimmed, source, 2)
    c = check(r, "Every pay result has compensation in the target")
    assert not c.passed and missing in c.detail


@pytest.mark.req("PA-03")
def test_a_pay_result_the_legacy_system_never_paid_fails_the_run_without_crashing(loaded):
    target, source = loaded
    extra = dict(target["Pay Results"][0], period_id="P2026-99")
    r = parallel.run(dict(target, **{"Pay Results": target["Pay Results"] + [extra]}), source, 2)
    c = check(r, "Every pay result was paid by the legacy system")
    assert not c.passed and f"{extra['worker_id']}/P2026-99" in c.detail
    assert not r.passed and not r.unexplained()


@pytest.mark.req("PA-06")
def test_run_all_does_each_run_once(loaded, tmp_path):
    def also_run_1(plan):
        plan["runs"][1] = []
    with TestClient(create_app()) as client:
        cycles.run(client)
        runs = parallel.run_all(client, loaded[1], copy_fixes(tmp_path, also_run_1))
    assert [r.number for r in runs] == [1, 2]


@pytest.mark.req("PA-06")
def test_the_command_writes_both_workbooks_and_passes_on_run_2(tmp_path, capsys):
    assert cli.main(["parallel", "--out", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "FAIL  Every difference is explained: 690 unexplained, on 44 workers" in out
    assert "PASS  Every difference is explained: 118 differences" in out
    one = load_workbook(tmp_path / "parallel_run1.xlsx")["Differences"]
    two = load_workbook(tmp_path / "parallel_run2.xlsx")["Differences"]
    assert [c.value for c in one[1]] == ["Worker", "Period", "Item", "Legacy", "New", "Gap", "Explained by"]
    assert one.cell(2, 7).value == "UNEXPLAINED"      # the unexplained ones come first
    assert two.max_row == 1 + 118 and {two.cell(r, 7).value for r in range(2, two.max_row + 1)} == {"EX-01"}
