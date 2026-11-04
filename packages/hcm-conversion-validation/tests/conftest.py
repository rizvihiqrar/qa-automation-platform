"""Shared setup: a fresh mock API per test, called in-process (no port, no server to stop)."""
import pytest
from fastapi.testclient import TestClient

from hcm_conv import template
from hcm_conv.mock_api import create_app


@pytest.fixture
def api():
    with TestClient(create_app()) as client:
        yield client


ORG = {"id": "ORG-01", "name": "Head Office", "superior_id": "", "cost_center": "CC-100"}
POSITION = {"id": "POS-0001", "organization_id": "ORG-01", "job_title": "Analyst", "status": "Filled"}
WORKER = {"id": "001234", "given_name": "Zoé", "family_name": "Tremblay", "birth_date": "1990-05-01",
          "email": "person1234@example.com", "national_id": "012345678", "hire_date": "2020-01-15",
          "termination_date": "", "status": "Active", "position_id": "POS-0001", "country": "CAN",
          "region": "QC"}
COMP = {"worker_id": "001234", "annual_amount": "65000.00", "currency": "CAD", "frequency": "Biweekly",
        "effective_date": "2026-01-01"}
PAY = {"worker_id": "001234", "period_id": "P2026-19", "gross": "2500.00", "deductions": "717.50",
       "net": "1782.50"}


def one_of_each(**changes):
    """A template with one good record per sheet; changes = {sheet: {field: value}}."""
    base = {"Organizations": ORG, "Positions": POSITION, "Workers": WORKER, "Compensation": COMP,
            "Pay Results": PAY}
    rows = {}
    for sheet, record in base.items():
        rows[sheet] = [(f"{sheet}:1", {**record, **changes.get(sheet, {})})]
    return rows


def upload(api, rows, mode="load"):
    files = {"file": ("load.xlsx", template.build(rows), "application/octet-stream")}
    return api.post("/bulk-loads", files=files, data={"mode": mode})
