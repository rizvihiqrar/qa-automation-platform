"""The defect log and the go or no-go readiness report: worked out from the evidence, strict, and
the committed examples are what the code builds."""
import json
import shutil
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from hcm_conv import __main__ as cli
from hcm_conv import defects, readiness, trace
from hcm_conv.extract import FIXES_DIR
from hcm_conv.legacy import LEGACY_DIR
from hcm_conv.mock_api import create_app

PLAN = trace.load_plan()
DOCS = trace.ROOT / "docs"


@pytest.fixture(scope="module")
def evidence():
    with TestClient(create_app()) as client:
        return readiness.gather(client, b"test-only-key")


def log_at(evidence, cycle, run):
    cs, rs = readiness.at(evidence, cycle, run)
    return defects.log(cs, rs)


def decide_at(evidence, cycle, run, matrix=None, mask_checks=None, fixes_dir=FIXES_DIR):
    cs, rs = readiness.at(evidence, cycle, run)
    return readiness.decide(cs, rs, evidence.mask_checks if mask_checks is None else mask_checks,
                            readiness.all_passing(PLAN) if matrix is None else matrix, defects.log(cs, rs), fixes_dir)


def results(r):
    return [c.passed for c in r.criteria]


# QR-04: the defect log

@pytest.mark.req("QR-04")
def test_the_log_at_the_last_checkpoint_has_every_defect_closed_or_accepted(evidence):
    log = log_at(evidence, 3, 2)
    assert [d.id for d in log] == [f"D-{i:02}" for i in range(1, 21)] + ["N-01", "PP-01", "PP-02", "EX-01"]
    assert defects.counts(log) == {"Open": 0, "Closed": 21, "Accepted": 3}
    assert {d.id for d in log if d.status == "Accepted"} == {"D-12", "D-13", "EX-01"}
    assert all(d.resolution for d in log)


@pytest.mark.req("QR-04")
def test_each_seeded_defect_is_found_in_cycle_1_by_its_rule_and_closed_where_its_fix_is(evidence):
    key = {d["id"]: d for d in json.loads((LEGACY_DIR / "defects.json").read_text(encoding="utf-8"))}
    fixed = defects.fixes_by_defect(FIXES_DIR, 3)
    for d in log_at(evidence, 3, 2)[:20]:
        assert (d.found_in, d.found_by) == ("Cycle 1", key[d.id]["rule"]), d.id
        if d.status == "Closed":
            assert d.closed_in == f"Cycle {fixed[d.id][0]}" and f"fixes/cycle{fixed[d.id][0]}.yaml" in d.resolution, d.id


@pytest.mark.req("QR-04")
def test_the_log_after_cycle_2_and_run_1_has_the_open_defects(evidence):
    log = log_at(evidence, 2, 1)
    still = [d.id for d in log if d.status == "Open"]
    assert still == ["D-03", "D-06", "D-08", "D-11", "D-12", "D-13", "D-14", "D-15", "D-18", "D-20", "N-01", "PP-01", "PP-02"]
    late = next(d for d in log if d.id == "N-01")   # named by the fix to come, found by the cycle it arrived in
    assert (late.found_in, late.found_by, late.where) == ("Cycle 2", "REQUIRED", "workers.csv 099501 position_id")
    assert all(not d.resolution and not d.closed_in for d in log if d.status == "Open")
    assert next(d for d in log if d.id == "D-12").status == "Open"   # signed off only from cycle 3


@pytest.mark.req("QR-04")
def test_before_cycle_2_there_is_no_late_defect_and_before_the_parallel_no_payroll_one(evidence):
    log = log_at(evidence, 1, None)
    assert len(log) == 20 and defects.counts(log)["Open"] == 20
    assert defects.checkpoint(*readiness.at(evidence, 1, None)) == "mock cycle 1, before the payroll parallel"


@pytest.mark.req("QR-04")
def test_a_defect_the_rule_never_reports_is_open_and_says_so(evidence, tmp_path):
    for f in LEGACY_DIR.iterdir():
        shutil.copy(f, tmp_path / f.name)
    key = json.loads((tmp_path / "defects.json").read_text(encoding="utf-8"))
    key.append({**key[0], "id": "D-21", "key": "000000", "description": "never reported"})
    (tmp_path / "defects.json").write_text(json.dumps(key), encoding="utf-8")
    log = defects.conversion_defects(evidence.cycles, FIXES_DIR, tmp_path)
    missed = next(d for d in log if d.id == "D-21")
    assert (missed.status, missed.found_in, missed.resolution) == ("Open", "not found", "the rule never reported it")


@pytest.mark.req("QR-04")
def test_a_setup_mistake_is_closed_only_by_a_run_that_explains_everything(evidence):
    run2 = evidence.runs[1]
    broken = replace(run2, checks=[replace(c, passed=False) if c.name == "Every difference is explained" else c
                                   for c in run2.checks])
    log = defects.payroll_defects([evidence.runs[0], broken], FIXES_DIR)
    assert [(d.id, d.status) for d in log] == [("PP-01", "Open"), ("PP-02", "Open"), ("EX-01", "Accepted")]


@pytest.mark.req("QR-04")
def test_the_defect_log_workbook(evidence, tmp_path):
    log = log_at(evidence, 3, 2)
    book = load_workbook(defects.write_workbook(log, "here", tmp_path / "log.xlsx"))
    rows = list(book["Defects"].iter_rows(min_row=5, values_only=True))
    assert len(rows) == 24 and rows[0][0] == "D-01" and rows[-1][:2] == ("EX-01", "known difference")
    assert "pay_groups.Weekly.earnings = REG, OT" in next(r[8] for r in rows if r[0] == "PP-02")


# QR-05: the readiness report

@pytest.mark.req("QR-05")
def test_the_last_checkpoint_is_go(evidence):
    r = decide_at(evidence, 3, 2)
    assert r.decision == "GO" and all(results(r))
    assert r.point == "mock cycle 3 and payroll parallel run 2"
    assert [c.name for c in r.criteria] == list(readiness.CRITERIA)
    assert [s.split(":")[0] for s in r.sign_offs] == ["D-12", "D-13", "EX-01"]


@pytest.mark.req("QR-05")
def test_after_cycle_2_and_run_1_it_is_no_go_for_four_reasons(evidence):
    r = decide_at(evidence, 2, 1)
    assert r.decision == "NO-GO"
    assert results(r) == [False, False, False, True, True, True, False]
    assert r.criteria[2].detail.startswith("run 1: 690 unexplained, 94 explained")


@pytest.mark.req("QR-05")
def test_a_failing_fault_scenario_blocks_go(evidence):
    tests = [trace.TestResult("plan", r.id, "failed" if r.id == "FS-03" else "passed", (r.id,)) for r in PLAN]
    r = decide_at(evidence, 3, 2, matrix=trace.build(PLAN, tests))
    assert results(r) == [True, True, True, True, False, False, True]
    assert r.criteria[4].detail == "5 of 6 fault scenarios passing; not passing: FS-03"
    assert "FS-03 (failing)" in r.criteria[5].detail


@pytest.mark.req("QR-05")
def test_a_requirement_with_no_tests_or_a_stray_test_blocks_go(evidence):
    tests = [trace.TestResult("plan", r.id, "passed", (r.id,)) for r in PLAN if r.id != "MK-07"]
    r = decide_at(evidence, 3, 2, matrix=trace.build(PLAN, tests))
    assert results(r)[5] is False and "MK-07 (no tests)" in r.criteria[5].detail
    stray = trace.build(PLAN, [trace.TestResult("plan", r.id, "passed", (r.id,)) for r in PLAN]
                        + [trace.TestResult("x", "y", "passed", ())])
    r = decide_at(evidence, 3, 2, matrix=stray)
    assert results(r)[5] is False and r.criteria[5].detail.endswith("1 test results outside the plan")


@pytest.mark.req("QR-05")
def test_a_failing_masking_check_or_none_at_all_blocks_go(evidence):
    bad = [replace(c, passed=False) if i == 2 else c for i, c in enumerate(evidence.mask_checks)]
    assert results(decide_at(evidence, 3, 2, mask_checks=bad))[3] is False
    none = decide_at(evidence, 3, 2, mask_checks=[])   # no checks at all is not a pass (deliberate break R4)
    assert (none.criteria[3].passed, none.criteria[3].detail, none.decision) == (False, "not run", "NO-GO")


@pytest.mark.req("QR-05")
def test_no_parallel_run_or_no_test_results_blocks_go(evidence):
    cs, _ = readiness.at(evidence, 3, None)
    r = readiness.decide(cs, [], evidence.mask_checks, None, defects.log(cs, []))
    assert results(r) == [True, True, False, True, False, False, True]
    assert {c.detail for c in r.criteria if not c.passed} == {"not run yet", "no test results given"}


@pytest.mark.req("QR-05", "CY-04")
def test_an_accepted_exception_nobody_signed_off_blocks_go(evidence, tmp_path):
    shutil.copytree(FIXES_DIR, tmp_path / "fixes")
    path = tmp_path / "fixes" / "accepted.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace("signed_off_by: HR data owner}", "signed_off_by: ''}", 1),
                    encoding="utf-8")
    r = decide_at(evidence, 3, 2, fixes_dir=tmp_path / "fixes")
    assert results(r)[0] is False and r.criteria[0].detail.endswith("not signed off: POS-0199")


@pytest.mark.req("QR-05")
def test_the_result_is_in_release_gates_check_shape(evidence, tmp_path):
    md, js = readiness.write(decide_at(evidence, 2, 1), tmp_path)
    data = json.loads(js.read_text(encoding="utf-8"))
    assert data["decision"] == "no-go" and data["checkpoint"] == "mock cycle 2 and payroll parallel run 1"
    assert all(set(c) == {"name", "kind", "passed", "detail"} and c["kind"] == "check" and isinstance(c["passed"], bool)
               for c in data["checks"])
    text = md.read_text(encoding="utf-8")
    assert "## Decision: NO-GO" in text and "## What blocks go" in text and "| 4 | Every masking check passes | PASS |" in text


@pytest.mark.req("QR-04", "QR-05")
@pytest.mark.parametrize("name", ["readiness-go.md", "readiness-no-go.md", "defect-log.md"])
def test_the_committed_examples_are_what_the_code_builds(evidence, name):
    built = readiness.examples(evidence, PLAN)[name]
    assert (DOCS / name).read_text(encoding="utf-8") == built, f"docs/{name} is stale: run python -m hcm_conv readiness --examples"


@pytest.mark.req("QR-05")
def test_the_command_decides_from_the_junit_files_and_sets_the_exit_code(tmp_path, capsys, monkeypatch):
    def junit(failing=()):
        cases = "".join(f'<testcase classname="plan" name="{r.id}"><properties><property name="req" value="{r.id}"/>'
                        f'</properties>{"<failure/>" if r.id in failing else ""}</testcase>' for r in PLAN)
        path = tmp_path / f"junit-{len(failing)}.xml"
        path.write_text(f"<testsuites><testsuite>{cases}</testsuite></testsuites>", encoding="utf-8")
        return str(path)
    monkeypatch.delenv("HCM_MASK_KEY", raising=False)   # any key will do: a random one
    assert cli.main(["readiness", "--junit", junit(), "--out", str(tmp_path / "go")]) == 0
    out = capsys.readouterr().out
    assert "Readiness at mock cycle 3 and payroll parallel run 2: GO" in out and out.count("  PASS  ") == 7
    assert {p.name for p in (tmp_path / "go").iterdir()} == {"readiness.md", "readiness.json", "defect-log.md", "defect-log.xlsx"}
    assert "[Readiness](readiness.md)" in (tmp_path / "go" / "defect-log.md").read_text(encoding="utf-8")   # this run's own report
    assert cli.main(["readiness", "--junit", junit(failing=("FS-05",)), "--out", str(tmp_path / "no")]) == 1
    assert "FAIL  5. Every fault scenario passes" in capsys.readouterr().out
    assert cli.main(["readiness"]) == 2
    assert cli.main(["readiness", "--junit", str(tmp_path / "missing.xml")]) == 2
    assert cli.main(["readiness", "--junit", junit(), "--examples"]) == 2


# Code review fixes

def copy_dir(src, dst):
    shutil.copytree(src, dst)
    return dst


@pytest.mark.req("QR-04")
def test_an_accepted_entry_without_a_defect_id_is_found_by_its_row(evidence, tmp_path):
    fixes = copy_dir(FIXES_DIR, tmp_path / "fixes")
    path = fixes / "accepted.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace(" defect: D-12,", "").replace(" defect: D-13,", ""),
                    encoding="utf-8")
    log = defects.conversion_defects(evidence.cycles, fixes, LEGACY_DIR)
    d12 = next(d for d in log if d.id == "D-12")
    assert d12.status == "Accepted" and "Vacant position in a closed organization" in d12.resolution


@pytest.mark.req("QR-04")
def test_two_late_defects_on_one_row_get_two_names(evidence):
    from copy import deepcopy

    from hcm_conv.convert import Finding
    cycles = deepcopy(evidence.cycles)
    extra = Finding("DATE_INVALID", "workers.csv", 202, "099501", "birth_date", "x", "is not a real date")
    cycles[1].deltas.new.append(extra)
    cycles[1].conversion.findings.append(extra)
    ids = [d.id for d in defects.conversion_defects(cycles, FIXES_DIR, LEGACY_DIR)]
    assert ids[20:] == ["N-01", "NEW-DATE_INVALID-099501-birth_date"]


@pytest.mark.req("QR-04")
def test_a_finding_on_another_field_of_the_row_is_not_the_defect(evidence, tmp_path):
    legacy = copy_dir(LEGACY_DIR, tmp_path / "legacy")
    key = json.loads((legacy / "defects.json").read_text(encoding="utf-8"))
    key[0]["field"] = "first_name"   # D-01 is a blank last_name; a first_name defect on that row was never reported
    (legacy / "defects.json").write_text(json.dumps(key), encoding="utf-8")
    d01 = defects.conversion_defects(evidence.cycles, FIXES_DIR, legacy)[0]
    assert (d01.id, d01.status, d01.found_in) == ("D-01", "Open", "not found")


@pytest.mark.req("QR-04")
def test_the_fixes_are_read_from_the_cycle_files_that_exist(tmp_path):
    fixes = tmp_path / "fixes"
    fixes.mkdir()
    shutil.copy(FIXES_DIR / "cycle2.yaml", fixes / "cycle2.yaml")
    assert defects.cycle_files(fixes) == [2]
    assert defects.fixes_by_defect(fixes)["D-01"][0] == 2
    assert defects.cycle_files(FIXES_DIR) == [2, 3]


@pytest.mark.req("QR-04")
def test_the_rounding_explanation_is_open_while_its_guard_fails(evidence):
    run2 = evidence.runs[1]
    bad = replace(run2, checks=[replace(c, passed=False) if c.name == "Explained differences are rounding sized" else c
                                for c in run2.checks])
    ex = defects.payroll_defects([evidence.runs[0], bad], FIXES_DIR)[-1]
    assert (ex.id, ex.status, ex.resolution, ex.found_in) == ("EX-01", "Open", "", "Parallel run 1")


@pytest.mark.req("QR-04")
def test_a_setup_mistake_no_run_showed_is_not_found(evidence):
    quiet = replace(evidence.runs[0], differences=[d for d in evidence.runs[0].differences if d.explained_by])
    pp = defects.payroll_defects([quiet, evidence.runs[1]], FIXES_DIR)[0]
    assert (pp.id, pp.found_in, pp.status) == ("PP-01", "not found", "Closed")


@pytest.mark.req("QR-05")
def test_no_reconciliation_checks_or_no_parallel_checks_is_not_a_pass(evidence):
    from copy import deepcopy
    cs, rs = readiness.at(evidence, 3, 2)
    cs = deepcopy(cs)
    cs[-1].reconciliation.checks = []
    rs = [rs[0], replace(rs[1], checks=[])]
    r = readiness.decide(cs, rs, evidence.mask_checks, readiness.all_passing(PLAN), defects.log(cs, rs))
    assert (r.criteria[1].passed, r.criteria[1].detail) == (False, "cycle 3: no checks ran")
    assert r.criteria[2].passed is False and r.decision == "NO-GO"


@pytest.mark.req("QR-05")
def test_a_skipped_parallel_says_why(evidence):
    cs, _ = readiness.at(evidence, 3, None)
    why = "not run: cycle 3 did not pass every check, so there is no clean load to pay from"
    r = readiness.decide(cs, [], evidence.mask_checks, readiness.all_passing(PLAN), defects.log(cs, []), parallel_skipped=why)
    assert r.criteria[2].detail == why


@pytest.mark.req("QR-05")
def test_an_early_checkpoint_says_its_run_was_paid_from_the_cycle_3_load(evidence):
    detail = decide_at(evidence, 2, 1).criteria[2].detail
    assert detail.endswith("(the parallel pays from the cycle 3 load, the first that passes every check)")
    assert "cycle 3 load" not in decide_at(evidence, 3, 2).criteria[2].detail
