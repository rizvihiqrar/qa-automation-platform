"""The real cases: each log is replayed against qa-practice-api and must do what its case says."""
import json

import pytest

from repro.cases import CASES_DIR, load_cases, load_log, run_case

CASES = load_cases()
FIXABLE = [c for c in CASES if "fix" in c]


def ids(cases):
    return [c["id"] for c in cases]


def test_there_are_six_cases_and_each_log_file_is_in_the_cases_folder_and_used():
    assert len(CASES) == 6
    used = {c["log"] for c in CASES}
    on_disk = {f"logs/{p.name}" for p in (CASES_DIR / "logs").glob("*.jsonl")}
    assert used == on_disk, "every log belongs to a case and every case has its log"


@pytest.mark.parametrize("case", CASES, ids=ids(CASES))
def test_each_log_has_a_failed_request_to_rebuild(case):
    assert any(e.failed for e in load_log(case).entries)


@pytest.mark.parametrize("case", CASES, ids=ids(CASES))
def test_the_failure_comes_back_when_the_case_says_it_does(pool, case):
    outcome = run_case(case, pool)
    assert outcome.reproduced == (case["expect"] == "reproduces"), [str(m) for m in outcome.mismatches]


def test_the_log_set_reproduces_five_of_six(pool):
    reproduced = sum(run_case(c, pool).reproduced for c in CASES)
    assert reproduced == 5


@pytest.mark.parametrize("case", FIXABLE, ids=ids(FIXABLE))
def test_a_fix_makes_the_failed_requests_succeed(pool, case):
    fixed = run_case(case, pool, with_fix=True)
    assert fixed.fixed, [str(m) for m in fixed.mismatches]


def test_the_two_fixes_are_a_build_and_a_data_change():
    assert [c["id"] for c in FIXABLE] == ["RFL-02", "RFL-04"]
    assert FIXABLE[0]["fix"].get("flags") == "discount-codes:on"
    assert FIXABLE[1]["fix"].get("steps")


def test_the_cases_file_is_valid_json_with_unique_ids():
    raw = json.loads((CASES_DIR / "cases.json").read_text(encoding="utf-8"))
    assert [c["id"] for c in raw] == [f"RFL-0{i}" for i in range(1, 7)]


def test_one_case_that_cannot_be_replayed_is_reported_and_the_rest_still_run(tmp_path, monkeypatch, capsys):
    import copy
    import repro.__main__ as cli
    import repro.cases as cases_module

    broken = copy.deepcopy(CASES[0])
    broken["id"] = "RFL-99"
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "only-successes.jsonl").write_text(
        '{"time": "2026-11-17T10:00:00Z", "method": "GET", "path": "/products", "status": 200}\n', encoding="utf-8")
    broken["log"] = "logs/only-successes.jsonl"
    real_load_log = cases_module.load_log

    def load(c):
        if c["id"] == "RFL-99":
            return cases_module.parse_log((tmp_path / c["log"]).read_text(encoding="utf-8"))
        return real_load_log(c)

    monkeypatch.setattr(cli, "load_cases", lambda: [broken, CASES[0]])
    monkeypatch.setattr(cli, "load_log", load)
    monkeypatch.setattr(cases_module, "load_log", load)
    assert cli.main() == 1
    out = capsys.readouterr().out
    assert "RFL-99  CANNOT RUN" in out and "nothing to reproduce" in out
    assert "RFL-01  reproduced" in out
