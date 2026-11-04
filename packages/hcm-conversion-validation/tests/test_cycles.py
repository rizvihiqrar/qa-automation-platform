"""Cycles 1 to 3: exceptions go down, deltas follow each defect, and the exception report."""
import json
import re

import pytest
import yaml
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from hcm_conv import __main__ as cli
from hcm_conv import cycles, extract, legacy, report
from hcm_conv.mock_api import create_app

KEY = json.loads((legacy.LEGACY_DIR / "defects.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def three():
    with TestClient(create_app()) as client:
        return cycles.run(client)


def test_open_exceptions_go_down_each_cycle(three):
    assert [len(c.errors("Open")) for c in three] == [22, 12, 0]
    assert [len(c.errors("Accepted")) for c in three] == [0, 0, 2]


def test_the_deltas_follow_each_defect(three):
    d2, d3 = three[1].deltas, three[2].deltas
    assert (len(d2.new), len(d2.fixed), len(d2.still_open)) == (1, 10, 10)
    assert [(f.rule, f.key, f.field) for f in d2.new] == [("REQUIRED", "099501", "position_id")]   # the late new hire
    assert (len(d3.new), len(d3.fixed), len(d3.still_open), len(d3.accepted)) == (0, 9, 0, 2)
    assert {f.status for f in d3.accepted} == {"Accepted"}
    assert d3.summary() == "0 new, 9 fixed, 0 still open, 2 accepted"
    assert three[0].deltas is None


def test_only_the_last_cycle_passes_every_check(three):
    assert [c.passed for c in three] == [False, False, True]
    assert all(c.rejected == 0 for cyc in three for c in cyc.reconciliation.counts)


def test_every_seeded_defect_is_fixed_once_or_signed_off():
    fixed = {}
    for n in (2, 3):
        for fix in yaml.safe_load((extract.FIXES_DIR / f"cycle{n}.yaml").read_text(encoding="utf-8"))["fixes"]:
            if fix.get("defect", "").startswith("D-"):
                fixed.setdefault(fix["defect"], set()).add(n)
    accepted = {a["defect"] for a in cycles.accepted_for(3)}
    for d in KEY:
        assert (d["id"] in fixed) != (d["id"] in accepted), d["id"]
        assert len(fixed.get(d["id"], {0})) == 1, f"{d['id']} is fixed in two cycles"


def test_each_fix_closes_the_defect_it_names(three):
    for n, cycle in ((2, three[1]), (3, three[2])):
        names = {f["defect"] for f in yaml.safe_load((extract.FIXES_DIR / f"cycle{n}.yaml").read_text(encoding="utf-8"))["fixes"]
                 if f.get("defect", "").startswith("D-")}
        still = {(f.rule, f.file, f.key) for f in cycle.errors()}
        for d in KEY:
            if d["id"] in names:
                assert (d["rule"], d["file"], d["key"]) not in still, f"cycle {n}: {d['id']} is still there"


def test_a_fix_that_matches_no_row_stops_the_run():
    source = extract.read()
    with pytest.raises(ValueError, match="matched 0 rows"):
        extract.apply(source, [{"defect": "D-99", "file": "workers.csv", "match": {"employee_id": "000000"}, "set": {}}])


def test_the_exception_report_workbook(three, tmp_path):
    path = report.write(three[1], tmp_path / "cycle2.xlsx")
    book = load_workbook(path)
    assert book.sheetnames == ["Summary", "Exceptions", "Deltas"]
    summary = [r for r in book["Summary"].values]
    assert summary[1][0] == "Checks: some failed. Open exceptions: 12. Accepted: 0."
    assert ("Every loaded worker has compensation", "FAIL", "1 without: 084284") in [r[:3] for r in summary]
    rows = list(book["Exceptions"].values)
    assert rows[0][:3] == ("Rule", "Severity", "Status")
    assert len(rows) - 1 == len(three[1].findings)
    assert book["Deltas"]["A1"].value == "Against cycle 1: 1 new, 10 fixed, 10 still open"


def test_the_report_keeps_accents_and_leading_zeros(three, tmp_path):
    book = load_workbook(report.write(three[0], tmp_path / "cycle1.xlsx"))
    values = [r for r in book["Exceptions"].values]
    assert any(r[5] == "001800" for r in values)            # a key stays text, zeros and all
    assert any(r[7] and "Ã" in r[7] for r in values)         # the garbled name is shown as it arrived


def test_the_exceptions_command_prints_one_line_per_exception(capsys):
    assert cli.main(["exceptions", "--cycle", "3"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "Cycle 3: 0 open, 2 accepted"
    assert [line.split()[:2] for line in lines[2:]] == [["REF_ORG", "Accepted"], ["REF_ORG", "Accepted"]]
    cli.main(["exceptions", "--cycle", "1", "--all"])
    assert len(capsys.readouterr().out.splitlines()) == 2 + 22 + 48   # title, header, errors, info rows


def test_the_command_line_writes_a_report_per_cycle_and_sets_the_exit_code(tmp_path, capsys):
    assert cli.main(["run", "--out", str(tmp_path)]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == [f"exceptions_cycle{n}.xlsx" for n in (1, 2, 3)]
    assert cli.main(["run", "--cycle", "2", "--out", str(tmp_path / "two")]) == 1   # open exceptions
    out = capsys.readouterr().out
    assert re.search(r"Cycle 2\n.*against cycle 1: 1 new, 10 fixed, 10 still open", out, re.S)
