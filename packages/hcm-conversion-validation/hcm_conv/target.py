"""What the target HR system holds, written once for the mock API and the converter.

Loosely modelled on the public descriptions of Workday's interfaces (a spreadsheet-style
bulk load template with a key per row, and reports served as JSON or CSV). Not the real
schema, and not affiliated with any HR vendor.

Each sheet of the bulk load template is one record type. Sheets load in this order, so a
position can point at an organization from the same file.
"""
from __future__ import annotations

from dataclasses import dataclass

CODES = {
    "worker_status": {"Active", "Terminated"},
    "position_status": {"Filled", "Vacant"},
    "country": {"CAN", "USA"},
    "currency": {"CAD", "USD"},
    "frequency": {"Weekly", "Biweekly", "Semimonthly", "Monthly"},
}


@dataclass(frozen=True)
class Column:
    heading: str          # the column heading in the template
    field: str            # the field name in the API and reports
    kind: str = "text"    # text, date, money, or code:<list>
    required: bool = False


@dataclass(frozen=True)
class Sheet:
    name: str
    report: str           # the report that reads it back
    key: tuple[str, ...]  # fields that identify a record: a second load updates it
    columns: tuple[Column, ...]
    refs: tuple[tuple[str, str], ...] = ()   # (field, sheet it must exist in)

    def fields(self) -> list[str]:
        return [c.field for c in self.columns]


KEY_HEADING = "Spreadsheet Key"

SHEETS = (
    Sheet("Organizations", "organizations", ("id",), (
        Column("Organization ID", "id", required=True),
        Column("Name", "name", required=True),
        Column("Superior Organization ID", "superior_id"),
        Column("Cost Center", "cost_center", required=True),
    ), refs=(("superior_id", "Organizations"),)),
    Sheet("Positions", "positions", ("id",), (
        Column("Position ID", "id", required=True),
        Column("Organization ID", "organization_id", required=True),
        Column("Job Title", "job_title", required=True),
        Column("Status", "status", "code:position_status", True),
    ), refs=(("organization_id", "Organizations"),)),
    Sheet("Workers", "workers", ("id",), (
        Column("Employee ID", "id", required=True),
        Column("Given Name", "given_name", required=True),
        Column("Family Name", "family_name", required=True),
        Column("Birth Date", "birth_date", "date", True),
        Column("Email", "email"),
        Column("National ID", "national_id", required=True),
        Column("Hire Date", "hire_date", "date", True),
        Column("Termination Date", "termination_date", "date"),
        Column("Status", "status", "code:worker_status", True),
        Column("Position ID", "position_id", required=True),
        Column("Country", "country", "code:country", True),
        Column("Region", "region", required=True),
    ), refs=(("position_id", "Positions"),)),
    Sheet("Compensation", "compensation", ("worker_id",), (
        Column("Employee ID", "worker_id", required=True),
        Column("Annual Amount", "annual_amount", "money", True),
        Column("Currency", "currency", "code:currency", True),
        Column("Frequency", "frequency", "code:frequency", True),
        Column("Effective Date", "effective_date", "date", True),
    ), refs=(("worker_id", "Workers"),)),
    Sheet("Pay Results", "pay_results", ("worker_id", "period_id"), (
        Column("Employee ID", "worker_id", required=True),
        Column("Period ID", "period_id", required=True),
        Column("Gross", "gross", "money", True),
        Column("Deductions", "deductions", "money", True),
        Column("Net", "net", "money", True),
    ), refs=(("worker_id", "Workers"),)),
)
BY_NAME = {s.name: s for s in SHEETS}
BY_REPORT = {s.report: s for s in SHEETS}
