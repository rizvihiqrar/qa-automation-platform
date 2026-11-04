"""A Workday-style mock HR and payroll API (fake, in memory, not affiliated with any HR vendor).

    python -m hcm_conv serve --port 8051      # or create_app() inside the tests

Read calls are paged like the public worker API is described (limit up to 100, offset).
POST /bulk-loads takes a spreadsheet template (one sheet per record type, a Spreadsheet Key
on every row) in one of two modes:
  validate_only  checks every row and saves nothing (the usual first run)
  load           saves the good rows and reports the bad ones; a row whose key is already
                 there updates it, so loading the same file twice adds nothing
Every rejected row is listed with its sheet, row, key, field and reason, as JSON or .xlsx.
GET /reports/{name} returns a whole record type as JSON or CSV: the file export a conversion
team reads back to compare with the source.
"""
from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from openpyxl import Workbook, load_workbook

from .target import BY_NAME, BY_REPORT, CODES, KEY_HEADING, SHEETS, Sheet

WID_NAMESPACE = uuid.UUID("5f0c6a51-0000-4000-8000-000000000051")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class Tenant:
    def __init__(self):
        self.records: dict[str, dict[tuple, dict]] = {s.name: {} for s in SHEETS}
        self.loads: dict[str, dict] = {}

    def has(self, sheet: str, key: str) -> bool:
        return (key,) in self.records[sheet]


def check_value(column, value: str) -> str | None:
    """The reason a cell is refused, or None."""
    if value == "":
        return "is required" if column.required else None
    if column.kind == "date":
        # fromisoformat alone also takes 20190228 and week dates such as 2026-W45-3
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError
            date.fromisoformat(value)
        except ValueError:
            return f"'{value}' is not a date (YYYY-MM-DD)"
    elif column.kind == "money":
        try:
            amount = Decimal(value)
        except InvalidOperation:
            return f"'{value}' is not an amount"
        if amount < 0 or amount != amount.quantize(Decimal("0.01")):
            return f"'{value}' must be zero or more, with at most 2 decimals"
    elif column.kind.startswith("code:"):
        allowed = CODES[column.kind[5:]]
        if value not in allowed:
            return f"'{value}' is not one of {', '.join(sorted(allowed))}"
    return None


def read_template(content: bytes) -> dict[str, list[tuple[int, dict]]]:
    try:
        book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(400, "the file is not an .xlsx workbook")
    sheets = {}
    for ws in book.worksheets:
        if ws.title not in BY_NAME:
            raise HTTPException(400, f"unknown sheet '{ws.title}'")
        sheet = BY_NAME[ws.title]
        rows = ws.iter_rows(values_only=True)
        header = [str(h) if h is not None else "" for h in next(rows, ())]
        expected = [KEY_HEADING] + [c.heading for c in sheet.columns]
        if header != expected:
            raise HTTPException(400, f"sheet '{ws.title}' must have the columns: {', '.join(expected)}")
        parsed = []
        for n, values in enumerate(rows, start=2):
            if all(v is None for v in values):
                continue
            cells = ["" if v is None else str(v).strip() for v in values]
            row = {"_key": cells[0]}
            row.update({c.field: cells[i + 1] for i, c in enumerate(sheet.columns)})
            parsed.append((n, row))
        sheets[ws.title] = parsed
    return sheets


def process(tenant: Tenant, sheets: dict[str, list[tuple[int, dict]]], save: bool) -> dict:
    errors, loaded, total = [], 0, 0
    pending: dict[str, set] = {s.name: set() for s in SHEETS}   # keys good so far in this file

    for sheet in SHEETS:
        seen: set[tuple] = set()
        for n, row in sheets.get(sheet.name, []):
            total += 1
            problems = row_problems(tenant, sheet, row, pending)
            key = tuple(row[f] for f in sheet.key)
            if not problems and key in seen:
                problems = [(sheet.key[0], "the same key is on an earlier row of this sheet")]
            seen.add(key)
            if problems:
                for field, message in problems:
                    errors.append({"sheet": sheet.name, "row": n, "spreadsheet_key": row["_key"],
                                   "field": field, "message": message})
                continue
            pending[sheet.name].add(key[0] if len(key) == 1 else key)
            loaded += 1
            if save:
                record = {f: row[f] for f in sheet.fields()}
                if sheet.name == "Workers":
                    record["wid"] = uuid.uuid5(WID_NAMESPACE, row["id"]).hex
                tenant.records[sheet.name][key] = record
    status = "Completed" if not errors else ("Completed with errors" if loaded else "Failed")
    return {"status": status, "rows_total": total, "rows_loaded": loaded,
            "rows_failed": len({(e["sheet"], e["row"]) for e in errors}), "errors": errors}


def row_problems(tenant: Tenant, sheet: Sheet, row: dict, pending: dict[str, set]) -> list[tuple[str, str]]:
    problems = [(c.field, reason) for c in sheet.columns if (reason := check_value(c, row[c.field]))]
    for field, other in sheet.refs:
        value = row[field]
        if value and not (tenant.has(other, value) or value in pending[other]):
            problems.append((field, f"'{value}' is not in {other}"))
    if sheet.name == "Workers" and not problems:
        if row["termination_date"] and row["termination_date"] < row["hire_date"]:
            problems.append(("termination_date", "is before the hire date"))
        if (row["status"] == "Terminated") != bool(row["termination_date"]):
            problems.append(("status", "Terminated needs a termination date, and only Terminated has one"))
    if sheet.name == "Pay Results" and not problems:
        if Decimal(row["gross"]) - Decimal(row["deductions"]) != Decimal(row["net"]):
            problems.append(("net", "is not gross minus deductions"))
    return problems


def page(items: list[dict], limit: int, offset: int) -> dict:
    return {"total": len(items), "data": items[offset:offset + limit]}


def create_app() -> FastAPI:
    app = FastAPI(title="Workday-style mock HR and payroll API (fake data, not affiliated with any HR vendor)")
    app.state.tenant = Tenant()

    def records(sheet: str) -> list[dict]:
        return list(app.state.tenant.records[sheet].values())

    Limit = Query(20, ge=1, le=100)
    Offset = Query(0, ge=0)

    @app.get("/workers")
    def list_workers(limit: int = Limit, offset: int = Offset):
        return page(records("Workers"), limit, offset)

    @app.get("/workers/{worker_id}")
    def get_worker(worker_id: str):
        worker = app.state.tenant.records["Workers"].get((worker_id,))
        if not worker:
            raise HTTPException(404, f"no worker {worker_id}")
        return worker

    @app.get("/workers/{worker_id}/compensation")
    def get_compensation(worker_id: str):
        comp = app.state.tenant.records["Compensation"].get((worker_id,))
        if not comp:
            raise HTTPException(404, f"no compensation for worker {worker_id}")
        return comp

    @app.get("/organizations")
    def list_organizations(limit: int = Limit, offset: int = Offset):
        return page(records("Organizations"), limit, offset)

    @app.get("/positions")
    def list_positions(limit: int = Limit, offset: int = Offset):
        return page(records("Positions"), limit, offset)

    @app.get("/pay-results")
    def list_pay_results(period: str | None = None, worker: str | None = None,
                         limit: int = Limit, offset: int = Offset):
        items = [r for r in records("Pay Results")
                 if (period is None or r["period_id"] == period) and (worker is None or r["worker_id"] == worker)]
        return page(items, limit, offset)

    @app.post("/bulk-loads", status_code=201)
    async def bulk_load(file: UploadFile = File(...), mode: str = Form("validate_only")):
        if mode not in ("validate_only", "load"):
            raise HTTPException(422, "mode must be validate_only or load")
        result = process(app.state.tenant, read_template(await file.read()), save=mode == "load")
        load_id = f"BL-{len(app.state.tenant.loads) + 1:04d}"
        app.state.tenant.loads[load_id] = {"id": load_id, "mode": mode, "file_name": file.filename, **result}
        summary = {k: v for k, v in app.state.tenant.loads[load_id].items() if k != "errors"}
        return {**summary, "errors_url": f"/bulk-loads/{load_id}/errors"}

    @app.get("/bulk-loads/{load_id}")
    def get_load(load_id: str):
        load = app.state.tenant.loads.get(load_id)
        if not load:
            raise HTTPException(404, f"no bulk load {load_id}")
        return {k: v for k, v in load.items() if k != "errors"}

    @app.get("/bulk-loads/{load_id}/errors")
    def get_load_errors(load_id: str, format: str = Query("json", pattern="^(json|xlsx)$")):
        load = app.state.tenant.loads.get(load_id)
        if not load:
            raise HTTPException(404, f"no bulk load {load_id}")
        if format == "json":
            return load["errors"]
        book = Workbook()
        ws = book.active
        ws.title = "Errors"
        ws.append(["Sheet", "Row", KEY_HEADING, "Field", "Message"])
        for e in load["errors"]:
            ws.append([e["sheet"], e["row"], e["spreadsheet_key"], e["field"], e["message"]])
        out = io.BytesIO()
        book.save(out)
        return Response(out.getvalue(), media_type=XLSX,
                        headers={"Content-Disposition": f'attachment; filename="{load_id}-errors.xlsx"'})

    @app.get("/reports/{name}")
    def report(name: str, format: str = Query("json", pattern="^(json|csv)$"), bom: bool = False):
        sheet = BY_REPORT.get(name)
        if not sheet:
            raise HTTPException(404, f"no report {name}; reports: {', '.join(BY_REPORT)}")
        rows = records(sheet.name)
        if format == "json":
            return JSONResponse({"Report_Entry": rows})
        out = io.StringIO()
        fields = sheet.fields() + (["wid"] if sheet.name == "Workers" else [])
        writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)
        text = ("﻿" if bom else "") + out.getvalue()
        return Response(text.encode("utf-8"), media_type="text/csv; charset=utf-8")

    @app.post("/tenant/reset", status_code=204)
    def reset():
        """Test only: an empty tenant, as each mock conversion cycle gets."""
        app.state.tenant = Tenant()

    return app
