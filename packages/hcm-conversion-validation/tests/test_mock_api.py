"""The Workday-style mock API: bulk load, per-row errors, paging and reports."""
import csv
import io

import pytest
from openpyxl import load_workbook

from conftest import WORKER, one_of_each, upload


def test_a_good_template_loads_every_sheet(api):
    load = upload(api, one_of_each()).json()
    assert (load["status"], load["rows_total"], load["rows_loaded"], load["rows_failed"]) == ("Completed", 5, 5, 0)
    worker = api.get("/workers/001234").json()
    assert worker["given_name"] == "Zoé"            # accents survive the round trip
    assert len(worker["wid"]) == 32
    assert api.get("/workers/001234/compensation").json()["annual_amount"] == "65000.00"
    assert api.get("/pay-results", params={"period": "P2026-19"}).json()["total"] == 1


def test_validate_only_reports_but_saves_nothing(api):
    load = upload(api, one_of_each(), mode="validate_only").json()
    assert load["status"] == "Completed"
    assert api.get("/workers").json()["total"] == 0


def test_a_bad_row_is_refused_and_the_good_rows_still_load(api):
    load = upload(api, one_of_each(Compensation={"frequency": "2W"})).json()
    assert (load["status"], load["rows_loaded"], load["rows_failed"]) == ("Completed with errors", 4, 1)
    errors = api.get(load["errors_url"]).json()
    assert errors == [{"sheet": "Compensation", "row": 2, "spreadsheet_key": "Compensation:1",
                       "field": "frequency", "message": "'2W' is not one of Biweekly, Monthly, Semimonthly, Weekly"}]


@pytest.mark.parametrize("sheet, change, field, message", [
    ("Workers", {"family_name": ""}, "family_name", "is required"),
    ("Workers", {"hire_date": "2019-02-31"}, "hire_date", "'2019-02-31' is not a date (YYYY-MM-DD)"),
    ("Workers", {"hire_date": "20190228"}, "hire_date", "'20190228' is not a date (YYYY-MM-DD)"),
    ("Workers", {"hire_date": "2026-W45-3"}, "hire_date", "'2026-W45-3' is not a date (YYYY-MM-DD)"),
    ("Workers", {"status": "Terminated", "termination_date": "2019-12-01"}, "termination_date", "is before the hire date"),
    ("Workers", {"termination_date": "2024-01-01"}, "status", "Terminated needs a termination date, and only Terminated has one"),
    ("Workers", {"position_id": "POS-9999"}, "position_id", "'POS-9999' is not in Positions"),
    ("Positions", {"organization_id": "ORG-99"}, "organization_id", "'ORG-99' is not in Organizations"),
    ("Compensation", {"annual_amount": "-1.00"}, "annual_amount", "'-1.00' must be zero or more, with at most 2 decimals"),
    ("Compensation", {"annual_amount": "65000.005"}, "annual_amount", "'65000.005' must be zero or more, with at most 2 decimals"),
    ("Pay Results", {"net": "1757.50"}, "net", "is not gross minus deductions"),
])
def test_each_target_rule_refuses_its_row(api, sheet, change, field, message):
    load = upload(api, one_of_each(**{sheet: change})).json()
    errors = api.get(load["errors_url"]).json()
    assert [(e["sheet"], e["field"], e["message"]) for e in errors if e["sheet"] == sheet] == [(sheet, field, message)]


def test_rows_that_need_a_refused_row_are_refused_too(api):
    # The worker fails, so its compensation and pay result have no worker to belong to.
    load = upload(api, one_of_each(Workers={"country": "CAN "})).json()   # trailing space is trimmed: still good
    assert load["rows_failed"] == 0
    api.post("/tenant/reset")
    load = upload(api, one_of_each(Workers={"country": "CA"})).json()
    sheets = sorted(e["sheet"] for e in api.get(load["errors_url"]).json())
    assert sheets == ["Compensation", "Pay Results", "Workers"]


def test_the_same_key_twice_in_one_file_is_refused(api):
    rows = one_of_each()
    rows["Workers"].append(("Workers:2", dict(WORKER, given_name="Other")))
    load = upload(api, rows).json()
    errors = api.get(load["errors_url"]).json()
    assert [(e["row"], e["message"]) for e in errors] == [(3, "the same key is on an earlier row of this sheet")]


def test_loading_the_same_file_again_updates_instead_of_adding(api):
    upload(api, one_of_each())
    again = upload(api, one_of_each(Workers={"region": "ON"})).json()
    assert again["status"] == "Completed"
    assert api.get("/workers").json()["total"] == 1
    assert api.get("/workers/001234").json()["region"] == "ON"


def test_the_error_report_downloads_as_a_spreadsheet(api):
    load = upload(api, one_of_each(Workers={"family_name": ""})).json()
    response = api.get(load["errors_url"], params={"format": "xlsx"})
    rows = list(load_workbook(io.BytesIO(response.content)).active.values)
    assert rows[0] == ("Sheet", "Row", "Spreadsheet Key", "Field", "Message")
    assert rows[1][:4] == ("Workers", 2, "Workers:1", "family_name")


def test_a_file_that_is_not_a_template_is_refused(api):
    response = api.post("/bulk-loads", files={"file": ("x.xlsx", b"not a workbook")}, data={"mode": "load"})
    assert response.status_code == 400
    assert api.post("/bulk-loads", files={"file": ("x.xlsx", b"x")}, data={"mode": "delete"}).status_code == 422


def test_lists_are_paged_up_to_100(api):
    rows = one_of_each()
    rows["Workers"] = [(f"Workers:{n}", dict(WORKER, id=f"{n:06d}")) for n in range(1, 131)]
    upload(api, {"Organizations": rows["Organizations"], "Positions": rows["Positions"], "Workers": rows["Workers"]})
    first = api.get("/workers").json()
    assert (first["total"], len(first["data"])) == (130, 20)
    last = api.get("/workers", params={"limit": 100, "offset": 100}).json()
    assert [w["id"] for w in last["data"]][0] == "000101" and len(last["data"]) == 30
    assert api.get("/workers", params={"limit": 101}).status_code == 422


def test_reports_export_as_json_or_csv(api):
    upload(api, one_of_each())
    assert api.get("/reports/workers").json()["Report_Entry"][0]["id"] == "001234"
    response = api.get("/reports/workers", params={"format": "csv", "bom": "true"})
    text = response.content.decode("utf-8")
    assert text.startswith("﻿id,given_name")   # the BOM makes Excel read the accents right
    row = next(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    assert (row["id"], row["given_name"]) == ("001234", "Zoé")
    assert api.get("/reports/payroll").status_code == 404


def test_reset_empties_the_tenant(api):
    upload(api, one_of_each())
    assert api.post("/tenant/reset").status_code == 204
    assert api.get("/workers/001234").status_code == 404
