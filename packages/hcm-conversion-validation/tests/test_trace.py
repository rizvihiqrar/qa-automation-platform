"""The test plan and the traceability matrix: every test names a requirement, every requirement has
a test, the plan names the rules and checks the code really reports, and the matrix shows results."""
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook

from hcm_conv import __main__ as cli
from hcm_conv import trace

ROOT = trace.ROOT
PLAN = trace.load_plan()
BY_GROUP = {}
for _r in PLAN:
    BY_GROUP.setdefault(_r.id[:2], []).append(_r)


@pytest.fixture(scope="module")
def collected(tmp_path_factory):
    """Both suites, collected but not run (no Docker): one result per test, with its requirements."""
    return trace.collect(tmp_path_factory.mktemp("collect") / "map.json")


def junit(tmp_path, cases) -> Path:
    """A JUnit file: cases = [(classname, name, outcome, [requirement IDs])]."""
    body = []
    for classname, name, outcome, reqs in cases:
        inner = "".join(f'<property name="req" value="{r}"/>' for r in reqs)
        inner = f"<properties>{inner}</properties>" if inner else ""
        inner += {"passed": "", "failed": '<failure message="x"/>', "error": '<error message="x"/>',
                  "skipped": '<skipped message="x"/>'}[outcome]
        body.append(f'<testcase classname="{classname}" name="{name}" time="0.1">{inner}</testcase>')
    path = tmp_path / f"junit-{len(list(tmp_path.glob('junit-*')))}.xml"
    path.write_text(f'<?xml version="1.0"?><testsuites><testsuite name="pytest">{"".join(body)}</testsuite></testsuites>',
                    encoding="utf-8")
    return path


def two_requirements():
    return [trace.Requirement("AA-01", "Group A", "first", None), trace.Requirement("AA-02", "Group A", "second", "Check")]


# QR-01: every test traces to the plan, and the plan has no requirement without a test

@pytest.mark.req("QR-01")
def test_every_requirement_has_at_least_one_test(collected):
    traced = {r for t in collected for r in t.requirements}
    assert [r.id for r in PLAN if r.id not in traced] == []
    assert all(t.requirements for t in collected)
    assert any(t.file.startswith("tests_faults/") for t in collected)   # both suites are in


@pytest.mark.req("QR-01")
def test_a_test_with_no_requirement_or_an_unknown_one_stops_the_run(tmp_path):
    shutil.copy(ROOT / "conftest.py", tmp_path / "conftest.py")
    (tmp_path / "test_sample.py").write_text(
        "import pytest\n\n"
        "def test_nothing_named():\n    pass\n\n"
        "@pytest.mark.req('ZZ-99')\ndef test_unknown():\n    pass\n\n"
        "@pytest.mark.req('MR-01')\ndef test_fine():\n    pass\n", encoding="utf-8")
    done = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--strict-markers", str(tmp_path)],
                          cwd=tmp_path, capture_output=True, text=True, env={**_env(), "PYTHONPATH": str(ROOT)})
    assert done.returncode == 4, done.stdout + done.stderr   # a usage error: no test ran
    assert "test_sample.py::test_nothing_named: no @pytest.mark.req(...) marker" in done.stderr
    assert "test_sample.py::test_unknown: ZZ-99 is not a requirement in docs/test-plan.md" in done.stderr
    assert "test_fine" not in done.stderr and "passed" not in done.stdout


@pytest.mark.req("QR-01", "QR-03")
def test_the_requirements_reach_the_junit_file(tmp_path):
    shutil.copy(ROOT / "conftest.py", tmp_path / "conftest.py")
    (tmp_path / "test_sample.py").write_text(
        "import pytest\n\n@pytest.mark.req('MR-01', 'MR-02')\n@pytest.mark.parametrize('n', [1, 2])\n"
        "def test_two(n):\n    assert n == 1\n", encoding="utf-8")
    xml = tmp_path / "out.xml"
    subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", f"--junitxml={xml}", str(tmp_path)],
                   cwd=tmp_path, capture_output=True, text=True, env={**_env(), "PYTHONPATH": str(ROOT)})
    results = trace.read_junit([xml])
    assert [(t.name, t.outcome, t.requirements) for t in results] == [
        ("test_two[1]", "passed", ("MR-01", "MR-02")), ("test_two[2]", "failed", ("MR-01", "MR-02"))]


def _env():
    import os
    return {k: v for k, v in os.environ.items() if k != "PYTEST_ADDOPTS"}


# QR-02: the plan and the code name the same rules and checks

def source(name: str) -> str:
    return (ROOT / "hcm_conv" / name).read_text(encoding="utf-8")


def check_names(module: str) -> set[str]:
    return set(re.findall(r'Check\(\s*"([^"]+)"', source(module)))


@pytest.mark.req("QR-02")
@pytest.mark.parametrize("group, module", [("RC", "reconcile.py"), ("PA", "parallel.py"), ("MK", "mask.py")])
def test_the_plan_names_every_check_the_code_reports(group, module):
    assert {r.check for r in BY_GROUP[group] if r.check} == check_names(module)


@pytest.mark.req("QR-02")
def test_the_plan_names_every_rule_the_code_reports():
    # Every upper-case name in convert.py is a rule, except the key a trailer finding is filed under
    rules = set(re.findall(r'"([A-Z][A-Z_]{4,})"', source("convert.py"))) - {"TRAILER"}
    assert {r.check for r in BY_GROUP["MR"] if r.check} == rules
    # The findings reconciliation adds are named in the text of the check they belong to
    recon = set(re.findall(r'Finding\(\s*"([A-Z_]+)"', source("reconcile.py")))
    assert recon == {"TARGET_REJECTED", "RECON_MISMATCH", "RECON_MISSING"}
    texts = " ".join(r.text for r in BY_GROUP["RC"])
    assert all(f"`{name}`" in texts for name in recon)


@pytest.mark.req("QR-02")
def test_each_check_is_named_by_one_requirement_only():
    names = [r.check for r in PLAN if r.check]
    assert len(names) == len(set(names))
    assert trace.requirement_for("Row hashes match") == "RC-07"
    with pytest.raises(KeyError, match="0 requirements"):
        trace.requirement_for("No such check")


@pytest.mark.req("QR-02")
def test_the_plan_parser_refuses_a_broken_plan(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text("## Requirements\n\n### A\n\n| ID | Requirement | Rule |\n|---|---|---|\n"
                    "| AA-01 | one | |\n| AA-01 | again | |\n", encoding="utf-8")
    with pytest.raises(ValueError, match="used twice: AA-01"):
        trace.load_plan(plan)
    plan.write_text("## Requirements\n\n| ID | Requirement | Rule |\n|---|---|---|\n| AA-01 | no group | |\n", encoding="utf-8")
    with pytest.raises(ValueError, match="needs a ### group"):
        trace.load_plan(plan)
    plan.write_text("## Scope\n\n| AA-01 | not a requirement section | |\n", encoding="utf-8")
    with pytest.raises(ValueError, match="no requirements"):
        trace.load_plan(plan)


@pytest.mark.req("QR-02", "QR-03")
def test_an_escaped_pipe_stays_inside_its_cell(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text("## Requirements\n\n### A\n\n| ID | Requirement | Rule |\n|---|---|---|\n"
                    "| AA-01 | count \\| sum | `A \\| B` |\n", encoding="utf-8")
    [req] = trace.load_plan(plan)
    assert (req.text, req.check) == ("count | sum", "A | B")
    assert "| AA-01 | count \\| sum |" in trace.to_markdown(trace.build([req], []), results=False)


@pytest.mark.req("QR-02")
def test_the_plan_has_every_group_in_order():
    assert list(BY_GROUP) == ["LX", "MR", "TR", "RC", "CY", "PA", "MK", "LD", "FS", "QR"]
    for reqs in BY_GROUP.values():
        assert [int(r.id[3:]) for r in reqs] == list(range(1, len(reqs) + 1))   # no gaps, no reordering


# QR-03: the matrix

@pytest.mark.req("QR-03")
def test_each_status_of_a_requirement(tmp_path):
    reqs = two_requirements() + [trace.Requirement("AA-03", "Group B", "third", None),
                                 trace.Requirement("AA-04", "Group B", "fourth", None)]
    results = trace.read_junit([junit(tmp_path, [
        ("tests.test_a", "test_one", "passed", ["AA-01", "AA-02"]),
        ("tests.test_a", "test_two", "failed", ["AA-02"]),
        ("tests.test_a", "test_three", "skipped", ["AA-03"]),
        ("tests.test_a", "test_four", "passed", ["AA-03"]),
        ("tests.test_a", "test_five", "error", ["AA-01"]),
    ])])
    m = trace.build(reqs, results)
    assert [(r.requirement.id, r.status) for r in m.rows] == [
        ("AA-01", "failing"), ("AA-02", "failing"), ("AA-03", "incomplete"), ("AA-04", "no tests")]
    assert not m.passed
    assert m.by_status() == {"failing": 2, "no tests": 1, "incomplete": 1, "passing": 0}


@pytest.mark.req("QR-03")
def test_a_passing_matrix_needs_every_requirement_passing_and_every_test_traced(tmp_path):
    ok = [("tests.test_a", "test_one", "passed", ["AA-01"]), ("tests_faults.test_b", "test_two", "passed", ["AA-02"])]
    m = trace.build(two_requirements(), trace.read_junit([junit(tmp_path, ok)]))
    assert m.passed and m.summary() == "2 requirements: 2 passing; 2 test results"
    assert [t.file for r in m.rows for t in r.tests] == ["tests/test_a.py", "tests_faults/test_b.py"]
    stray = trace.build(two_requirements(), trace.read_junit([junit(tmp_path, ok + [("tests.test_c", "test_x", "passed", [])])]))
    assert not stray.passed and stray.summary().endswith("1 with no requirement")
    unknown = trace.build(two_requirements(), trace.read_junit([junit(tmp_path, ok + [("tests.test_c", "test_y", "passed", ["ZZ-01"])])]))
    assert not unknown.passed and [(t.name, req) for t, req in unknown.unknown] == [("test_y", "ZZ-01")]


@pytest.mark.req("QR-03")
def test_a_test_in_a_class_keeps_its_file_and_reads_like_its_node_id(tmp_path):
    [t] = trace.read_junit([junit(tmp_path, [("tests.test_client.TestRetries", "test_one", "passed", ["AA-01"])])])
    assert (t.file, t.name) == ("tests/test_client.py", "TestRetries::test_one")   # as collect() names it


@pytest.mark.req("QR-01")
def test_collecting_ignores_pytest_addopts(tmp_path, monkeypatch, collected):
    # An option the nested run would fail on if it were passed through (-k would not show it: the
    # map is written before -k deselects anything, but a --junitxml would overwrite the run's report)
    monkeypatch.setenv("PYTEST_ADDOPTS", "--no-such-option")
    assert len(trace.collect(tmp_path / "map.json")) == len(collected)


@pytest.mark.req("QR-03")
@pytest.mark.parametrize("args", [["--junit", "x.xml", "--md", "y.md"], ["--out", "somewhere"]])
def test_an_option_for_the_other_mode_is_refused(args, capsys):
    assert cli.main(["trace", *args]) == 2
    assert "--" in capsys.readouterr().out


@pytest.mark.req("QR-03")
def test_two_junit_files_make_one_matrix(tmp_path):
    a = junit(tmp_path, [("tests.test_a", "test_one", "passed", ["AA-01"])])
    b = junit(tmp_path, [("tests_faults.test_b", "test_two", "passed", ["AA-02"])])
    assert trace.build(two_requirements(), trace.read_junit([a])).by_status()["no tests"] == 1
    assert trace.build(two_requirements(), trace.read_junit([a, b])).passed


@pytest.mark.req("QR-03")
def test_the_markdown_shows_each_requirement_its_tests_and_result(tmp_path):
    results = trace.read_junit([junit(tmp_path, [("tests.test_a", "test_one[x|y]", "passed", ["AA-01"]),
                                                 ("tests.test_a", "test_two", "failed", ["AA-02"]),
                                                 ("tests.test_c", "test_z", "passed", [])])])
    text = trace.to_markdown(trace.build(two_requirements(), results, ["reports/junit.xml"]))
    assert "| AA-01 | first |  | test_a: test_one[x\\|y] | passing (1 of 1) |" in text
    assert "| AA-02 | second | `Check` | test_a: test_two (failed) | failing (0 of 1) |" in text
    assert "## Group A" in text and "from `reports/junit.xml`" in text
    assert "- test_c: test_z: no requirement" in text
    assert "\n\n\n" not in text
    plain = trace.to_markdown(trace.build(two_requirements(), results), results=False)
    assert "| AA-02 | second | `Check` | test_a: test_two |\n" in plain   # no outcome, no result column
    assert "|---|---|---|---|\n" in plain and "passing" not in plain and "failed" not in plain
    assert "**2 requirements, 3 tests.**" in plain


@pytest.mark.req("QR-03")
def test_the_workbook_has_a_summary_the_matrix_and_every_test(tmp_path):
    results = trace.read_junit([junit(tmp_path, [("tests.test_a", "test_one", "passed", ["AA-01", "AA-02"]),
                                                 ("tests.test_c", "test_z", "passed", [])])])
    path = trace.write_workbook(trace.build(two_requirements(), results, ["reports/junit.xml"]), tmp_path / "m.xlsx")
    book = load_workbook(path)
    assert book.sheetnames == ["Summary", "Matrix", "Tests"]
    rows = list(book["Matrix"].iter_rows(min_row=2, values_only=True))
    assert [(r[0], r[4], r[8]) for r in rows] == [("AA-01", 1, "passing"), ("AA-02", 1, "passing")]
    tests = list(book["Tests"].iter_rows(min_row=2, values_only=True))
    assert tests == [("tests/test_a.py", "test_one", "passed", "AA-01, AA-02"), ("tests/test_c.py", "test_z", "passed", "NONE")]


@pytest.mark.req("QR-03")
def test_the_command_writes_the_matrix_and_sets_the_exit_code(tmp_path, capsys):
    every = [("tests.test_x", f"test_{r.id}", "passed", [r.id]) for r in PLAN]
    good = junit(tmp_path, every)
    assert cli.main(["trace", "--junit", str(good), "--out", str(tmp_path / "out")]) == 0
    assert (tmp_path / "out" / "traceability.xlsx").is_file()
    assert f"{len(PLAN)} requirements: {len(PLAN)} passing" in capsys.readouterr().out
    bad = junit(tmp_path, every[1:])
    assert cli.main(["trace", "--junit", str(bad), "--out", str(tmp_path / "out")]) == 1
    assert f"NO TESTS  {PLAN[0].id}" in capsys.readouterr().out
    assert cli.main(["trace", "--junit", str(tmp_path / "missing.xml")]) == 2


@pytest.mark.req("QR-03")
def test_the_command_without_junit_writes_the_tests_of_each_requirement(tmp_path, capsys, collected):
    out = tmp_path / "traceability.md"
    assert cli.main(["trace", "--md", str(out)]) == 0
    assert f"{len(PLAN)} requirements, {len(collected)} tests" in capsys.readouterr().out
    assert b"\r\n" not in out.read_bytes()


@pytest.mark.req("QR-03")
def test_the_committed_matrix_is_what_the_suites_collect(collected):
    built = trace.to_markdown(trace.build(PLAN, collected), results=False)
    committed = (ROOT / "docs" / "traceability.md").read_text(encoding="utf-8")   # a CRLF checkout reads as LF
    assert committed == built, "docs/traceability.md is stale: run python -m hcm_conv trace to rebuild it"
