"""Mapping and validation rules: every seeded defect is found by its own rule, and nothing else is."""
import json
from collections import Counter

import pytest

from hcm_conv import convert, extract, legacy

KEY = json.loads((legacy.LEGACY_DIR / "defects.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cycle1():
    return convert.convert(extract.read())


def errors(conversion):
    return [f for f in conversion.findings if f.severity == "error"]


@pytest.mark.parametrize("defect", KEY, ids=[d["id"] for d in KEY])
def test_each_seeded_defect_is_found_by_its_rule(cycle1, defect):
    hits = [f for f in errors(cycle1) if (f.rule, f.file, f.key) == (defect["rule"], defect["file"], defect["key"])]
    assert hits, f"{defect['id']} ({defect['description']}) was not found"
    assert {f.field for f in hits} == {defect["field"]} or defect["rule"] == "DUPLICATE_ID"


def test_no_error_is_raised_outside_the_answer_key(cycle1):
    expected = {(d["rule"], d["file"], d["key"]) for d in KEY}
    assert [f for f in errors(cycle1) if (f.rule, f.file, f.key) not in expected] == []


def test_cycle_one_counts(cycle1):
    assert len(errors(cycle1)) == 22   # 20 defects; each duplicate pair is 2 rows
    held = {sheet: sum(r.held for r in recs) for sheet, recs in cycle1.records.items()}
    assert held == {"Organizations": 0, "Positions": 2, "Workers": 14, "Compensation": 15, "Pay Results": 38}
    assert Counter(f.rule for f in cycle1.findings)["HELD_PARENT"] == 48


def test_rows_of_a_held_worker_are_held_with_an_info_reason(cycle1):
    held_workers = {r.key for r in cycle1.records["Workers"] if r.held}
    for sheet in ("Compensation", "Pay Results"):
        for rec in cycle1.records[sheet]:
            if rec.source["employee_id"] in held_workers:
                assert rec.held, rec.spreadsheet_key
    info = [f for f in cycle1.findings if f.rule == "HELD_PARENT"]
    assert all(f.severity == "info" for f in info)


def test_mapping_turns_legacy_codes_into_target_codes(cycle1):
    worker = next(r for r in cycle1.records["Workers"] if not r.held)
    assert worker.data["status"] in {"Active", "Terminated"} and worker.data["country"] in {"CAN", "USA"}
    comp = next(r for r in cycle1.records["Compensation"] if not r.held)
    assert comp.data["frequency"] in {"Weekly", "Biweekly", "Semimonthly", "Monthly"}
    assert {"given_name", "family_name", "region"} <= worker.data.keys()


@pytest.mark.parametrize("spec, raw, expected", [
    ({"required": True}, "  Tremblay ", ("Tremblay", None, None)),
    ({"required": True}, "   ", ("", "REQUIRED", "is blank")),
    ({}, "", ("", None, None)),
    ({"id": True}, "001234", ("001234", None, None)),
    ({"id": True}, "1234", ("1234", "ID_FORMAT", "is not 6 digits (leading zeros lost?)")),
    ({"date": True}, "2024-02-29", ("2024-02-29", None, None)),
    ({"date": True}, "2023-02-29", ("2023-02-29", "DATE_INVALID", "is not a real date written YYYY-MM-DD")),
    ({"date": True}, "20240229", ("20240229", "DATE_INVALID", "is not a real date written YYYY-MM-DD")),
    ({"money": True}, "100.5", ("100.5", None, None)),
    ({"money": True}, "100.005", ("100.005", "MONEY_INVALID", "is not an amount with at most 2 decimals")),
    ({"code": "frequency"}, "B", ("Biweekly", None, None)),
    ({"code": "frequency"}, "2W", ("2W", "CODE_UNKNOWN", "is not in the frequency code table")),
    ({"name": True}, "Benoît", ("Benoît", None, None)),
    ({"name": True}, "BenoÃ®t", ("BenoÃ®t", "ENCODING", "has double-encoded characters (UTF-8 read as Windows-1252)")),
    ({"name": True}, "Zo\ufffd", ("Zo\ufffd", "ENCODING", "has double-encoded characters (UTF-8 read as Windows-1252)")),
])
def test_each_transform(spec, raw, expected):
    assert convert.transform(spec, raw) == expected


def test_a_missing_trailer_is_reported():
    source = extract.read()
    del source.trailers["compensation.csv"]
    assert [(f.file, f.message) for f in convert.control_totals(source)] == [
        ("workers.csv", "says 201 records; the file has 200"), ("compensation.csv", "the file has no trailer")]


def test_a_hash_total_that_does_not_match_is_reported():
    source = extract.read()
    source.trailers["compensation.csv"]["hash_total"] = "1.00"
    assert [f.field for f in convert.control_totals(source) if f.file == "compensation.csv"] == ["hash_total"]


def test_a_pay_result_without_lines_is_reported():
    source = extract.read()
    source.payroll.execute("DELETE FROM pay_lines WHERE employee_id = '001800' AND period_id = 'P2026-19'")
    found = [f for f in convert.convert(source).findings if f.rule == "PAY_TOTAL" and f.key == "001800/P2026-19"]
    assert [(f.field, f.message) for f in found] == [("lines", "has no pay lines")]


def test_compensation_for_a_worker_not_in_the_extract_is_reported():
    source = extract.read()
    source.table("compensation.csv")[5].data["employee_id"] = "999999"
    found = [f for f in convert.convert(source).findings if f.rule == "REF_WORKER"]
    assert [(f.key, f.message) for f in found] == [("999999", "is not in workers.csv")]


def test_an_accepted_exception_must_match_something(cycle1):
    with pytest.raises(ValueError, match="matches nothing"):
        convert.accept(cycle1.findings, [{"rule": "REF_ORG", "file": "positions.csv", "key": "POS-0001"}])


def test_an_organization_under_a_held_organization_is_held_with_its_positions():
    source = extract.read()
    orgs = source.table("organizations.csv")
    orgs[2].data["cost_centre"] = ""                         # ORG-03 is held (REQUIRED)
    orgs[6].data["parent_org_id"] = orgs[2].data["org_id"]  # ORG-07 sits under it
    conversion = convert.convert(source)
    held = {r.key for r in conversion.records["Organizations"] if r.held}
    assert held == {"ORG-03", "ORG-07"}
    child = [f for f in conversion.findings if f.key == "ORG-07"]
    assert [(f.rule, f.severity) for f in child] == [("HELD_PARENT", "info")]
    assert all(r.held for r in conversion.records["Positions"] if r.source["org_id"] in held)


def test_a_salary_that_is_not_a_number_is_an_exception_not_a_crash():
    source = extract.read()
    source.table("compensation.csv")[3].data["annual_salary"] = "65,000"
    found = [f for f in convert.convert(source).findings if f.file == "compensation.csv"]
    assert ("MONEY_INVALID", "65,000") in [(f.rule, f.value) for f in found]
    assert any(f.rule == "CONTROL_TOTAL" and f.field == "hash_total" for f in found)


def test_a_payroll_key_with_spaces_still_matches_its_record():
    source = extract.read()
    source.payroll.execute("UPDATE pay_results SET employee_id = '079263 ' WHERE employee_id = '079263' AND period_id = 'P2026-20'")
    found = [f for f in convert.convert(source).findings if f.rule == "PAY_TOTAL"]
    assert "079263/P2026-20" in [f.key for f in found]
