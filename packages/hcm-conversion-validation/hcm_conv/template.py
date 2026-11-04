"""Build the bulk load template: one sheet per record type, a Spreadsheet Key on every row.

Every cell is written as text. A spreadsheet that stores 001234 as a number drops the zeros
(seeded defect D-15 shows what that does), so IDs must never become numbers here.
"""
from __future__ import annotations

import io

from openpyxl import Workbook

from .target import KEY_HEADING, SHEETS


def build(rows: dict[str, list[tuple[str, dict]]]) -> bytes:
    """rows: sheet name -> [(spreadsheet key, record with the sheet's fields)]."""
    book = Workbook()
    book.remove(book.active)
    for sheet in SHEETS:
        if sheet.name not in rows:
            continue
        ws = book.create_sheet(sheet.name)
        ws.append([KEY_HEADING] + [c.heading for c in sheet.columns])
        for key, record in rows[sheet.name]:
            ws.append([key] + [str(record.get(f, "")) for f in sheet.fields()])
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.number_format = "@"   # Text, so Excel keeps 001234 as typed
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()
